import React from 'react';
import { CameraViewfinder } from '@/components/Camera/CameraViewfinder';
import { ExtractionBadges } from '@/components/Dashboard/ExtractionBadges';
import { JudgeSimulationPanel } from '@/components/Dashboard/JudgeSimulationPanel';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { 
  Play, 
  RefreshCw, 
  AlertOctagon, 
  Cpu, 
  Database
} from 'lucide-react';
import { TriageAlertCard } from '@/components/Alerts/TriageAlertCard';

export const MainLayout: React.FC = () => {
  const { state, resetWorkflow, runMockInference, triggerCrash } = useWorkflowState();

  const getStatusColorClass = (phase: string) => {
    switch (phase) {
      case 'IDLE':
        return 'bg-slate-100 text-slate-600';
      case 'EXTRACTION':
        return 'bg-blue-100 text-blue-800 animate-pulse';
      case 'VALIDATION':
        return 'bg-amber-100 text-amber-800 animate-pulse';
      case 'COMPLETE':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <div className="min-h-screen md:h-screen w-screen bg-slate-50 font-sans flex flex-col md:overflow-hidden text-slate-900">
      {/* Top Header Bar */}
      <header className="border-b border-slate-200 bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 sm:px-6 shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-blue-600 rounded-sm flex items-center justify-center text-white font-bold text-sm">
            Rx
          </div>
          <span className="text-sm font-bold uppercase tracking-wider text-slate-900">
            RxShield Edge Core
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 rounded-sm text-slate-600">
            v0.1.1-alpha
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">State:</span>
            <span className={`text-[10px] px-2.5 py-0.5 rounded-sm font-mono font-bold uppercase ${getStatusColorClass(state.phase)}`}>
              {state.phase}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={runMockInference}
              disabled={state.isProcessing}
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center gap-1 transition-colors focus:outline-none"
            >
              <Play className="w-3 h-3" />
              Mock
            </button>
            <button
              onClick={triggerCrash}
              disabled={state.isProcessing}
              className="px-2.5 py-1 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center gap-1 transition-colors focus:outline-none"
            >
              <AlertOctagon className="w-3 h-3" />
              Crash
            </button>
            <button
              onClick={resetWorkflow}
              className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded-md flex items-center gap-1 transition-colors focus:outline-none"
            >
              <RefreshCw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>
      </header>

      {/* Main Structural Grid Container */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 p-4 gap-4 overflow-y-auto md:overflow-hidden min-h-0">
        
        {/* Primary Extraction Zone (Left Panel) */}
        <section className="flex flex-col gap-4 shrink-0 md:shrink md:flex-1 min-h-0">
          {/* Viewfinder Panel */}
          <div className="h-72 sm:h-[400px] md:h-auto md:flex-1 bg-white border border-slate-200 rounded-md shadow-sm p-4 flex flex-col justify-between overflow-hidden">
            <CameraViewfinder />
          </div>

          {/* Extracted Badges Panel */}
          <div className="h-32 shrink-0 bg-white border border-slate-200 rounded-md shadow-sm p-4 flex flex-col overflow-hidden">
            <ExtractionBadges />
          </div>

          {/* Judge Simulation Panel */}
          <div className="shrink-0">
            <JudgeSimulationPanel />
          </div>
        </section>

        {/* Diagnostic Feedback Zone (Right Panel) */}
        <section className="flex flex-col gap-4 shrink-0 md:shrink md:flex-1 min-h-0">
          <TriageAlertCard />

          {/* Log Console Panel */}
          <div className="h-48 bg-slate-900 text-slate-300 border border-slate-950 rounded-md p-4 flex flex-col overflow-hidden shadow-inner">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-blue-500" />
                Web Worker Message Stream
              </span>
              <Database className="w-3.5 h-3.5 text-slate-500" />
            </div>
            
            <div className="flex-1 font-mono text-[10px] overflow-y-auto flex flex-col gap-1.5 scrollbar-thin">
              {state.logs.length > 0 ? (
                state.logs.map((log, idx) => (
                  <div key={idx} className="border-b border-slate-800/40 pb-1.5 last:border-0 text-slate-300">
                    <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span> {log}
                  </div>
                ))
              ) : (
                <span className="text-slate-600 italic">Console ready. Awaiting events...</span>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
};
