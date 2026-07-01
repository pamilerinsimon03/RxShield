import React from 'react';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { Tag } from 'lucide-react';

/**
 * ExtractionBadges component displays the pill tray of tokens extracted
 * by the prescription scanning workflow.
 */
export const ExtractionBadges: React.FC = () => {
  const { state } = useWorkflowState();
  const { phase, extractedTokens } = state;

  const isLoading = phase === 'EXTRACTION';

  /**
   * Identifies candidate drug names by checking that the token has no digits
   * and is not a known frequency code.
   */
  const isDrugName = (token: string) => {
    const cleanToken = token.trim().toLowerCase();
    const isFreq = ['tds', 'bd', 'qds', 'daily', 'bid', 'tid', 'qid', 'twice', 'three', 'four'].includes(cleanToken);
    const hasDigits = /\d/.test(cleanToken);
    return !hasDigits && !isFreq;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-trust-teal" />
          Prescription Summary Pill Tray
        </span>
        {isLoading && (
          <span className="text-[10px] font-mono font-bold text-trust-teal animate-pulse uppercase tracking-wide">
            Extracting Tokens...
          </span>
        )}
      </div>

      <div 
        className={`flex-1 flex flex-wrap gap-2 items-center p-3.5 rounded-xl overflow-y-auto transition-all duration-300 min-h-[60px] ${
          isLoading ? 'bg-teal-50/20 border border-dashed border-trust-teal/30' : 'bg-slate-50/50 border border-slate-100'
        }`}
      >
        {extractedTokens.length > 0 ? (
          extractedTokens.map((token, idx) => {
            const isDrug = isDrugName(token);
            return (
              <span
                key={idx}
                className={`text-xs px-3.5 py-1.5 rounded-full transition-all duration-300 font-mono ${
                  isLoading 
                    ? 'bg-trust-teal/10 text-trust-teal/80 border border-trust-teal/20 animate-pulse'
                    : isDrug
                    ? 'bg-trust-teal/10 text-trust-teal font-bold border border-trust-teal/20'
                    : 'bg-slate-100 text-slate-600 font-medium border border-slate-200/50'
                }`}
              >
                {token}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-slate-400 italic">
            Awaiting text line extraction...
          </span>
        )}
      </div>
    </div>
  );
};
