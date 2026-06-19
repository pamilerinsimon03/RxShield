import React from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { Check, ShieldAlert, AlertTriangle, Layers } from 'lucide-react';

export const JudgeSimulationPanel: React.FC = () => {
  const { state, simulatePipelineMock } = useWorkflowState();

  const scenarios = [
    {
      id: 'SCENARIO_A' as const,
      title: 'Scenario A: Standard Pass',
      desc: 'Augmentin 625mg BD (Normal dose)',
      icon: <Check className="w-4 h-4 text-green-600 shrink-0" />,
      colorClass: 'hover:border-green-500 border-slate-200 hover:bg-green-50/20'
    },
    {
      id: 'SCENARIO_B' as const,
      title: 'Scenario B: Pediatric Warning',
      desc: 'Methotrexate 7.5mg Daily (Pregnancy/Renal Check)',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
      colorClass: 'hover:border-amber-500 border-slate-200 hover:bg-amber-50/20'
    },
    {
      id: 'SCENARIO_C' as const,
      title: 'Scenario C: Toxic Interaction',
      desc: 'Clarithromycin + Simvastatin (Lethal block)',
      icon: <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />,
      colorClass: 'hover:border-rose-500 border-slate-200 hover:bg-rose-50/20'
    }
  ];

  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-md p-3 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <Layers className="w-3.5 h-3.5 text-blue-600" />
        <span className="text-xs font-bold text-slate-900 uppercase">
          Pitch Judge Simulation Panel
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {scenarios.map((sc) => (
          <button
            key={sc.id}
            onClick={() => simulatePipelineMock(sc.id)}
            disabled={state.isProcessing}
            className={`flex items-start gap-2.5 border text-left p-2 bg-slate-50/50 hover:bg-slate-50 rounded-md transition-all duration-200 disabled:opacity-50 select-none cursor-pointer focus:outline-none ${sc.colorClass}`}
          >
            <div className="bg-white border border-slate-100 rounded-sm p-1 shadow-sm mt-0.5 shrink-0">
              {sc.icon}
            </div>
            <div className="overflow-hidden">
              <div className="text-[11px] font-bold text-slate-900 leading-tight truncate">
                {sc.title}
              </div>
              <div className="text-[10px] text-slate-600 leading-tight mt-0.5 truncate">
                {sc.desc}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
