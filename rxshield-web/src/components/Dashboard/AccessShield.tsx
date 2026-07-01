import React, { useState, useEffect } from 'react';

interface AccessShieldProps {
  onUnlock: () => void;
}

export const AccessShield: React.FC<AccessShieldProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<boolean>(false);
  const correctPinHash = '8c19996aa890257d05d9576583a5e056943aed0651142be0bd6e4ef462c9b4ad';

  const hashPin = async (input: string): Promise<string> => {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      throw new Error('Web Crypto API is not available');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleKeyPress = (num: string) => {
    setError(false);
    if (pin.length < 4) {
      setPin((prev) => prev + num);
    }
  };

  const handleDelete = () => {
    setError(false);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError(false);
    setPin('');
  };

  const handleSubmit = async (currentPin: string = pin) => {
    try {
      const hashed = await hashPin(currentPin);
      if (hashed === correctPinHash) {
        onUnlock();
      } else {
        setError(true);
        setPin('');
      }
    } catch (err) {
      console.error('PIN hashing failed:', err);
      setError(true);
      setPin('');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pin]);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (pin.length === 4) {
      timer = setTimeout(() => {
        handleSubmit(pin);
      }, 150);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pin]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 font-sans p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-md shadow-md p-6 flex flex-col items-center overflow-y-auto max-h-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-md text-blue-600 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900 uppercase tracking-wider">Clinical Core Authorization</h1>
          <p className="text-xs text-slate-600 mt-1">Enter access PIN to unlock diagnostic workbench</p>
        </div>

        <div className="flex justify-center gap-4 mb-6">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`w-4 h-4 rounded-sm border transition-all duration-150 ${
                error
                  ? 'bg-rose-700 border-rose-700 animate-pulse'
                  : idx < pin.length
                  ? 'bg-slate-900 border-slate-900 scale-110'
                  : 'bg-white border-slate-200'
              }`}
            />
          ))}
        </div>

        <div className="h-6 mb-2">
          {error && (
            <span className="text-xs font-mono font-bold text-rose-700 uppercase tracking-tight">
              Access Denied: Invalid Passcode
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 w-full max-w-[280px] mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num)}
              className="h-12 text-lg font-mono font-semibold text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 rounded-md transition-colors focus:outline-none"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-12 text-xs font-mono font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 rounded-md transition-colors focus:outline-none"
          >
            CLEAR
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-12 text-lg font-mono font-semibold text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 rounded-md transition-colors focus:outline-none"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="h-12 text-xs font-mono font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 rounded-md transition-colors focus:outline-none"
          >
            DELETE
          </button>
        </div>

        <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
          Default PIN: 2990
        </span>
      </div>
    </div>
  );
};
