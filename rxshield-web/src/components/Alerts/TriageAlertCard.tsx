import React from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { DemographicChecklist } from '@/components/Alerts/DemographicChecklist';
import { 
  CheckCircle, 
  AlertTriangle, 
  AlertOctagon, 
  FileText,
  Loader2
} from 'lucide-react';

export const TriageAlertCard: React.FC = () => {
  const { state } = useWorkflowState();
  const { phase, finalVerdict, errorMsg } = state;

  return (
    <div className="h-56 sm:h-64 md:h-auto md:flex-1 bg-white border border-slate-200 rounded-md shadow-sm p-4 flex flex-col overflow-hidden">
      <span className="text-xs font-bold text-slate-900 uppercase border-b border-slate-100 pb-2 mb-2 block shrink-0">
        Clinical Triage Alert Panel
      </span>

      <div className="flex-1 flex items-center justify-center p-1 overflow-y-auto w-full">
        {errorMsg ? (
          <div className="w-full bg-rose-700 text-white rounded-md p-4 flex gap-3 items-start border border-rose-800 animate-pulse">
            <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs text-left">
              <div className="font-bold uppercase tracking-wider mb-1">Worker Crash Intercepted</div>
              <p className="font-mono text-[11px] leading-relaxed break-all">{errorMsg}</p>
            </div>
          </div>
        ) : phase === 'IDLE' ? (
          <div className="flex-1 flex flex-col justify-center items-center p-6 text-center w-full animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 text-slate-400">
              <FileText className="w-6 h-6 animate-pulse" />
            </div>
            <div className="text-sm font-bold text-slate-700 uppercase tracking-wide">
              Awaiting document scan...
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-[260px] leading-relaxed">
              Scan a physical prescription using the viewfinder or select a pitch simulation scenario below.
            </p>
          </div>
        ) : phase === 'EXTRACTION' ? (
          <div className="flex-1 flex flex-col justify-center items-center p-6 animate-pulse text-center w-full">
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                OCR Processing
              </span>
            </div>
            <div className="w-full max-w-[200px] space-y-2 mb-4">
              <div className="h-3 bg-slate-200 rounded-full w-full"></div>
              <div className="h-3 bg-slate-200 rounded-full w-5/6"></div>
            </div>
            <div className="text-sm font-bold text-slate-700 uppercase tracking-wide">
              Extracting text tokens...
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Executing vision model layers locally...
            </p>
          </div>
        ) : phase === 'VALIDATION' ? (
          <div className="flex-1 flex flex-col justify-center items-center p-6 animate-pulse text-center w-full">
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="w-5 h-5 text-amber-500 animate-spin shrink-0" />
              <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
                Validation Active
              </span>
            </div>
            <div className="w-full max-w-[200px] space-y-2 mb-4">
              <div className="h-3 bg-slate-200 rounded-full w-full"></div>
              <div className="h-3 bg-slate-200 rounded-full w-3/4"></div>
              <div className="h-3 bg-slate-200 rounded-full w-5/6"></div>
            </div>
            <div className="text-sm font-bold text-slate-700 uppercase tracking-wide">
              Running guideline validations...
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Evaluating parameters against local SQLite clinical rules...
            </p>
          </div>
        ) : finalVerdict ? (
          <div className="w-full h-full flex flex-col">
            {finalVerdict.verdict === 'PASS' && (
              <div className="w-full bg-green-600 text-white border border-green-700 rounded-md p-4 flex gap-3 items-start animate-fade-in shadow-sm">
                <CheckCircle className="w-5 h-5 shrink-0 mt-0.5 text-white" />
                <div className="text-xs text-left">
                  <div className="font-bold uppercase tracking-wider mb-1">
                    Safety Verdict: PASS
                  </div>
                  <p className="font-medium mb-2 leading-relaxed">{finalVerdict.message}</p>
                  {finalVerdict.citation && (
                    <div className="font-mono text-[10px] text-green-100 bg-green-700/50 px-2 py-0.5 rounded-sm inline-block border border-green-800/30">
                      Citation: {finalVerdict.citation}
                    </div>
                  )}
                </div>
              </div>
            )}

            {finalVerdict.verdict === 'WARNING' && (
              <div className="w-full bg-amber-500 text-black border border-amber-600 rounded-md p-4 flex flex-col gap-3 items-start animate-fade-in shadow-sm">
                <div className="flex gap-3 items-start w-full">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-black" />
                  <div className="text-xs text-left">
                    <div className="font-bold uppercase tracking-wider mb-1">
                      Safety Verdict: WARNING
                    </div>
                    <p className="font-medium mb-2 leading-relaxed">{finalVerdict.message}</p>
                    {finalVerdict.citation && (
                      <div className="font-mono text-[10px] text-black/80 bg-black/10 px-2 py-0.5 rounded-sm inline-block">
                        Citation: {finalVerdict.citation}
                      </div>
                    )}
                  </div>
                </div>
                
                <DemographicChecklist validationData={state.validationData} />
              </div>
            )}

            {finalVerdict.verdict === 'DANGER' && (
              <div className="w-full bg-rose-700 text-white border border-rose-800 rounded-md p-4 flex gap-3 items-start animate-fade-in shadow-sm">
                <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5 text-white" />
                <div className="text-xs text-left">
                  <div className="font-bold uppercase tracking-wider mb-1">
                    Safety Verdict: DANGER (LOCKED)
                  </div>
                  <p className="font-medium mb-2 leading-relaxed">{finalVerdict.message}</p>
                  
                  <div className="bg-rose-800/80 p-2.5 rounded border border-rose-900/40 text-[11px] leading-relaxed mb-2 text-rose-100">
                    <span className="font-bold text-white uppercase block mb-0.5">Clinical Restriction Blocked:</span>
                    This prescription has been locked. Under guideline regulations, this medication pair or dosage is strictly contraindicated and cannot be processed or overridden.
                  </div>

                  {finalVerdict.citation && (
                    <div className="font-mono text-[10px] text-rose-200 bg-rose-900/40 px-2 py-0.5 rounded-sm inline-block border border-rose-900/30">
                      Citation: {finalVerdict.citation}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-600 italic">
            Waiting for diagnostic payload...
          </span>
        )}
      </div>
    </div>
  );
};
