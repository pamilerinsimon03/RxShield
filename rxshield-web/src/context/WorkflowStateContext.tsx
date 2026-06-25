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
  runInference: (rgbaBuffer: Uint8ClampedArray, width: number, height: number, scanMode?: 'line' | 'block') => void;
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

  const runInference = async (
    rgbaBuffer: Uint8ClampedArray,
    width: number,
    height: number,
    scanMode: 'line' | 'block' = 'line'
  ) => {
    resetWorkflow();
    setIsProcessing(true);
    setErrorMsg(null);
    setLogs((prev) => [...prev, `[App] Starting hybrid OCR parser on frame ${width}x${height}...`]);
    setPhase('EXTRACTION');

    try {
      if (!ocrServiceRef.current) {
        ocrServiceRef.current = new OcrService();
      }

      const parseResult = await parsePrescription(rgbaBuffer, width, height, scanMode);
      const text = parseResult.text || '';
      
      setLogs((prev) => [
        ...prev,
        `[App] Character extraction complete (Source: ${parseResult.source.toUpperCase()}): "${text.replace(/\n/g, ' | ')}"`
      ]);

      const tokens = text.split(/\s+/).filter(Boolean);
      setExtractedTokens(tokens.length > 0 ? tokens : ['[Empty text]']);

      // Step 2: VALIDATION
      setPhase('VALIDATION');
      setLogs((prev) => [...prev, `[App] Querying SQLite with matched candidates...`]);

      // Split text by lines to support multi-line validation
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const matches = await Promise.all(lines.map((line) => matchDrug(line)));

      // Delay 500ms for UX transition showing raw tokens before auto-correcting them
      await new Promise((resolve) => setTimeout(resolve, 500));

      let correctedTokens = [...tokens];
      for (let idx = 0; idx < lines.length; idx++) {
        const match = matches[idx];
        const lineText = lines[idx];
        if (match && match.matched && match.matchedString) {
          const lineTokens = lineText.split(/\s+/).filter(Boolean);
          let replaced = false;
          for (let i = 0; i < correctedTokens.length; i++) {
            const score = getFuzzySimilarity(correctedTokens[i], match.matchedString);
            if (score >= 0.60) {
              correctedTokens[i] = match.matchedString;
              replaced = true;
              break;
            }
          }
          if (!replaced && lineTokens.length > 0) {
            const firstToken = lineTokens[0];
            const cIdx = correctedTokens.findIndex(
              (t) => t.toLowerCase() === firstToken.toLowerCase()
            );
            if (cIdx !== -1) {
              correctedTokens[cIdx] = match.matchedString;
            }
          }
        }
      }
      setExtractedTokens(correctedTokens);

      // Step 3: COMPLETE (safety rule evaluation)
      let verdict = 'PASS';
      let messages: string[] = [];
      let citations: string[] = [];
      let combinedGenericNames: string[] = [];
      let combinedRequiresPregnancyCheck = 0;
      let combinedRequiresRenalCheck = 0;
      let combinedDailyDoseMg = 0;
      let combinedMaxDailyDoseMg = 0;

      // 1. Evaluate each line individually for single-drug rules (dosages, gates)
      for (let idx = 0; idx < lines.length; idx++) {
        const match = matches[idx];
        const lineText = lines[idx];
        const lineTextLower = lineText.toLowerCase();
        const lineWords = lineTextLower.split(/\s+/);

        if (!match.matched) {
          if (verdict !== 'DANGER') verdict = 'WARNING';
          messages.push(
            match.error || `Medication not recognized in database. Manual clinical check required.`
          );
          citations.push('NSTG Section 1.2 (Unrecognized Compounds)');
          combinedGenericNames.push(lineText);
        } else {
          const d = match.data;
          combinedGenericNames.push(d.generic_name);
          if (d.requires_pregnancy_check === 1) combinedRequiresPregnancyCheck = 1;
          if (d.requires_renal_check === 1) combinedRequiresRenalCheck = 1;
          citations.push(d.guideline_citation || 'NSTG Section 3.1, Page 45');

          // Parse daily dose and check limits
          let doseMg = d.max_single_dose_mg || 0; // fallback
          let matchesDose = lineTextLower.match(/(\d+(?:\.\d+)?)\s*mg/);
          if (!matchesDose) {
            matchesDose = lineTextLower.match(/(\d+(?:\.\d+)?)/);
          }
          if (matchesDose && matchesDose[1]) {
            doseMg = parseFloat(matchesDose[1]);
          }

          // Determine frequency using the robust visual equivalence mapping
          let frequency = 1;
          const hasBD = lineWords.some((w) =>
            ['bd', 'bid', 'twice', 'bl', 'b1', 'bo', 'bd5', 'rfy', '8l'].includes(w)
          );
          const hasTDS = lineWords.some((w) =>
            ['tds', 'tid', 'three', 'td5', 't18', 'tds5', 'td', 'tles'].includes(w)
          );
          const hasQDS = lineWords.some((w) => ['qds', 'qid', 'four', 'qd5'].includes(w));

          if (hasBD) {
            frequency = 2;
          } else if (hasTDS) {
            frequency = 3;
          } else if (hasQDS) {
            frequency = 4;
          }

          const calculatedDailyDose = doseMg * frequency;
          combinedDailyDoseMg += calculatedDailyDose;
          combinedMaxDailyDoseMg += d.max_daily_dose_mg;

          if (d.max_daily_dose_mg > 0 && calculatedDailyDose > d.max_daily_dose_mg) {
            verdict = 'DANGER';
            messages.push(
              `Daily dose (${calculatedDailyDose}mg) exceeds maximum guideline limit (${d.max_daily_dose_mg}mg) for ${d.generic_name}.`
            );
          } else if (d.requires_pregnancy_check === 1 || d.requires_renal_check === 1) {
            if (verdict !== 'DANGER') verdict = 'WARNING';
            messages.push(
              `Active contraindication: ${
                d.requires_pregnancy_check === 1 ? 'pregnancy check required' : ''
              }${
                d.requires_pregnancy_check === 1 && d.requires_renal_check === 1 ? ' & ' : ''
              }${d.requires_renal_check === 1 ? 'renal clearance check required' : ''} for ${
                d.generic_name
              }.`
            );
          }
        }
      }

      // 2. Dynamically check drug-drug interactions via SQLite queries
      const matchedDrugs = matches.filter((m) => m && m.matched && m.data);
      for (let i = 0; i < matchedDrugs.length; i++) {
        for (let j = i + 1; j < matchedDrugs.length; j++) {
          const atcA = matchedDrugs[i].data.atc_code;
          const atcB = matchedDrugs[j].data.atc_code;
          if (!atcA || !atcB) continue;

          // Query SQLite to check if there is an interaction entry
          const interactionRows = await query(
            'SELECT severity, risk_description FROM drug_interactions WHERE (atc_code_a = ? AND atc_code_b = ?) OR (atc_code_a = ? AND atc_code_b = ?)',
            [atcA, atcB, atcB, atcA]
          );

          if (interactionRows && interactionRows.length > 0) {
            const interaction = interactionRows[0];
            const severity = interaction.severity || 'WARNING';
            if (severity === 'DANGER') {
              verdict = 'DANGER';
            } else if (severity === 'WARNING' && verdict !== 'DANGER') {
              verdict = 'WARNING';
            }
            messages.push(`Drug Interaction Warning (${severity}): ${interaction.risk_description}`);
            citations.push('OpenFDA Adverse Interactions');
          }
        }
      }

      if (messages.length === 0) {
        messages.push('Dosage Matches NSTG Guidelines. No Known Interactions.');
      }

      setValidationData({
        genericName: combinedGenericNames.join(' + '),
        requiresPregnancyCheck: combinedRequiresPregnancyCheck,
        requiresRenalCheck: combinedRequiresRenalCheck,
        dailyDoseMg: combinedDailyDoseMg,
        nstgMaxDailyDoseMg: combinedMaxDailyDoseMg,
      });

      // Combine messages and citations for the final verdict
      const message = messages.join(' | ');
      const citation = Array.from(new Set(citations)).join(' ; ');

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
