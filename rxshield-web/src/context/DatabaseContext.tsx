import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import * as Comlink from 'comlink';
import type { DbWorkerApi } from '@/workers/db.worker';

interface DatabaseContextType {
  isDbReady: boolean;
  dbError: string | null;
  query: (sql: string, params?: Array<string | number>) => Promise<any[]>;
  matchDrug: (text: string) => Promise<any>;
  logOverride: (genericName: string, signatureLock: string, overriddenChecks: string) => Promise<boolean>;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const DatabaseProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  const [isDbReady, setIsDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<DbWorkerApi> | null>(null);

  useEffect((): (() => void) => {
    let active = true;

    const init = async (): Promise<void> => {
      try {
        console.log('Spawning DB Web Worker...');
        const worker = new Worker(
          new URL('../workers/db.worker.ts', import.meta.url),
          { type: 'module' }
        );
        workerRef.current = worker;

        const api = Comlink.wrap<DbWorkerApi>(worker);
        apiRef.current = api;

        console.log('Initializing SQLite WASM inside worker...');
        const { opfs, initialized } = await api.initDb();
        console.log('Database worker initialized. OPFS support:', opfs, 'Seeded:', initialized);

        const needSeed = !initialized;

        if (needSeed) {
          console.log('Fetching database asset /database/rxshield_core.db...');
          const response = await fetch('/database/rxshield_core.db');
          if (!response.ok) {
            throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
          }
          const buffer = await response.arrayBuffer();
          console.log(`Fetched DB successfully. Size: ${buffer.byteLength} bytes. Seeding database...`);
          await api.seedDatabase(buffer);
        }

        if (active) {
          setIsDbReady(true);
        }
      } catch (err) {
        console.error('DatabaseContext initialization failed:', err);
        if (active) {
          setDbError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    init();

    return (): void => {
      active = false;
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const query = async (sql: string, params: Array<string | number> = []): Promise<any[]> => {
    if (!apiRef.current) {
      throw new Error('Database is not initialized.');
    }
    return apiRef.current.query(sql, params);
  };

  const matchDrug = async (text: string): Promise<any> => {
    if (!apiRef.current) {
      throw new Error('Database is not initialized.');
    }
    return apiRef.current.matchDrugAndJoinProtocol(text);
  };

  const logOverride = async (genericName: string, signatureLock: string, overriddenChecks: string): Promise<boolean> => {
    if (!apiRef.current) {
      throw new Error('Database is not initialized.');
    }
    return apiRef.current.logOverride(genericName, signatureLock, overriddenChecks);
  };

  return (
    <DatabaseContext.Provider value={{ isDbReady, dbError, query, matchDrug, logOverride }}>
      {children}
    </DatabaseContext.Provider>
  );
};

export const useDatabase = (): DatabaseContextType => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  return context;
};
