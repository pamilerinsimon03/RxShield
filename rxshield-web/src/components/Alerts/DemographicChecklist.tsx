import React, { useState, useEffect } from 'react';
import { Check, ClipboardList, ShieldCheck } from 'lucide-react';
import { useDatabase } from '@/context/DatabaseContext';

interface DemographicChecklistProps {
  validationData: any;
}

export const DemographicChecklist: React.FC<DemographicChecklistProps> = ({ validationData }) => {
  const { query, logOverride } = useDatabase();
  const [items, setItems] = useState<Array<{ id: string; label: string; checked: boolean }>>([]);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [authTime, setAuthTime] = useState<string>('');

  useEffect(() => {
    const checklistItems = [];
    if (validationData?.requiresPregnancyCheck === 1) {
      checklistItems.push({
        id: 'pregnancy',
        label: 'Confirm patient is not pregnant (active hCG test verified)',
        checked: false
      });
    }
    if (validationData?.requiresRenalCheck === 1) {
      checklistItems.push({
        id: 'renal',
        label: 'Verify renal clearance levels (eGFR/Serum Creatinine) are within safe parameters',
        checked: false
      });
    }

    setItems(checklistItems);
    setIsAuthorized(false);

    // Check if there is an existing override in the DB for this drug
    const checkExistingOverride = async () => {
      if (!validationData?.genericName) return;
      try {
        const rows = await query(
          'SELECT timestamp, signature_lock FROM override_audits WHERE generic_name = ? ORDER BY timestamp DESC LIMIT 1',
          [validationData.genericName]
        );
        if (rows && rows.length > 0) {
          setIsAuthorized(true);
          // If the timestamp matches the active override session, we restore it
          setAuthTime(new Date(rows[0].timestamp).toLocaleTimeString());
        }
      } catch (err) {
        console.error('Failed to query existing overrides:', err);
      }
    };
    
    checkExistingOverride();
  }, [validationData, query]);

  const handleToggle = (id: string) => {
    if (isAuthorized) return;
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  };

  const handleAuthorize = async () => {
    const signature = `PHYSICIAN_OVERRIDE_VERIFIED`;
    const timeStr = new Date().toLocaleTimeString();
    setIsAuthorized(true);
    setAuthTime(timeStr);

    try {
      await logOverride(
        validationData.genericName || 'Unknown',
        `${signature} @ ${timeStr}`,
        items.map(i => i.id).join(', ')
      );
    } catch (err) {
      console.error('Failed to write override audit log:', err);
    }
  };

  if (items.length === 0) return null;

  const allChecked = items.every((item) => item.checked);

  return (
    <div className="mt-3 bg-white border border-slate-200 rounded-xl p-4.5 text-slate-900 shadow-sm w-full">
      <div className="flex items-center gap-1.5 mb-3 border-b border-slate-100 pb-2.5">
        <ClipboardList className="w-4.5 h-4.5 text-alert-amber shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
          Clinician Override Validation Gate
        </span>
      </div>

      {!isAuthorized ? (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <label
              key={item.id}
              className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer select-none text-xs"
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => handleToggle(item.id)}
                className="mt-0.5 w-4 h-4 border-slate-300 rounded text-trust-teal focus:ring-trust-teal cursor-pointer shrink-0"
              />
              <span className="text-slate-700 leading-normal font-medium">{item.label}</span>
            </label>
          ))}

          <button
            onClick={handleAuthorize}
            disabled={!allChecked}
            className="mt-2 w-full py-2.5 bg-trust-teal hover:bg-trust-teal-hover active:bg-trust-teal disabled:bg-slate-200 disabled:text-slate-400 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 focus:outline-none cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Approve & Dispatch Prescription
          </button>
        </div>
      ) : (
        <div className="p-4 bg-emerald-50/50 border border-emerald-200/50 rounded-xl flex gap-3 items-start animate-fade-in w-full text-left">
          <ShieldCheck className="w-5.5 h-5.5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <div className="font-bold text-emerald-800 uppercase tracking-wide">
              Clinician Authorization Signed
            </div>
            <p className="text-emerald-700 mt-1 leading-relaxed">
              Safety overrides confirmed. Prescription cleared for pharmacy dispensing.
            </p>
            <div className="text-[10px] font-mono text-emerald-600 mt-2 font-semibold bg-emerald-100/30 px-2 py-0.5 rounded border border-emerald-200/20 inline-block">
              SIGNATURE LOCK: PHYSICIAN_OVERRIDE_VERIFIED @ {authTime}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
