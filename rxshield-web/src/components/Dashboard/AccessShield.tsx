import React, { useState, useEffect } from 'react';

interface AccessShieldProps {
  onUnlock: () => void;
}

export const AccessShield: React.FC<AccessShieldProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<boolean>(false);
  const correctPinHash = '8c19996aa890257d05d9576583a5e056943aed0651142be0bd6e4ef462c9b4ad';

  const sha256Fallback = (ascii: string): string => {
    const rightRotate = (value: number, amount: number) => {
      return (value >>> amount) | (value << (32 - amount));
    };
    
    const words: number[] = [];
    const asciiLength = ascii.length * 8;
    
    let i, j;
    
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const wordsCount = ((asciiLength + 64) >>> 9 << 4) + 15;
    for (i = 0; i < wordsCount; i++) words[i] = 0;
    for (i = 0; i < ascii.length; i++) {
      words[i >>> 2] |= (ascii.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    }
    words[ascii.length >>> 2] |= 0x80 << (24 - (ascii.length % 4) * 8);
    words[wordsCount] = asciiLength;

    for (i = 0; i < words.length; i += 16) {
      const w: number[] = [];
      const h = [...hash];
      for (j = 0; j < 64; j++) {
        if (j < 16) {
          w[j] = words[i + j];
        } else {
          const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
          const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
          w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        
        const S1 = rightRotate(h[4], 6) ^ rightRotate(h[4], 11) ^ rightRotate(h[4], 25);
        const ch = (h[4] & h[5]) ^ (~h[4] & h[6]);
        const temp1 = (h[7] + S1 + ch + k[j] + w[j]) | 0;
        const S0 = rightRotate(h[0], 2) ^ rightRotate(h[0], 13) ^ rightRotate(h[0], 22);
        const maj = (h[0] & h[1]) ^ (h[0] & h[2]) ^ (h[1] & h[2]);
        const temp2 = (S0 + maj) | 0;

        h[7] = h[6];
        h[6] = h[5];
        h[5] = h[4];
        h[4] = (h[3] + temp1) | 0;
        h[3] = h[2];
        h[2] = h[1];
        h[1] = h[0];
        h[0] = (temp1 + temp2) | 0;
      }
      for (j = 0; j < 8; j++) hash[j] = (hash[j] + h[j]) | 0;
    }

    const result: string[] = [];
    for (i = 0; i < 8; i++) {
      const word = hash[i];
      result.push(((word >>> 24) & 0xff).toString(16).padStart(2, '0'));
      result.push(((word >>> 16) & 0xff).toString(16).padStart(2, '0'));
      result.push(((word >>> 8) & 0xff).toString(16).padStart(2, '0'));
      result.push((word & 0xff).toString(16).padStart(2, '0'));
    }
    return result.join('');
  };

  const hashPin = async (input: string): Promise<string> => {
    try {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {
      console.warn('Web Crypto API failed, using fallback:', e);
    }
    return sha256Fallback(input);
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

  // Check pin auto-submit when length reaches 4
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
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-md text-blue-600 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900 uppercase tracking-wider">Clinical Core Authorization</h1>
          <p className="text-xs text-slate-600 mt-1">Enter access PIN to unlock diagnostic workbench</p>
        </div>

        {/* PIN Dots display */}
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

        {/* Error Notice */}
        <div className="h-6 mb-2">
          {error && (
            <span className="text-xs font-mono font-bold text-rose-700 uppercase tracking-tight">
              Access Denied: Invalid Passcode
            </span>
          )}
        </div>

        {/* Keypad */}
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

        {/* Hint */}
        <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
          Default PIN: 2990
        </span>
      </div>
    </div>
  );
};
