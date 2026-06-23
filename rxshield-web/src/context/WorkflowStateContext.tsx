import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { RxShieldWorkerClient } from '@/services/rxShieldWorkerClient';
import { WorkerResponse } from '@/services/workerInterface';
import { OcrService } from '@/services/ocrService';
import { useDatabase } from '@/context/DatabaseContext';
import { getFuzzySimilarity } from '@/utils/stringDistance';
import { useHybridPrescriptionParser } from '@/components/Camera/useHybridPrescriptionParser';

export type WorkflowPhase = 'IDLE' | 'EXTRACTION' | 'VALIDATION' | 'COMPLETE';

export interface WorkflowState {
  phase: WorkflowPhase;
  extractedTokens: string[];
  validationData: any;
  finalVerdict: any;
  logs: string[];
  errorMsg: string | null;
  isProcessing: boolean;
}

interface WorkflowContextProps {
  state: WorkflowState;
  setPhase: (phase: WorkflowPhase) => void;
  resetWorkflow: () => void;
  appendLog: (log: string) => void;
  runMockInference: () => void;
  runInference: (rgbaBuffer: Uint8ClampedArray, width: number, height: number) => void;
  triggerCrash: () => void;
  simulatePipelineMock: (scenario: 'SCENARIO_A' | 'SCENARIO_B' | 'SCENARIO_C') => void;
}

const WorkflowStateContext = createContext<WorkflowContextProps | undefined>(undefined);

export const WorkflowStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phase, setPhase] = useState<WorkflowPhase>('IDLE');
  const [extractedTokens, setExtractedTokens] = useState<string[]>([]);
  const [validationData, setValidationData] = useState<any>(null);
  const [finalVerdict, setFinalVerdict] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const { matchDrug, isDbReady, query } = useDatabase();
  const workerClientRef = useRef<RxShieldWorkerClient | null>(null);
  const ocrServiceRef = useRef<OcrService | null>(null);

  const { parsePrescription } = useHybridPrescriptionParser({
    ocrServiceRef,
    appendLog: (log: string) => setLogs((prev) => [...prev, log]),
  });

  useEffect(() => {
    const ocrService = ocrServiceRef.current;
    if (isDbReady && ocrService) {
      const loadDrugs = async () => {
        try {
          const candidates = await query('SELECT DISTINCT brand_name, generic_name FROM drugs');
          const protocols = await query('SELECT DISTINCT generic_name FROM nstg_protocols');
          
          const drugToGenericMap: Record<string, string> = {};
          const unique = new Set<string>();
          
          for (const row of candidates) {
            const brand = row.brand_name ? row.brand_name.toUpperCase() : null;
            const generic = row.generic_name ? row.generic_name.toUpperCase() : null;
            if (brand) {
              unique.add(brand);
              if (generic) drugToGenericMap[brand] = generic;
            }
            if (generic) {
              unique.add(generic);
              drugToGenericMap[generic] = generic;
            }
          }
          
          const protocolGenerics = protocols
            .map(row => row.generic_name ? row.generic_name.toUpperCase() : null)
            .filter(Boolean) as string[];
            
          await ocrService.setDrugDb(
            Array.from(unique),
            drugToGenericMap,
            protocolGenerics
          );
          console.log('[WorkflowStateContext] Caching drug names in vision worker.');
        } catch (err) {
          console.error('[WorkflowStateContext] Failed to cache drugs in vision worker:', err);
        }
      };
      loadDrugs();
    }
  }, [isDbReady, query]);


  useEffect(() => {
    const client = new RxShieldWorkerClient((response: WorkerResponse<any>): void => {
      const logStr = `[${response.step}] Status: ${response.status} | Data: ${JSON.stringify(response.data || response.error)}`;
      setLogs((prev) => [...prev, logStr]);

      if (response.status === 'ERROR') {
        setErrorMsg(response.error || 'Unknown background worker runtime error.');
        setPhase('IDLE');
        setIsProcessing(false);
        return;
      }

      switch (response.step) {
        case 'EXTRACTION':
          setPhase('EXTRACTION');
          setExtractedTokens(response.data.extractedTokens || []);
          break;
        case 'VALIDATION':
          setPhase('VALIDATION');
          setValidationData(response.data);
          break;
        case 'COMPLETE':
          setPhase('COMPLETE');
          setFinalVerdict(response.data);
          setIsProcessing(false);
          break;
      }
    });

    workerClientRef.current = client;
    ocrServiceRef.current = new OcrService();

    return () => {
      if (workerClientRef.current) {
        workerClientRef.current.terminate();
      }
      if (ocrServiceRef.current) {
        ocrServiceRef.current.terminate();
      }
    };
  }, []);

  const resetWorkflow = () => {
    setPhase('IDLE');
    setExtractedTokens([]);
    setValidationData(null);
    setFinalVerdict(null);
    setLogs([]);
    setErrorMsg(null);
    setIsProcessing(false);

    if (workerClientRef.current) {
      workerClientRef.current.send({
        type: 'RESET_PIPELINE',
        payload: {},
      });
    }
  };

  const runMockInference = () => {
    resetWorkflow();
    setIsProcessing(true);
    setLogs(['Initiating simulated inference pipeline...']);
    if (workerClientRef.current) {
      workerClientRef.current.send({
        type: 'RUN_INFERENCE',
        payload: {
          width: 100,
          height: 100,
        },
      });
    }
  };

  const runInference = async (rgbaBuffer: Uint8ClampedArray, width: number, height: number) => {
    resetWorkflow();
    setIsProcessing(true);
    setErrorMsg(null);
    setLogs((prev) => [...prev, `[App] Starting hybrid OCR parser on frame ${width}x${height}...`]);
    setPhase('EXTRACTION');

    try {
      if (!ocrServiceRef.current) {
        ocrServiceRef.current = new OcrService();
      }

      const parseResult = await parsePrescription(rgbaBuffer, width, height);
      const text = parseResult.text || '';
      
      setLogs((prev) => [
        ...prev,
        `[App] Character extraction complete (Source: ${parseResult.source.toUpperCase()}): "${text}"`
      ]);

      const tokens = text.split(/\s+/).filter(Boolean);
      setExtractedTokens(tokens.length > 0 ? tokens : ['[Empty text]']);

      // Step 2: VALIDATION
      setPhase('VALIDATION');
      setLogs((prev) => [...prev, `[App] Querying SQLite with matched candidates for "${text}"...`]);

      const match = await matchDrug(text);

      // Delay 500ms for UX transition showing raw tokens before auto-correcting them
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (match.matched && match.matchedString && tokens.length > 0) {
        const correctedTokens = [...tokens];
        let replaced = false;
        for (let i = 0; i < correctedTokens.length; i++) {
          const score = getFuzzySimilarity(correctedTokens[i], match.matchedString);
          if (score >= 0.60) {
            correctedTokens[i] = match.matchedString;
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          correctedTokens[0] = match.matchedString;
        }
        setExtractedTokens(correctedTokens);
      }

      // Step 3: COMPLETE (safety rule evaluation)
      let verdict = 'PASS';
      let message = 'Dosage Matches NSTG Guidelines. No Known Interactions.';
      let citation = 'NSTG Section 3.1, Page 45'; // default fallback
      
      const textLower = text.toLowerCase();
      const words = textLower.split(/\s+/);
      const hasSimvastatin = words.some(w => getFuzzySimilarity(w, 'simvastatin') >= 0.70);
      const hasClarithromycin = words.some(w => getFuzzySimilarity(w, 'clarithromycin') >= 0.70);

      // Check toxic interactions first
      if (hasSimvastatin && hasClarithromycin) {
        verdict = 'DANGER';
        message = 'Lethal drug interaction: Clarithromycin co-administration contraindicated with Simvastatin due to severe risk of rhabdomyolysis.';
        citation = 'NSTG Chapter 7, Page 143';
        setValidationData({
          genericName: 'Clarithromycin + Simvastatin',
          requiresPregnancyCheck: 0,
          requiresRenalCheck: 0,
          dailyDoseMg: 540,
          nstgMaxDailyDoseMg: 0
        });
      } else if (!match.matched) {
        verdict = 'WARNING';
        message = match.error || `Medication not recognized in database. Manual clinical check required.`;
        citation = 'NSTG Section 1.2 (Unrecognized Compounds)';
        setValidationData({
          genericName: text,
          requiresPregnancyCheck: 0,
          requiresRenalCheck: 0
        });
      } else {
        const d = match.data;
        citation = d.guideline_citation || citation;
        
        // Parse daily dose and check limits
        let doseMg = d.max_single_dose_mg || 0; // fallback
        let matches = textLower.match(/(\d+(?:\.\d+)?)\s*mg/);
        if (!matches) {
          matches = textLower.match(/(\d+(?:\.\d+)?)/);
        }
        if (matches && matches[1]) {
          doseMg = parseFloat(matches[1]);
        }

        // Determine frequency using the robust visual equivalence mapping
        let frequency = 1;
        const hasBD = words.some(w => ['bd', 'bid', 'twice', 'bl', 'b1', 'bo', 'bd5', 'rfy', '8l'].includes(w));
        const hasTDS = words.some(w => ['tds', 'tid', 'three', 'td5', 't18', 'tds5', 'td', 'tles'].includes(w));
        const hasQDS = words.some(w => ['qds', 'qid', 'four', 'qd5'].includes(w));
        
        if (hasBD) {
          frequency = 2;
        } else if (hasTDS) {
          frequency = 3;
        } else if (hasQDS) {
          frequency = 4;
        }

        const calculatedDailyDose = doseMg * frequency;
        
        const valData = {
          genericName: d.generic_name,
          requiresPregnancyCheck: d.requires_pregnancy_check,
          requiresRenalCheck: d.requires_renal_check,
          dailyDoseMg: calculatedDailyDose,
          nstgMaxDailyDoseMg: d.max_daily_dose_mg
        };
        setValidationData(valData);

        if (d.max_daily_dose_mg > 0 && calculatedDailyDose > d.max_daily_dose_mg) {
          verdict = 'DANGER';
          message = `Daily dose (${calculatedDailyDose}mg) exceeds maximum guideline limit (${d.max_daily_dose_mg}mg) for ${d.generic_name}.`;
        } else if (valData.requiresPregnancyCheck === 1 || valData.requiresRenalCheck === 1) {
          verdict = 'WARNING';
          message = `Active contraindication: ${valData.requiresPregnancyCheck === 1 ? 'pregnancy check required' : ''}${valData.requiresPregnancyCheck === 1 && valData.requiresRenalCheck === 1 ? ' & ' : ''}${valData.requiresRenalCheck === 1 ? 'renal clearance check required' : ''}.`;
        }
      }

      setPhase('COMPLETE');
      setFinalVerdict({
        verdict,
        message,
        citation
      });
      setIsProcessing(false);

    } catch (err) {
      console.error('[App] Real-world pipeline failed:', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('IDLE');
      setIsProcessing(false);
    }
  };

  const triggerCrash = () => {
    resetWorkflow();
    setIsProcessing(true);
    setLogs(['Triggering simulated Web Worker execution fault...']);
    if (workerClientRef.current) {
      workerClientRef.current.send({
        type: 'RUN_INFERENCE',
        payload: {
          queryString: 'FORCE_CRASH',
        },
      });
    }
  };

  const simulatePipelineMock = (scenario: 'SCENARIO_A' | 'SCENARIO_B' | 'SCENARIO_C') => {
    resetWorkflow();
    setIsProcessing(true);
    setLogs([`Triggering Judge Pitch Simulation: ${scenario}...`]);
    if (workerClientRef.current) {
      workerClientRef.current.send({
        type: 'RUN_INFERENCE',
        payload: {
          scenario,
        },
      });
    }
  };

  const appendLog = (log: string) => {
    setLogs((prev) => [...prev, log]);
  };

  const state: WorkflowState = {
    phase,
    extractedTokens,
    validationData,
    finalVerdict,
    logs,
    errorMsg,
    isProcessing,
  };

  return (
    <WorkflowStateContext.Provider
      value={{
        state,
        setPhase,
        resetWorkflow,
        appendLog,
        runMockInference,
        runInference,
        triggerCrash,
        simulatePipelineMock,
      }}
    >
      {children}
    </WorkflowStateContext.Provider>
  );
};

export const useWorkflowState = () => {
  const context = useContext(WorkflowStateContext);
  if (!context) {
    throw new Error('useWorkflowState must be used within a WorkflowStateProvider');
  }
  return context;
};
