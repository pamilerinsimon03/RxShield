// src/workers/db.worker.ts
import * as Comlink from 'comlink';
// @ts-ignore
import sqlite3InitModuleRaw from '@sqlite.org/sqlite-wasm';
import { normalizeText } from '../utils/textNormalization';
import { getFuzzySimilarity } from '../utils/stringDistance';

const sqlite3InitModule = sqlite3InitModuleRaw as any;

let sqlite3: any = null;
let db: any = null;
let useOpfs = false;

let ALL_DRUG_NAMES: string[] = [];
const DRUG_TO_GENERIC_MAP = new Map<string, string>();
const PROTOCOL_GENERICS = new Set<string>();

const areFirstLettersVisuallyEquivalent = (c1: string, c2: string): boolean => {
  const char1 = c1.toUpperCase();
  const char2 = c2.toUpperCase();
  if (char1 === char2) return true;
  
  const groups = [
    ['I', 'L', 'J', 'F', 'T', '1', '7'],
    ['O', 'D', 'Q', '0', 'C', 'K'],
    ['S', '5', '8', 'B'],
    ['A', '2', 'Z', 'R'],
    ['M', 'W', '3', 'N', 'H'],
    ['U', 'V', 'Y', '4'],
    ['P', 'R', 'B', 'F', 'H', 'D']
  ];
  
  for (const group of groups) {
    if (group.includes(char1) && group.includes(char2)) {
      return true;
    }
  }
  return false;
};

const hasProtocolInDb = (name: string): boolean => {
  const generic = DRUG_TO_GENERIC_MAP.get(name.toUpperCase());
  return generic ? PROTOCOL_GENERICS.has(generic) : false;
};

async function initDrugNamesInMemory() {
  if (ALL_DRUG_NAMES.length > 0) return;
  const candidates = await api.query('SELECT DISTINCT brand_name, generic_name FROM drugs');
  const unique = new Set<string>();
  for (const row of candidates) {
    const brand = row.brand_name ? row.brand_name.toUpperCase() : null;
    const generic = row.generic_name ? row.generic_name.toUpperCase() : null;
    if (brand) {
      unique.add(brand);
      if (generic) DRUG_TO_GENERIC_MAP.set(brand, generic);
    }
    if (generic) {
      unique.add(generic);
      DRUG_TO_GENERIC_MAP.set(generic, generic);
    }
  }
  ALL_DRUG_NAMES = Array.from(unique);

  const protocols = await api.query('SELECT DISTINCT generic_name FROM nstg_protocols');
  for (const row of protocols) {
    if (row.generic_name) {
      PROTOCOL_GENERICS.add(row.generic_name.toUpperCase());
    }
  }
}

const matchDrugNameOnly = (text: string): { matched: boolean; confidence: number; name?: string; brand?: string } => {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned.length < 3) return { matched: false, confidence: 0 };
  
  let candidates: { name: string; score: number; hasProtocol: boolean }[] = [];
  for (const candidate of ALL_DRUG_NAMES) {
    const score = getFuzzySimilarity(cleaned, candidate);
    const hasProtocol = hasProtocolInDb(candidate);
    
    let threshold = 0.85;
    if (cleaned.length >= 9) {
      threshold = 0.64;
    } else if (cleaned.length === 8) {
      threshold = 0.64;
    } else if (cleaned.length === 7) {
      threshold = 0.62;
    } else if (cleaned.length === 6) {
      threshold = 0.60;
    } else if (cleaned.length === 5) {
      threshold = 0.68;
    } else if (cleaned.length === 4) {
      threshold = 0.78;
    }
    
    const visuallyEquivalentFirstLetter = areFirstLettersVisuallyEquivalent(cleaned[0], candidate[0]);
    if (score >= threshold && visuallyEquivalentFirstLetter) {
      candidates.push({ name: candidate, score, hasProtocol });
    }
  }

  if (candidates.length === 0) {
    for (const candidate of ALL_DRUG_NAMES) {
      const score = getFuzzySimilarity(cleaned, candidate);
      const hasProtocol = hasProtocolInDb(candidate);
      
      if (score >= 0.45 && hasProtocol && areFirstLettersVisuallyEquivalent(cleaned[0], candidate[0])) {
        candidates.push({ name: candidate, score, hasProtocol });
      }
    }
  }

  if (candidates.length === 0) {
    return { matched: false, confidence: 0 };
  }

  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) < 0.005) {
      if (a.hasProtocol !== b.hasProtocol) {
        return a.hasProtocol ? -1 : 1;
      }
    }
    return b.score - a.score;
  });

  const bestName = candidates[0].name;
  const bestScore = candidates[0].score;
  const generic = DRUG_TO_GENERIC_MAP.get(bestName.toUpperCase()) || bestName;

  return { matched: true, confidence: bestScore, name: generic, brand: bestName };
};

const api = {
  async initDb(): Promise<{ opfs: boolean; initialized: boolean }> {
    try {
      sqlite3 = await sqlite3InitModule({
        print: console.log,
        printErr: console.error,
      });

      useOpfs = !!sqlite3.opfs;
      console.log('SQLite initialized. OPFS support:', useOpfs);

      let initialized = false;
      if (useOpfs) {
        try {
          const root = await navigator.storage.getDirectory();
          await root.getFileHandle('rxshield_core.db', { create: false });
          db = new sqlite3.oo1.OpfsDb('/rxshield_core.db', 'c');
          console.log('Opened existing OPFS database.');
          
          db.exec({
            sql: `CREATE TABLE IF NOT EXISTS override_audits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT,
              generic_name TEXT,
              signature_lock TEXT,
              overridden_checks TEXT
            );`
          });

          // Check if drugs table exists and contains records
          const tables: any[] = [];
          db.exec({
            sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='drugs';",
            rowMode: 'object',
            callback: (row: any) => {
              tables.push(row);
            }
          });

          if (tables.length > 0) {
            initialized = true;
            console.log('Drugs table verified. OPFS database is initialized and seeded.');
          } else {
            console.log('Drugs table not found in existing OPFS database. Forcing re-seed.');
            db.close();
            db = null;
          }
        } catch (e) {
          console.log('OPFS database file not found or corrupted. Ready for seeding:', e instanceof Error ? e.message : String(e));
        }
      } else {
        db = new sqlite3.oo1.DB();
        console.log('Initialized in-memory database fallback.');
        
        db.exec({
          sql: `CREATE TABLE IF NOT EXISTS override_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            generic_name TEXT,
            signature_lock TEXT,
            overridden_checks TEXT
          );`
        });
      }
      return { opfs: useOpfs, initialized };
    } catch (error) {
      console.error('Failed to initialize SQLite WASM:', error);
      throw error;
    }
  },

  async seedDatabase(arrayBuffer: ArrayBuffer): Promise<boolean> {
    try {
      if (!sqlite3) {
        throw new Error('SQLite WASM module not initialized.');
      }

      if (useOpfs) {
        console.log('Seeding OPFS database...');
        if (db) {
          db.close();
          db = null;
        }

        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('rxshield_core.db', { create: true });
        
        const accessHandle = await (fileHandle as any).createSyncAccessHandle();
        accessHandle.write(new Uint8Array(arrayBuffer), { at: 0 });
        accessHandle.flush();
        accessHandle.close();

        db = new sqlite3.oo1.OpfsDb('/rxshield_core.db', 'c');
        console.log('OPFS database seeded and opened.');
      } else {
        console.log('Seeding in-memory database fallback...');
        if (db) {
          db.close();
        }

        db = new sqlite3.oo1.DB();
        const p = sqlite3.wasm.allocFromTypedArray(arrayBuffer);
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer,
          'main',
          p,
          arrayBuffer.byteLength,
          arrayBuffer.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
        );
        db.checkRc(rc);
        console.log('In-memory database seeded successfully.');
      }

      if (db) {
        db.exec({
          sql: `CREATE TABLE IF NOT EXISTS override_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            generic_name TEXT,
            signature_lock TEXT,
            overridden_checks TEXT
          );`
        });
      }
      return true;
    } catch (error) {
      console.error('Failed to seed database:', error);
      throw error;
    }
  },

  async query(sql: string, params: Array<string | number> = []): Promise<any[]> {
    try {
      if (!db) {
        throw new Error('Database is not initialized or seeded.');
      }

      const rows: any[] = [];
      db.exec({
        sql,
        bind: params,
        rowMode: 'object',
        callback: (row: any) => {
          rows.push(row);
        }
      });
      return rows;
    } catch (error) {
      console.error('Query execution failed:', error);
      throw error;
    }
  },

  async logOverride(genericName: string, signatureLock: string, overriddenChecks: string): Promise<boolean> {
    try {
      if (!db) {
        throw new Error('Database is not initialized.');
      }
      db.exec({
        sql: 'INSERT INTO override_audits (timestamp, generic_name, signature_lock, overridden_checks) VALUES (?, ?, ?, ?)',
        bind: [new Date().toISOString(), genericName, signatureLock, overriddenChecks]
      });
      console.log(`[DB Worker] Override log written for ${genericName}`);
      return true;
    } catch (error) {
      console.error('Failed to log override:', error);
      throw error;
    }
  },

  async matchDrugAndJoinProtocol(text: string): Promise<{
    matched: boolean;
    confidence: number;
    cleanedInput: string;
    matchedString?: string;
    data?: any;
    error?: string;
  }> {
    try {
      if (!db) {
        throw new Error('Database is not initialized or seeded.');
      }

      await initDrugNamesInMemory();

      const cleanedInput = normalizeText(text);
      if (!cleanedInput) {
        return { matched: false, confidence: 0.0, cleanedInput, error: 'Empty input text' };
      }

      console.log(`[Matching] Cleaned Input: "${cleanedInput}"`);

      const tokens = cleanedInput.split(/\s+/).filter(Boolean);
      let matchedRes: any = null;
      for (const token of tokens) {
        const res = matchDrugNameOnly(token);
        if (res.matched) {
          matchedRes = res;
          break;
        }
      }

      if (!matchedRes || !matchedRes.matched) {
        return {
          matched: false,
          confidence: 0.0,
          cleanedInput,
          error: `Medication not recognized.`
        };
      }

      const matchedString = matchedRes.brand || matchedRes.name;

      const joinSql = `
        SELECT 
            d.brand_name,
            d.generic_name,
            d.atc_code,
            p.max_single_dose_mg,
            p.max_daily_dose_mg,
            p.max_duration_days,
            p.requires_pregnancy_check,
            p.requires_renal_check,
            p.guideline_citation
        FROM drugs d
        LEFT JOIN nstg_protocols p ON d.generic_name = p.generic_name COLLATE NOCASE
        WHERE d.generic_name = ? OR d.brand_name = ?
        LIMIT 1;
      `;

      const results = await api.query(joinSql, [matchedRes.name, matchedRes.name]);

      if (results && results.length > 0) {
        let protocolData = results[0];
        
        if (protocolData && protocolData.max_single_dose_mg === null && protocolData.generic_name && protocolData.generic_name.includes('+')) {
          console.log(`[DB Worker] Combo drug detected: "${protocolData.generic_name}". Attempting protocol lookup for primary component...`);
          const parts = protocolData.generic_name.split('+').map((s: string) => s.trim());
          if (parts.length > 0 && parts[0]) {
            const fallbackSql = `
              SELECT 
                  max_single_dose_mg,
                  max_daily_dose_mg,
                  max_duration_days,
                  requires_pregnancy_check,
                  requires_renal_check,
                  guideline_citation
              FROM nstg_protocols
              WHERE generic_name = ? COLLATE NOCASE
              LIMIT 1;
            `;
            const fallbackResults = await api.query(fallbackSql, [parts[0]]);
            if (fallbackResults && fallbackResults.length > 0) {
              const fb = fallbackResults[0];
              console.log(`[DB Worker] Secondary lookup matched primary component "${parts[0]}" limits: max_single=${fb.max_single_dose_mg}mg`);
              protocolData = {
                ...protocolData,
                max_single_dose_mg: fb.max_single_dose_mg,
                max_daily_dose_mg: fb.max_daily_dose_mg,
                max_duration_days: fb.max_duration_days,
                requires_pregnancy_check: fb.requires_pregnancy_check,
                requires_renal_check: fb.requires_renal_check,
                guideline_citation: fb.guideline_citation
              };
            }
          }
        }

        return {
          matched: true,
          confidence: matchedRes.confidence,
          cleanedInput,
          matchedString: matchedString,
          data: protocolData
        };
      } else {
        return {
          matched: false,
          confidence: matchedRes.confidence,
          cleanedInput,
          matchedString: matchedString,
          error: `Matched to "${matchedString}" but failed to fetch relational protocol record.`
        };
      }

    } catch (error) {
      console.error('Fuzzy matching and join failed:', error);
      return {
        matched: false,
        confidence: 0.0,
        cleanedInput: text,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};

Comlink.expose(api);

export type DbWorkerApi = typeof api;
