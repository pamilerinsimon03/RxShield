import { useCallback } from 'react';
import { OcrService } from '@/services/ocrService';

interface ParserOptions {
  ocrServiceRef: React.MutableRefObject<OcrService | null>;
  appendLog: (log: string) => void;
}

export interface HybridParseResult {
  text: string;
  source: 'cloud' | 'local';
}

const checkOnlineStatus = async (appendLog: (log: string) => void): Promise<boolean> => {
  if (typeof navigator === 'undefined') {
    return false;
  }
  if (!navigator.onLine) {
    appendLog('[Orchestrator] navigator.onLine is false.');
    return false;
  }
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    // Use GET and no-cors mode to perform a lightweight connectivity ping to a standard endpoint
    await fetch('https://www.google.com/generate_204', {
      method: 'GET',
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(id);
    return true;
  } catch (e) {
    appendLog(`[Orchestrator] Reachability ping failed: ${e instanceof Error ? e.message : String(e)}. Falling back to navigator.onLine status.`);
    // Critical fix: If the ping itself fails (e.g. blocked by DNS/adblocker/fetch policy),
    // but navigator.onLine is true, we should STILL assume we are online and attempt the cloud track
    // rather than forcing a local fallback.
    return true;
  }
};

const convertRgbaToBase64 = (
  rgbaBuffer: Uint8ClampedArray,
  width: number,
  height: number
): string => {
  if (typeof document === 'undefined') {
    throw new Error('Canvas conversion requires browser document object.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context.');

  const imgData = new ImageData(
    rgbaBuffer as any,
    width,
    height
  );
  ctx.putImageData(imgData, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return dataUrl.split(',')[1];
};

export const useHybridPrescriptionParser = ({ ocrServiceRef, appendLog }: ParserOptions) => {
  const parsePrescription = useCallback(
    async (
      rgbaBuffer: Uint8ClampedArray,
      width: number,
      height: number
    ): Promise<HybridParseResult> => {
      // 1. Instantly check connectivity
      appendLog('[Orchestrator] Probing connection speed and reachability...');
      const isOnline = await checkOnlineStatus(appendLog);
      appendLog(`[Orchestrator] Network Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

      // Helper to execute the local OCR track
      const runLocalTrack = async (): Promise<string> => {
        const ocrService = ocrServiceRef.current;
        if (!ocrService) {
          throw new Error('Local OCR service is not available.');
        }
        appendLog('[Local Track] Initializing ONNX WASM model...');
        await ocrService.init();
        appendLog('[Local Track] Running OCR neural network pass...');
        const localRes = await ocrService.runOcr(rgbaBuffer, width, height);
        appendLog(`[Local Track] OCR finished: "${localRes.text}"`);
        return localRes.text || '';
      };

      // If offline, bypass network completely
      if (!isOnline) {
        appendLog('[Orchestrator] Offline Mode active. Executing local track only.');
        const localText = await runLocalTrack();
        return { text: localText, source: 'local' };
      }

      // 2. Online Mode: Parallel Race
      appendLog('[Orchestrator] Online Mode. Initiating parallel race...');
      const localPromise = runLocalTrack();

      const runCloudTrack = async (): Promise<string> => {
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is not configured.');
        }

        appendLog('[Cloud Track] Base64 encoding visual payload...');
        const base64Image = convertRgbaToBase64(rgbaBuffer, width, height);

        const prompt = `Analyze this cropped handwritten image from a medical prescription.
Extract the medication details.
Return a JSON object with the following fields:
- medication: the brand name or generic name (e.g. "Amoxil", "Lasix", "Lipitor", "Methotrexate")
- dosage: the dosage (e.g. "2gm", "250mg", "10", "7.5mg")
- frequency: the frequency or instructions (e.g. "Daily", "TDS", "BD")
Do not hallucinate or add any other text. Output strictly valid JSON matching this schema.`;

        const requestBody = {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                medication: { type: 'STRING' },
                dosage: { type: 'STRING' },
                frequency: { type: 'STRING' },
              },
              required: ['medication', 'dosage', 'frequency'],
            },
          },
        };

        const fetchWithTimeout = async (
          url: string,
          options: RequestInit,
          timeoutMs: number
        ): Promise<Response> => {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetch(url, {
              ...options,
              signal: controller.signal,
            });
            clearTimeout(id);
            return response;
          } catch (error) {
            clearTimeout(id);
            throw error;
          }
        };

        const isNegativeOrEmpty = (val: any): boolean => {
          if (!val) return true;
          const normalized = val.toString().trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
          const negativeWords = [
            'none', 'na', 'n/a', 'not specified', 'unknown',
            'none mentioned', 'not mentioned', 'unspecified',
            'null', 'nil'
          ];
          return negativeWords.includes(normalized);
        };

        const runGeminiRequest = async (model: string, timeoutMs: number): Promise<string> => {
          appendLog(`[Cloud Track] Dispatching fetch to Gemini (${model})...`);
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          
          const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }, timeoutMs);

          if (!response.ok) {
            throw new Error(`Gemini API response failure (${model}): ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!jsonText) {
            throw new Error(`Empty payload returned from Gemini (${model}).`);
          }

          const parsed = JSON.parse(jsonText.trim());
          const tokens = [parsed.medication, parsed.dosage, parsed.frequency]
            .filter(val => !isNegativeOrEmpty(val))
            .join(' ');
          
          appendLog(`[Cloud Track] Gemini (${model}) returned: "${tokens}"`);
          return tokens;
        };

        const runGroqRequest = async (groqKey: string, timeoutMs: number): Promise<string> => {
          appendLog('[Cloud Track] Dispatching fetch to Groq (qwen/qwen3.6-27b)...');
          const url = 'https://api.groq.com/openai/v1/chat/completions';
          
          const groqBody = {
            model: 'qwen/qwen3.6-27b',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: prompt,
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${base64Image}`
                    }
                  }
                ]
              }
            ],
            response_format: {
              type: 'json_object'
            }
          };

          const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${groqKey}`,
            },
            body: JSON.stringify(groqBody),
          }, timeoutMs);

          if (!response.ok) {
            throw new Error(`Groq API response failure: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          const jsonText = data.choices?.[0]?.message?.content;
          if (!jsonText) {
            throw new Error('Empty payload returned from Groq.');
          }

          const parsed = JSON.parse(jsonText.trim());
          const tokens = [parsed.medication, parsed.dosage, parsed.frequency]
            .filter(val => !isNegativeOrEmpty(val))
            .join(' ');
          
          appendLog(`[Cloud Track] Groq returned: "${tokens}"`);
          return tokens;
        };

        // Try primary model (gemini-2.5-flash) first
        try {
          return await runGeminiRequest('gemini-2.5-flash', 15000);
        } catch (err) {
          appendLog(`[Cloud Track] Primary gemini-2.5-flash failed/timed out: ${err instanceof Error ? err.message : String(err)}.`);
        }

        // Try Groq if key is present
        const groqApiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
        if (groqApiKey) {
          try {
            return await runGroqRequest(groqApiKey, 12000);
          } catch (err) {
            appendLog(`[Cloud Track] Groq failed/timed out: ${err instanceof Error ? err.message : String(err)}.`);
          }
        }

        throw new Error('All cloud models and API fallbacks failed.');
      };

      try {
        // Race the Cloud Track against a generous 30000ms timeout for testing
        const cloudResultText = await Promise.race([
          runCloudTrack(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Cloud API request timed out (30000ms limit reached).')), 30000)
          ),
        ]);

        return { text: cloudResultText, source: 'cloud' };
      } catch (err) {
        appendLog(`[Orchestrator] Cloud Track failed/timed out: ${err instanceof Error ? err.message : String(err)}`);
        appendLog('[Orchestrator] Falling back immediately to Local WASM result.');
        const localText = await localPromise;
        return { text: localText, source: 'local' };
      }
    },
    [ocrServiceRef, appendLog]
  );

  return { parsePrescription };
};
