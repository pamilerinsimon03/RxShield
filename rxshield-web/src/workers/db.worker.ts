// src/workers/db.worker.ts
import * as Comlink from 'comlink';
// @ts-ignore
import sqlite3InitModuleRaw from '@sqlite.org/sqlite-wasm';
import { normalizeText, areFirstLettersVisuallyEquivalent } from '../utils/textNormalization';
import { getFuzzySimilarity } from '../utils/stringDistance';
import { hasDosagePattern, translateToNumericDose } from '../utils/dosageUtils';

const sqlite3InitModule = sqlite3InitModuleRaw as any;

let sqlite3: any = null;
let db: any = null;
let useOpfs = false;

// In-memory caches for frequently accessed data
let cachedDrugNames: any[] | null = null;
let cachedProtocolGenerics: Set<string> | null = null;

const api = {
  async initDb(): Promise<{ opfs: boolean }> {
    try {
      sqlite3 = await sqlite3InitModule({
        print: console.log,
        printErr: console.error,
      });

      useOpfs = !!sqlite3.opfs;
      console.log('SQLite initialized. OPFS support:', useOpfs);

      if (useOpfs) {
        try {
          const root = await navigator.storage.getDirectory();
          // Check if file exists.
          await root.getFileHandle('rxshield_core.db', { create: false });
          // File exists, open it
          db = new sqlite3.oo1.OpfsDb('/rxshield_core.db', 'c');
          console.log('Opened existing OPFS database.');
          
          // Ensure override_audits table exists
          db.exec({
            sql: `CREATE TABLE IF NOT EXISTS override_audits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT,
              generic_name TEXT,
              signature_lock TEXT,
              overridden_checks TEXT
            );`
          });
        } catch (e) {
          console.log('OPFS database file not found. Ready for seeding.');
        }
      } else {
        // Fallback: In-memory DB
        db = new sqlite3.oo1.DB();
        console.log('Initialized in-memory database fallback.');
        
        // Ensure override_audits table exists
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
      return { opfs: useOpfs };
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
        
        // Use sync access handle to write ArrayBuffer
        const accessHandle = await (fileHandle as any).createSyncAccessHandle();
        accessHandle.write(new Uint8Array(arrayBuffer), { at: 0 });
        accessHandle.flush();
        accessHandle.close();

        // Reopen OPFS DB
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

  async matchDrugNameOnly(text: string): Promise<{
    matched: boolean;
    confidence: number;
    name?: string;
    brand?: string;
  }> {
    const cleaned = normalizeText(text);
    if (!cleaned || cleaned.length < 3) return { matched: false, confidence: 0 };

    // 1. Precise check
    const exactRows = await api.query(
      'SELECT brand_name, generic_name FROM drugs WHERE brand_name = ? OR generic_name = ? LIMIT 1',
      [cleaned, cleaned]
    );
    if (exactRows && exactRows.length > 0) {
      return {
        matched: true,
        confidence: 1.0,
        name: exactRows[0].generic_name,
        brand: exactRows[0].brand_name
      };
    }

    // 2. Fuzzy match candidates using getFuzzySimilarity and improved thresholds
    // Use cached data to avoid repeated DB hits
    if (!cachedDrugNames) {
      cachedDrugNames = await api.query('SELECT DISTINCT brand_name, generic_name FROM drugs');
    }
    if (!cachedProtocolGenerics) {
      const protocols = await api.query('SELECT DISTINCT generic_name FROM nstg_protocols');
      cachedProtocolGenerics = new Set(protocols.map(p => (p.generic_name || "").toUpperCase()));
    }

    const candidates: any[] = [];

    for (const row of cachedDrugNames) {
      const namesToTest = [];
      if (row.brand_name) namesToTest.push(row.brand_name.toUpperCase());
      if (row.generic_name) namesToTest.push(row.generic_name.toUpperCase());

      for (const candidate of namesToTest) {
        const score = getFuzzySimilarity(cleaned, candidate);
        const generic = row.generic_name ? row.generic_name.toUpperCase() : candidate;
        const hasProtocol = cachedProtocolGenerics.has(generic);
        
        let threshold = 0.85;
        if (cleaned.length >= 8) {
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
          candidates.push({ name: candidate, generic, brand: row.brand_name, score, hasProtocol });
        }
      }
    }

    // Fallback loop if no candidate matched
    if (candidates.length === 0) {
      for (const row of cachedDrugNames) {
        const namesToTest = [];
        if (row.brand_name) namesToTest.push(row.brand_name.toUpperCase());
        if (row.generic_name) namesToTest.push(row.generic_name.toUpperCase());

        for (const candidate of namesToTest) {
          const score = getFuzzySimilarity(cleaned, candidate);
          const generic = row.generic_name ? row.generic_name.toUpperCase() : candidate;
          const hasProtocol = cachedProtocolGenerics.has(generic);
          
          if (score >= 0.45 && hasProtocol && areFirstLettersVisuallyEquivalent(cleaned[0], candidate[0])) {
            candidates.push({ name: candidate, generic, brand: row.brand_name, score, hasProtocol });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return { matched: false, confidence: 0 };
    }

    // Sort by score descending, with protocol as a close tie-breaker
    candidates.sort((a, b) => {
      if (Math.abs(b.score - a.score) < 0.005) {
        if (a.hasProtocol !== b.hasProtocol) {
          return a.hasProtocol ? -1 : 1;
        }
      }
      return b.score - a.score;
    });

    return {
      matched: true,
      confidence: candidates[0].score,
      name: candidates[0].generic,
      brand: candidates[0].brand
    };
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

      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) {
        return { matched: false, confidence: 0.0, cleanedInput: text, error: 'Empty input text' };
      }

      for (const token of tokens) {
        const res = await api.matchDrugNameOnly(token);
        if (res.matched) {
          const matchedName = res.name as string;
          // 3. Relational Join
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

          const results = await api.query(joinSql, [matchedName, matchedName]);

          if (results && results.length > 0) {
        let protocolData = results[0];
        
        // Secondary protocol lookup for combination medications (e.g. AMOXICILLIN + CLAVULANIC ACID -> AMOXICILLIN)
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
              confidence: res.confidence,
              cleanedInput: text,
              matchedString: res.brand || res.name,
              data: protocolData
            };
          }
        }
      }

        return {
        matched: false,
        confidence: 0.0,
        cleanedInput: text,
        error: `Medication not recognized.`
        };
    } catch (error) {
      console.error('Fuzzy matching and join failed:', error);
        return {
          matched: false,
        confidence: 0.0,
        cleanedInput: text,
        error: error instanceof Error ? error.message : String(error)
        };
      }
  },

  async selectBestOcrCandidate(wordL: string, wordS: string, previousMatchedGeneric: string | null = null): Promise<string> {
    const wl = wordL.trim();
    const ws = wordS.trim();

    if (wl.toLowerCase() === ws.toLowerCase()) {
      return wl;
    }

    const getPriority = async (word: string) => {
      const lower = word.toLowerCase();

      // 3. Frequency
      const isFreq = normalizeText(word).toLowerCase(); // simplified check
      // For real frequency check we might need FREQ_NORM_MAPS
      // But let's use the logic from test script

      // We need FREQ_NORM_MAPS here. Let's just use the priority logic.
      const isDose = hasDosagePattern(word);
      const match = await api.matchDrugNameOnly(word);

      if (match.matched) return { priority: 4, val: match };

      // Frequency check (manually for now or import)
      const frequencies = ['bd', 'bid', 'twice', 'tds', 'tid', 'three', 'qds', 'qid', 'four', 'daily'];
      if (frequencies.includes(lower)) return { priority: 3, val: null };

      const doseVal = translateToNumericDose(word, previousMatchedGeneric);
      if (doseVal.snapped && doseVal.value !== null) return { priority: 2, val: doseVal };
      if (isDose) return { priority: 1, val: doseVal };

      return { priority: 0, val: null };
      };

    const pL = await getPriority(wl);
    const pS = await getPriority(ws);

    if (pL.priority !== pS.priority) {
      return pL.priority > pS.priority ? wl : ws;
    }

    if (pL.priority === 4) {
      if (previousMatchedGeneric) {
        const matchLIsPrev = pL.val.name === previousMatchedGeneric;
        const matchSIsPrev = pS.val.name === previousMatchedGeneric;
        if (matchLIsPrev !== matchSIsPrev) return matchLIsPrev ? wl : ws;
      }
      return pL.val.confidence >= pS.val.confidence ? wl : ws;
    }

    if (pL.priority === 3) return wl.length <= ws.length ? wl : ws;
    if (pL.priority === 2) return pL.val.score <= pS.val.score ? wl : ws;

    return wl.length <= ws.length ? wl : ws;
    }
};

Comlink.expose(api);

export type DbWorkerApi = typeof api;
