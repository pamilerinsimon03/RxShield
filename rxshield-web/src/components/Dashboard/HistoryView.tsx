import React, { useEffect, useState } from 'react';
import { useDatabase } from '@/context/DatabaseContext';
import { Clock, ShieldCheck, FileText } from 'lucide-react';

interface OverrideAudit {
  id: number;
  timestamp: string;
  generic_name: string;
  signature_lock: string;
  overridden_checks: string;
}

/**
 * HistoryView component renders a timeline of past prescription overrides
 * and safety audit signatures from the local database, appending fallback mock data.
 */
export const HistoryView: React.FC = () => {
  const { query, isDbReady } = useDatabase();
  const [audits, setAudits] = useState<OverrideAudit[]>([]);
  const [loading, setLoading] = useState(true);

  const mockAudits: OverrideAudit[] = [
    {
      id: -1,
      timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      generic_name: 'AMOXIL (AMOXICILLIN)',
      signature_lock: 'PHYSICIAN_OVERRIDE_VERIFIED @ 10:24:12 AM',
      overridden_checks: 'dosage'
    },
    {
      id: -2,
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      generic_name: 'METHOTREXATE',
      signature_lock: 'PHYSICIAN_OVERRIDE_VERIFIED @ 3:15:44 PM',
      overridden_checks: 'pregnancy, renal'
    },
    {
      id: -3,
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      generic_name: 'AUGMENTIN (CO-AMOXICLAV)',
      signature_lock: 'PHYSICIAN_OVERRIDE_VERIFIED @ 9:02:10 AM',
      overridden_checks: 'dosage'
    }
  ];

  useEffect(() => {
    const fetchAudits = async () => {
      if (!isDbReady) {
        setAudits(mockAudits);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const rows = await query(
          'SELECT id, timestamp, generic_name, signature_lock, overridden_checks FROM override_audits ORDER BY timestamp DESC'
        );
        
        const dbAudits = rows.map((r: any) => ({
          id: r.id,
          timestamp: r.timestamp,
          generic_name: r.generic_name,
          signature_lock: r.signature_lock,
          overridden_checks: r.overridden_checks
        }));
        
        setAudits([...dbAudits, ...mockAudits]);
      } catch (err) {
        console.error('Failed to query override audits:', err);
        setAudits(mockAudits);
      } finally {
        setLoading(false);
      }
    };

    fetchAudits();
  }, [isDbReady, query]);

  /**
   * Helper function to format ISO timestamps into localized dates.
   */
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl p-5 shadow-sm overflow-hidden h-full">
      <div className="flex items-center gap-2 mb-4 shrink-0 border-b border-slate-100 pb-3">
        <div className="w-8 h-8 bg-trust-teal/10 rounded-lg flex items-center justify-center text-trust-teal">
          <Clock className="w-4.5 h-4.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            Verification & Override History
          </h2>
          <p className="text-[10px] text-slate-500 font-medium">
            Audit logs of clinician authorizations and safety clearances
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && audits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <div className="w-8 h-8 border-2 border-trust-teal border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-xs font-semibold uppercase tracking-wider">Loading Audit History...</span>
          </div>
        ) : audits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-center">
            <FileText className="w-12 h-12 text-slate-300 mb-3" />
            <span className="text-xs font-bold text-slate-700 uppercase">No verification records found</span>
            <p className="text-[10px] text-slate-500 max-w-[200px] mt-1">
              Authorized overrides will appear here for audit logging.
            </p>
          </div>
        ) : (
          <div className="relative border-l border-slate-100 pl-4 ml-3 py-2 space-y-5">
            {audits.map((audit) => (
              <div key={audit.id} className="relative group">
                <div className="absolute -left-[24.5px] top-1 w-4 h-4 rounded-full bg-white border-2 border-trust-teal flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-trust-teal" />
                </div>

                <div className="bg-slate-50/50 hover:bg-slate-50 border border-slate-100/70 p-4 rounded-xl shadow-sm transition-all duration-300">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      {audit.generic_name}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                      {formatDate(audit.timestamp)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-semibold bg-white border border-slate-100 px-2.5 py-1 rounded-lg">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>
                        Override Checklist Checked:{' '}
                        <span className="text-slate-900 font-bold font-mono">
                          {audit.overridden_checks || 'standard validation'}
                        </span>
                      </span>
                    </div>

                    <div className="text-[10px] font-mono font-bold text-trust-teal/90 uppercase tracking-wide mt-0.5">
                      {audit.signature_lock}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
