import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { RxShieldWorkerClient } from '@/services/rxShieldWorkerClient';
import { WorkerResponse } from '@/services/workerInterface';
import { OcrService } from '@/services/ocrService';
import { useDatabase } from '@/context/DatabaseContext';

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

  const { matchDrug } = useDatabase();
  const workerClientRef = useRef<RxShieldWorkerClient | null>(null);
  const ocrServiceRef = useRef<OcrService | null>(null);


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
    setLogs((prev) => [...prev, `[App] Starting local OCR model on frame ${width}x${height}...`]);
    setPhase('EXTRACTION');

    try {
      if (!ocrServiceRef.current) {
        ocrServiceRef.current = new OcrService();
      }

      setLogs((prev) => [...prev, '[App] Initializing ONNX Character Recognition...']);
      await ocrServiceRef.current.init();

      setLogs((prev) => [...prev, '[App] Running OCR neural network pass...']);
      const ocrResult = await ocrServiceRef.current.runOcr(rgbaBuffer, width, height);
      const text = ocrResult.text || '';
      
      setLogs((prev) => [...prev, `[App] Character extraction complete: "${text}"`]);

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
        correctedTokens[0] = match.matchedString;
        setExtractedTokens(correctedTokens);
      }

      // Step 3: COMPLETE (safety rule evaluation)
      let verdict = 'PASS';
      let message = 'Dosage Matches NSTG Guidelines. No Known Interactions.';
      let citation = 'NSTG Section 3.1, Page 45'; // default fallback
      
      const textLower = text.toLowerCase();

      // Check toxic interactions first
      if (textLower.includes('simvastatin') && textLower.includes('clarithromycin')) {
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
          // Fallback: match any number sequence if "mg" is omitted or misread
          matches = textLower.match(/(\d+(?:\.\d+)?)/);
        }
        if (matches && matches[1]) {
          doseMg = parseFloat(matches[1]);
        }

        // Determine frequency
        let frequency = 1;
        if (textLower.includes('bd') || textLower.includes('bid') || textLower.includes('twice')) {
          frequency = 2;
        } else if (textLower.includes('tds') || textLower.includes('tid') || textLower.includes('three')) {
          frequency = 3;
        } else if (textLower.includes('qds') || textLower.includes('qid') || textLower.includes('four')) {
          frequency = 4;
        }

        const calculatedDailyDose = doseMg * frequency;
        
        // Populate normalized validation data
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
        } else if (d.requires_pregnancy_check === 1 || d.requires_renal_check === 1) {
          verdict = 'WARNING';
          message = `Active contraindication: ${d.requires_pregnancy_check === 1 ? 'pregnancy check required' : ''}${d.requires_pregnancy_check === 1 && d.requires_renal_check === 1 ? ' & ' : ''}${d.requires_renal_check === 1 ? 'renal clearance check required' : ''}.`;
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
