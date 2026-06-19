import React from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { Tag } from 'lucide-react';

export const ExtractionBadges: React.FC = () => {
  const { state } = useWorkflowState();
  const { phase, extractedTokens } = state;

  const isLoading = phase === 'EXTRACTION';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <span className="text-xs font-bold text-slate-900 uppercase flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-blue-600" />
          Extracted Prescription Tokens
        </span>
        {isLoading && (
          <span className="text-[10px] font-mono font-bold text-blue-600 animate-pulse uppercase">
            Parsing Tokens...
          </span>
        )}
      </div>

      <div 
        className={`flex-1 flex flex-wrap gap-2 items-center p-3 rounded-md overflow-y-auto transition-colors duration-200 ${
          isLoading ? 'bg-blue-100/50 border border-dashed border-blue-200' : 'bg-slate-50 border border-slate-100'
        }`}
      >
        {extractedTokens.length > 0 ? (
          extractedTokens.map((token, idx) => (
            <span
              key={idx}
              className={`text-lg font-mono font-medium px-3 py-1 rounded-sm shadow-sm transition-all duration-300 ${
                isLoading 
                  ? 'bg-blue-100 text-blue-800 border border-blue-200 animate-pulse'
                  : 'bg-blue-600 text-white border border-blue-700 scale-100'
              }`}
            >
              {token}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-600 italic">
            Awaiting text line extraction...
          </span>
        )}
      </div>
    </div>
  );
};
