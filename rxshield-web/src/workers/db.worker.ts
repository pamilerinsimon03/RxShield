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

      const cleanedInput = normalizeText(text);
      if (!cleanedInput) {
        return { matched: false, confidence: 0.0, cleanedInput, error: 'Empty input text' };
      }

      console.log(`[Matching] Cleaned Input: "${cleanedInput}"`);

      // 1. Exact / Case-insensitive check
      const exactRows = await api.query(
        'SELECT generic_name FROM drugs WHERE brand_name = ? OR generic_name = ? LIMIT 1',
        [cleanedInput, cleanedInput]
      );

      let matchedString: string | null = null;
      let confidence = 1.0;

      if (exactRows && exactRows.length > 0) {
        matchedString = exactRows[0].generic_name;
        console.log(`[Matching] Exact match found: "${matchedString}"`);
      } else {
        // 2. Fuzzy match
        console.log('[Matching] Running fuzzy search with SQL pre-filtering...');
        
        // Split clean input into space-separated word tokens (of length >= 3)
        const inputWords = cleanedInput.split(/\s+/).filter(w => w.length >= 3);
        
        // If there are no words of length >= 3, fallback to using the whole cleanedInput
        const searchWords = inputWords.length > 0 ? inputWords : [cleanedInput];
        
        const uniqueCandidates: string[] = [];
        
        // Query candidates for each search word to ensure we cover all parts of the OCR text
        for (const word of searchWords) {
          const inputLen = word.length;
          const startLetter = word[0] ? (word[0] + '%') : '%';
          const minLen = Math.max(1, inputLen - 3);
          const maxLen = inputLen + 3;

          const candidates = await api.query(
            `SELECT DISTINCT brand_name, generic_name FROM drugs 
             WHERE (LENGTH(brand_name) BETWEEN ? AND ?) OR (brand_name LIKE ?) 
                OR (LENGTH(generic_name) BETWEEN ? AND ?) OR (generic_name LIKE ?)`,
            [minLen, maxLen, startLetter, minLen, maxLen, startLetter]
          );

          for (const row of candidates) {
            if (row.brand_name) {
              const brand = row.brand_name.toUpperCase();
              if (uniqueCandidates.indexOf(brand) === -1) {
                uniqueCandidates.push(brand);
              }
            }
            if (row.generic_name) {
              const generic = row.generic_name.toUpperCase();
              if (uniqueCandidates.indexOf(generic) === -1) {
                uniqueCandidates.push(generic);
              }
            }
          }
        }
        
        let bestCandidate: string | null = null;
        let highestScore = 0.0;
        let secondHighestScore = 0.0;

        // Evaluate similarity of each candidate against:
        // - The full cleanedInput string
        // - Each individual word in the input
        // - Consecutive word pairs (e.g. for multi-word brand/generic names)
        for (let i = 0; i < uniqueCandidates.length; i++) {
          const candidate = uniqueCandidates[i];
          
          // Base comparison: full string
          let score = getFuzzySimilarity(cleanedInput, candidate);
          
          // Word comparison
          for (const word of searchWords) {
            const s = getFuzzySimilarity(word, candidate);
            if (s > score) score = s;
          }

          // Consecutive word pairs comparison
          if (searchWords.length > 1) {
            for (let wIdx = 0; wIdx < searchWords.length - 1; wIdx++) {
              const pair = `${searchWords[wIdx]} ${searchWords[wIdx + 1]}`;
              const s = getFuzzySimilarity(pair, candidate);
              if (s > score) score = s;
            }
          }

          if (score > highestScore) {
            secondHighestScore = highestScore;
            highestScore = score;
            bestCandidate = candidate;
          } else if (score > secondHighestScore) {
            secondHighestScore = score;
          }
        }

        console.log(`[Matching] Best candidate: "${bestCandidate}" with confidence: ${highestScore.toFixed(3)}, Second best: ${secondHighestScore.toFixed(3)}`);

        const isDoubleGatePass = highestScore >= 0.85 || 
          (highestScore >= 0.70 && (highestScore - secondHighestScore) >= 0.20);

        if (bestCandidate && isDoubleGatePass) {
          matchedString = bestCandidate;
          confidence = highestScore;
        } else {
          return {
            matched: false,
            confidence: highestScore,
            cleanedInput,
            matchedString: bestCandidate || undefined,
            error: `Medication not recognized. Highest match: ${bestCandidate || 'None'} (${(highestScore * 100).toFixed(1)}%)`
          };
        }
      }

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

      const results = await api.query(joinSql, [matchedString as string, matchedString as string]);

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
          confidence,
          cleanedInput,
          matchedString: matchedString || undefined,
          data: protocolData
        };
      } else {
        return {
          matched: false,
          confidence,
          cleanedInput,
          matchedString: matchedString || undefined,
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
