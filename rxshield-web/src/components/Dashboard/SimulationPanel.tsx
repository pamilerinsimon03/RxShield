import React from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { Check, ShieldAlert, AlertTriangle, PlayCircle } from 'lucide-react';

export const SimulationPanel: React.FC = () => {
  const { state, simulatePipelineMock } = useWorkflowState();

  const scenarios = [
    {
      id: 'SCENARIO_A' as const,
      title: 'Scenario A: Standard Pass',
      desc: 'Augmentin 625mg BD (Normal dose)',
      icon: <Check className="w-5 h-5 text-emerald-600 shrink-0" />,
      colorClass: 'hover:border-emerald-500 hover:bg-emerald-50/10 border-slate-200'
    },
    {
      id: 'SCENARIO_B' as const,
      title: 'Scenario B: Pediatric Warning',
      desc: 'Methotrexate 7.5mg Daily (Pregnancy/Renal Check)',
      icon: <AlertTriangle className="w-5 h-5 text-alert-amber shrink-0" />,
      colorClass: 'hover:border-alert-amber hover:bg-amber-50/15 border-slate-200'
    },
    {
      id: 'SCENARIO_C' as const,
      title: 'Scenario C: Toxic Interaction',
      desc: 'Clarithromycin + Simvastatin (Lethal block)',
      icon: <ShieldAlert className="w-5 h-5 text-alert-red shrink-0" />,
      colorClass: 'hover:border-alert-red hover:bg-red-50/10 border-slate-200'
    }
  ];

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-5 flex flex-col shadow-sm">
      <div className="flex items-center gap-2 mb-3.5 shrink-0">
        <div className="w-7 h-7 bg-trust-teal/10 rounded-lg flex items-center justify-center text-trust-teal">
          <PlayCircle className="w-4 h-4" />
        </div>
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Simulation Panel
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
        {scenarios.map((sc) => (
          <button
            key={sc.id}
            onClick={() => simulatePipelineMock(sc.id)}
            disabled={state.isProcessing}
            className={`flex items-start gap-3 border text-left p-3.5 bg-slate-50/30 hover:bg-white rounded-xl shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.99] transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer focus:outline-none ${sc.colorClass}`}
          >
            <div className="bg-white border border-slate-100 rounded-lg p-1.5 shadow-sm mt-0.5 shrink-0">
              {sc.icon}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-slate-900 leading-tight">
                {sc.title}
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed mt-1 font-medium">
                {sc.desc}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
