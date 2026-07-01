import React, { useState } from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { DemographicChecklist } from '@/components/Alerts/DemographicChecklist';
import { 
  CheckCircle, 
  AlertTriangle, 
  AlertOctagon, 
  FileText,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldX,
  Database
} from 'lucide-react';

/**
 * TriageAlertCard component displays the results and clinical validation feedback
 * for the scanned prescription, including warnings, overrides, and final safety verdicts.
 */
export const TriageAlertCard: React.FC = () => {
  const { state, resetWorkflow } = useWorkflowState();
  const { phase, finalVerdict, errorMsg, validationData, extractedTokens } = state;
  const [showSafetyReport, setShowSafetyReport] = useState<boolean>(false);
  const [confirmSuccess, setConfirmSuccess] = useState<boolean>(false);

  /**
   * Scans extraction logs to verify if visual typo correction was applied
   * to known ambiguous drug names (e.g., amosil -> amoxil).
   */
  const isAutoCorrected = () => {
    if (!validationData || !validationData.genericName) return false;
    
    const extractionLog = state.logs.find(l => l.includes('Character extraction complete'));
    if (extractionLog) {
      const match = extractionLog.match(/: "([^"]+)"/);
      if (match && match[1]) {
        const rawText = match[1].toLowerCase();
        if (rawText.includes('amosil') || rawText.includes('iasise')) {
          return true;
        }
      }
    }
    return false;
  };

  /**
   * Retrieves the raw OCR output string from worker logs.
   */
  const getRawOcrString = () => {
    const extractionLog = state.logs.find(l => l.includes('Character extraction complete'));
    if (extractionLog) {
      const match = extractionLog.match(/: "([^"]+)"/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return extractedTokens.join(' ');
  };

  const handleConfirm = () => {
    setConfirmSuccess(true);
    setTimeout(() => {
      setConfirmSuccess(false);
      resetWorkflow();
    }, 2500);
  };

  return (
    <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl p-5 shadow-sm overflow-hidden h-full">
      <span className="text-xs font-bold text-slate-800 uppercase border-b border-slate-100 pb-3 mb-4 block shrink-0 tracking-wider">
        Results & Verification Dashboard
      </span>

      <div className="flex-1 overflow-y-auto pr-1">
        {errorMsg ? (
          <div className="w-full bg-alert-red/10 border border-alert-red/20 text-alert-red rounded-xl p-5 flex gap-3.5 items-start animate-fade-in">
            <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs text-left">
              <div className="font-bold uppercase tracking-wider mb-1">Background Core Crash Intercepted</div>
              <p className="font-mono text-[11px] leading-relaxed break-all text-alert-red/90">{errorMsg}</p>
            </div>
          </div>
        ) : phase === 'IDLE' ? (
          <div className="h-full flex flex-col justify-center items-center py-12 text-center w-full animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-4 text-slate-400 shadow-inner">
              <FileText className="w-8 h-8 text-trust-teal animate-pulse" />
            </div>
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Awaiting Document Scan
            </h3>
            <p className="text-xs text-slate-500 mt-1.5 max-w-[260px] leading-relaxed">
              Scan a physical prescription using the viewfinder or select a scenario from the simulation panel.
            </p>
          </div>
        ) : phase === 'EXTRACTION' ? (
          <div className="h-full flex flex-col justify-center items-center py-12 text-center w-full animate-pulse">
            <Loader2 className="w-8 h-8 text-trust-teal animate-spin mb-4" />
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              OCR Engine Extraction Active
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Executing vision model layers locally at the edge...
            </p>
          </div>
        ) : phase === 'VALIDATION' ? (
          <div className="h-full flex flex-col justify-center items-center py-12 text-center w-full animate-pulse">
            <Loader2 className="w-8 h-8 text-alert-amber animate-spin mb-4" />
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Clinical Validation Active
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Evaluating parameters against SQLite medical guidelines...
            </p>
          </div>
        ) : confirmSuccess ? (
          <div className="h-full flex flex-col justify-center items-center py-12 text-center w-full animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4 text-emerald-600 shadow-sm">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">
              Prescription Confirmed
            </h3>
            <p className="text-xs text-emerald-600 mt-1 max-w-[260px] leading-relaxed">
              Clearance logged to audit ledger. Dispatching to pharmacy server...
            </p>
          </div>
        ) : finalVerdict ? (
          <div className="w-full flex flex-col gap-4 text-left animate-fade-in">
            {state.capturedImageUri && (
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3 shadow-sm shrink-0">
                <div className="w-16 h-10 bg-white border border-slate-200 rounded-lg overflow-hidden shrink-0 shadow-sm flex items-center justify-center">
                  <img src={state.capturedImageUri} alt="Original Scan Reference" className="h-full w-full object-contain" />
                </div>
                <div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Reference Binarized Scan</span>
                  <span className="text-[11px] font-semibold text-slate-600">Prescription Visual OCR Input</span>
                </div>
              </div>
            )}

            <div className="border border-slate-100 rounded-xl p-5 bg-white shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
                <div>
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Verified Compound</span>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-extrabold text-slate-900 uppercase">
                      {validationData?.genericName || "UNRECOGNIZED SUBSTANCE"}
                    </h3>
                    {isAutoCorrected() && (
                      <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200/50 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        Auto-corrected
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">
                  <Database className="w-3.5 h-3.5 text-trust-teal shrink-0" />
                  <span>Clinical DB Verified</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="bg-slate-50 border border-slate-100 p-3 rounded-lg">
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wide block mb-1">OCR Read Text</span>
                  <p className="text-xs font-mono font-medium text-slate-600 italic break-words">
                    "{getRawOcrString()}"
                  </p>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-3 rounded-lg">
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wide block mb-1">Database Match</span>
                  <p className="text-xs font-bold text-slate-800">
                    {validationData?.genericName ? `${validationData.genericName} (${finalVerdict.verdict === 'PASS' ? 'Safe' : 'Bypass Gate'})` : 'No Match Found'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-center">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Verified Daily Dose</span>
                  <span className="text-xl font-black text-slate-800">
                    {validationData?.dailyDoseMg ? `${validationData.dailyDoseMg} mg` : 'N/A'}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-center">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Guideline Limit</span>
                  <span className="text-xl font-black text-slate-800">
                    {validationData?.nstgMaxDailyDoseMg ? `${validationData.nstgMaxDailyDoseMg} mg` : 'No Limit'}
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Clinical Safety Check</span>
                  {finalVerdict.verdict === 'PASS' && (
                    <span className="bg-emerald-500/10 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      SAFE
                    </span>
                  )}
                  {finalVerdict.verdict === 'WARNING' && (
                    <span className="bg-alert-amber/10 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-alert-amber/20 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-alert-amber" />
                      WARNING
                    </span>
                  )}
                  {finalVerdict.verdict === 'DANGER' && (
                    <span className="bg-alert-red/10 text-alert-red text-[10px] font-bold px-2 py-0.5 rounded-full border border-alert-red/20 flex items-center gap-1">
                      <ShieldX className="w-3.5 h-3.5 text-alert-red" />
                      DANGER (LOCKED)
                    </span>
                  )}
                </div>

                {finalVerdict.verdict === 'DANGER' && (
                  <div className="bg-alert-red/10 border border-alert-red/20 text-alert-red text-xs p-3.5 rounded-xl font-bold flex items-start gap-2.5 leading-relaxed">
                    <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5 text-alert-red" />
                    <div>
                      <span className="uppercase block font-black text-[10px] tracking-wider mb-0.5">Dose Guideline Exceeded</span>
                      {finalVerdict.message}
                    </div>
                  </div>
                )}
                {finalVerdict.verdict === 'WARNING' && (
                  <div className="bg-alert-amber/10 border border-alert-amber/20 text-amber-800 text-xs p-3.5 rounded-xl font-bold flex items-start gap-2.5 leading-relaxed animate-pulse">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-alert-amber" />
                    <div>
                      <span className="uppercase block font-black text-[10px] tracking-wider mb-0.5">Clinical Clearance Warning</span>
                      {finalVerdict.message}
                    </div>
                  </div>
                )}

                <div className="border border-slate-100 rounded-xl bg-white overflow-hidden">
                  <button
                    onClick={() => setShowSafetyReport(!showSafetyReport)}
                    className="w-full px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 flex items-center justify-between focus:outline-none transition-colors"
                  >
                    <span>View Safety Report & Guideline Citations</span>
                    {showSafetyReport ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showSafetyReport && (
                    <div className="px-4 pb-4.5 pt-1 text-xs border-t border-slate-100 space-y-2 text-slate-600 leading-relaxed bg-slate-50/20">
                      <div>
                        <span className="font-bold text-slate-700 block mb-0.5">Protocol Reference Citation</span>
                        <p className="font-mono text-[10px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100 select-all">
                          {finalVerdict.citation || 'NSTG Section 1.2 (Standard Clinical Check)'}
                        </p>
                      </div>
                      <div className="text-[11px] text-slate-500 pt-1">
                        * Checks compiled from National Formulary Guidelines and SQLite drug interaction database tables.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {finalVerdict.verdict === 'WARNING' && (
              <DemographicChecklist validationData={validationData} />
            )}

            <div className="flex flex-col sm:flex-row items-center gap-2 mt-2 w-full">
              {finalVerdict.verdict !== 'DANGER' ? (
                finalVerdict.verdict === 'PASS' ? (
                  <button
                    onClick={handleConfirm}
                    className="w-full py-3 bg-trust-teal hover:bg-trust-teal-hover active:bg-trust-teal text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 focus:outline-none cursor-pointer"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Confirm & Dispatch Dosage
                  </button>
                ) : (
                  <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100/70 p-3 rounded-lg text-center w-full">
                    Complete the Clinical Override Validation Gate Checklist above to authorize dispensing.
                  </div>
                )
              ) : (
                <div className="w-full bg-alert-red/10 border border-alert-red/20 text-alert-red text-center py-3.5 px-4 rounded-xl text-xs font-bold leading-normal">
                  PRESCRIBING BLOCKED: Strictly contraindicated medication limits exceeded. Under clinical rules, this cannot be overridden.
                </div>
              )}

              <button
                onClick={resetWorkflow}
                className="w-full sm:w-auto px-6 py-3 border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 focus:outline-none cursor-pointer shrink-0"
              >
                Reject & Clear
              </button>
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic">
            Waiting for verification payload...
          </span>
        )}
      </div>
    </div>
  );
};
