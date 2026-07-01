import React, { useState, useEffect } from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { Settings, Shield, Cpu, RefreshCw, ToggleLeft, ToggleRight, Check } from 'lucide-react';

/**
 * SettingsView component allows clinicians to customize safety triage thresholds,
 * local vs cloud OCR priority, synchronization, and run developer simulations.
 */
export const SettingsView: React.FC = () => {
  const { state, runMockInference, triggerCrash, resetWorkflow } = useWorkflowState();
  const [threshold, setThreshold] = useState<number>(75);
  const [edgeOcrPriority, setEdgeOcrPriority] = useState<string>('parallel');
  const [demographicOverride, setDemographicOverride] = useState<boolean>(true);
  const [syncEnabled, setSyncEnabled] = useState<boolean>(true);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  useEffect(() => {
    const savedThreshold = localStorage.getItem('settings_safety_threshold');
    const savedOcr = localStorage.getItem('settings_ocr_priority');
    const savedDemo = localStorage.getItem('settings_demographic_override');
    const savedSync = localStorage.getItem('settings_sync_enabled');

    if (savedThreshold) setThreshold(parseInt(savedThreshold));
    if (savedOcr) setEdgeOcrPriority(savedOcr);
    if (savedDemo) setDemographicOverride(savedDemo === 'true');
    if (savedSync) setSyncEnabled(savedSync === 'true');
  }, []);

  const handleSave = () => {
    localStorage.setItem('settings_safety_threshold', threshold.toString());
    localStorage.setItem('settings_ocr_priority', edgeOcrPriority);
    localStorage.setItem('settings_demographic_override', demographicOverride.toString());
    localStorage.setItem('settings_sync_enabled', syncEnabled.toString());
    
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl p-5 shadow-sm overflow-hidden h-full">
      <div className="flex items-start gap-2.5 mb-4 shrink-0 border-b border-slate-100 pb-3.5">
        <div className="w-8 h-8 bg-trust-teal/10 rounded-lg flex items-center justify-center text-trust-teal mt-0.5 shrink-0">
          <Settings className="w-4.5 h-4.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            Clinical Configuration
          </h2>
          <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-relaxed">
            Configure local edge safety parameters and OCR settings
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-4">
          <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2 mb-2">
            <Shield className="w-4 h-4 text-trust-teal shrink-0" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Safety Triage Limits
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700">
              <span>Guideline Alert Sensitivity</span>
              <span className="font-mono text-trust-teal font-bold">{threshold}%</span>
            </div>
            <input
              type="range"
              min="20"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-trust-teal"
            />
            <p className="text-[9px] text-slate-500 leading-normal">
              Sets the fuzzy matching confidence limit threshold for clinical compound identification. Higher is stricter.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              <span className="text-xs font-semibold text-slate-700 block">
                Enforce Demographic Clearances
              </span>
              <span className="text-[9px] text-slate-500 leading-tight">
                Locks verification until hCG and eGFR clearance check boxes are checked.
              </span>
            </div>
            <button
              onClick={() => setDemographicOverride(!demographicOverride)}
              className="focus:outline-none text-slate-500 hover:text-slate-700"
            >
              {demographicOverride ? (
                <ToggleRight className="w-9 h-9 text-trust-teal" />
              ) : (
                <ToggleLeft className="w-9 h-9" />
              )}
            </button>
          </div>
        </div>

        <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-4">
          <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2 mb-2">
            <Cpu className="w-4 h-4 text-trust-teal shrink-0" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Edge OCR Processing
            </span>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-semibold text-slate-700 block">
              Inference Mode Selection
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEdgeOcrPriority('local')}
                className={`py-2 px-3 text-[10px] font-bold uppercase rounded-lg border text-center transition-all focus:outline-none ${
                  edgeOcrPriority === 'local'
                    ? 'bg-trust-teal border-trust-teal text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Local Edge-Only
              </button>
              <button
                onClick={() => setEdgeOcrPriority('parallel')}
                className={`py-2 px-3 text-[10px] font-bold uppercase rounded-lg border text-center transition-all focus:outline-none ${
                  edgeOcrPriority === 'parallel'
                    ? 'bg-trust-teal border-trust-teal text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Cloud-Parallel (Race)
              </button>
            </div>
            <p className="text-[9px] text-slate-500 leading-normal">
              Local Edge-Only runs ONNX neural networks fully offline in Web Workers. Cloud-Parallel races with cloud APIs for enhanced accuracy.
            </p>
          </div>
        </div>

        <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-3">
          <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2 mb-1">
            <RefreshCw className="w-4 h-4 text-trust-teal shrink-0" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Data Synchronization
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-700 block">
                Local SQLite Auto-Sync
              </span>
              <span className="text-[9px] text-slate-500 leading-tight">
                Pulls the latest NSTG drug protocols database upon reachability check.
              </span>
            </div>
            <button
              onClick={() => setSyncEnabled(!syncEnabled)}
              className="focus:outline-none text-slate-500 hover:text-slate-700"
            >
              {syncEnabled ? (
                <ToggleRight className="w-9 h-9 text-trust-teal" />
              ) : (
                <ToggleLeft className="w-9 h-9" />
              )}
            </button>
          </div>
        </div>

        <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/20 space-y-3.5">
          <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2 mb-1">
            <Cpu className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Diagnostics & Simulation Panel
            </span>
          </div>

          <p className="text-[9px] text-slate-500 leading-normal mb-2">
            Manually trigger system logic workflows, simulated worker crash states, or pipeline resets.
          </p>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={runMockInference}
              disabled={state.isProcessing}
              className="py-2 px-1 bg-trust-teal hover:bg-trust-teal-hover disabled:opacity-50 text-white text-[10px] font-bold uppercase rounded-lg flex items-center justify-center gap-1 transition-all active:scale-95 focus:outline-none cursor-pointer"
            >
              Mock Run
            </button>
            <button
              onClick={triggerCrash}
              disabled={state.isProcessing}
              className="py-2 px-1 bg-alert-red hover:bg-red-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase rounded-lg flex items-center justify-center gap-1 transition-all active:scale-95 focus:outline-none cursor-pointer"
            >
              Force Crash
            </button>
            <button
              onClick={resetWorkflow}
              className="py-2 px-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold uppercase rounded-lg flex items-center justify-center gap-1 transition-all active:scale-95 focus:outline-none cursor-pointer"
            >
              Reset Core
            </button>
          </div>
        </div>

        <div className="pt-2 shrink-0">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-trust-teal hover:bg-trust-teal-hover active:bg-trust-teal text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 focus:outline-none cursor-pointer shadow-md shadow-trust-teal/10"
          >
            {savedSuccess ? <Check className="w-4 h-4" /> : null}
            {savedSuccess ? 'Settings Saved Successfully' : 'Save Configuration Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
