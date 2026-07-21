import React, { useState, useEffect } from 'react';
import { CameraViewfinder } from '@/components/Camera/CameraViewfinder';
import { ExtractionBadges } from '@/components/Dashboard/ExtractionBadges';
import { SimulationPanel } from '@/components/Dashboard/SimulationPanel';
import { HistoryView } from '@/components/Dashboard/HistoryView';
import { SettingsView } from '@/components/Dashboard/SettingsView';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { TriageAlertCard } from '@/components/Alerts/TriageAlertCard';
import { 
  Camera, 
  ShieldCheck, 
  Clock, 
  Settings as SettingsIcon
} from 'lucide-react';

/**
 * MainLayout component establishes the desktop/mobile sidebar, layout shells,
 * network reachability listeners, and tab transitions based on scanning state.
 */
export const MainLayout: React.FC = () => {
  const { state } = useWorkflowState();
  const [activeTab, setActiveTab] = useState<'scan' | 'verify' | 'history' | 'settings'>('scan');
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (state.phase === 'EXTRACTION' || state.phase === 'VALIDATION' || state.phase === 'COMPLETE') {
      setActiveTab('verify');
    }
  }, [state.phase]);

  const navItems = [
    { id: 'scan' as const, label: 'Scan', icon: <Camera className="w-5 h-5" /> },
    { id: 'verify' as const, label: 'Verify', icon: <ShieldCheck className="w-5 h-5" />, badge: true },
    { id: 'history' as const, label: 'History', icon: <Clock className="w-5 h-5" /> },
    { id: 'settings' as const, label: 'Settings', icon: <SettingsIcon className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen w-screen bg-[#F8F9FA] text-slate-800 font-sans flex flex-col lg:flex-row antialiased overflow-hidden">
      
      <aside className="hidden lg:flex w-64 border-r border-slate-200 bg-white flex-col justify-between shrink-0 h-screen sticky top-0">
        <div className="flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <div className="w-8 h-8 bg-trust-teal rounded-lg flex items-center justify-center text-white font-extrabold text-sm shadow-md shadow-trust-teal/20">
              Rx
            </div>
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-slate-800 block">
                RxShield Core
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.2 bg-slate-100 rounded text-slate-500 font-mono">
                v0.1.1
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all focus:outline-none cursor-pointer relative ${
                  activeTab === item.id
                    ? 'bg-trust-teal/10 text-trust-teal'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge && state.phase === 'COMPLETE' && activeTab !== 'verify' && (
                  <span className="absolute right-4 w-2 h-2 rounded-full bg-alert-red animate-ping" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex flex-col gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3 shadow-sm w-full">
            <div className={`w-2.5 h-2.5 rounded-full shadow-sm shrink-0 ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider select-none truncate">
              {isOnline ? 'Cloud Sync Enabled' : 'Local Edge Core'}
            </span>
          </div>
        </div>
      </aside>

      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 py-3.5 px-4 flex items-center justify-between shadow-sm max-w-xl mx-auto rounded-b-2xl">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-trust-teal rounded-lg flex items-center justify-center text-white font-extrabold text-xs shadow-md shadow-trust-teal/20">
            Rx
          </div>
          <span className="text-xs font-black uppercase tracking-wider text-slate-800">
            RxShield Core
          </span>
          <span className="text-[9px] font-bold px-2 py-0.5 bg-slate-100 rounded text-slate-500 font-mono">
            v0.1.1
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100/50 border border-slate-200/20 rounded-full px-3 py-1 shadow-sm transition-all duration-300">
          <div className={`w-2 h-2 rounded-full shadow-sm ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
          <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider select-none">
            {isOnline ? 'Cloud Sync' : 'Local Edge'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-y-auto px-4 lg:px-8 py-6 min-h-0 pt-20 lg:pt-8 pb-24 lg:pb-8 h-screen">
        <div className="flex-1 w-full max-w-7xl mx-auto lg:mx-0 flex flex-col justify-start">
          
          {activeTab === 'scan' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full animate-fade-in pb-4 items-start">
              <div className="bg-white border border-slate-200/50 rounded-2xl shadow-sm p-4 flex flex-col overflow-hidden h-[340px] md:h-[400px] lg:h-[480px] lg:col-span-7">
                <CameraViewfinder />
              </div>

              <div className="lg:col-span-5 flex flex-col gap-6">
                <div className="bg-white border border-slate-200/50 rounded-2xl shadow-sm p-4 flex flex-col overflow-hidden shrink-0">
                  <ExtractionBadges />
                </div>

                <div className="shrink-0">
                  <SimulationPanel />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'verify' && (
            <div className="flex-1 flex flex-col w-full max-w-3xl mx-auto lg:mx-0 animate-fade-in pb-4">
              <TriageAlertCard />
            </div>
          )}

          {activeTab === 'history' && (
            <div className="flex-1 flex flex-col w-full max-w-3xl mx-auto lg:mx-0 animate-fade-in pb-4">
              <HistoryView />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="flex-1 flex flex-col w-full max-w-3xl mx-auto lg:mx-0 animate-fade-in pb-4">
              <SettingsView />
            </div>
          )}

        </div>
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-slate-200/60 flex justify-around py-2.5 shadow-lg max-w-xl mx-auto rounded-t-2xl">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center gap-1 text-[9px] font-bold uppercase tracking-wider py-1 px-4 transition-all focus:outline-none cursor-pointer relative ${
              activeTab === item.id ? 'text-trust-teal scale-105' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge && state.phase === 'COMPLETE' && activeTab !== 'verify' && (
              <span className="absolute top-1 right-5 w-2 h-2 rounded-full bg-alert-red animate-ping" />
            )}
          </button>
        ))}
      </nav>

    </div>
  );
};
