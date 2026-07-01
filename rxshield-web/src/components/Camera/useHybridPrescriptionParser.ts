import { useCallback } from 'react';
import { OcrService } from '@/services/ocrService';

interface ParserOptions {
  ocrServiceRef: React.MutableRefObject<OcrService | null>;
  appendLog: (log: string) => void;
  matchDrug?: (text: string) => Promise<any>;
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

/**
 * Parses a line of text into its distinct components: medication name, dosage, and frequency.
 */
const parseLineComponents = (line: string): { medication: string; dosage: string; frequency: string } => {
  const tokens = line.split(/\s+/).filter(Boolean);
  let dosage = '';
  let frequency = '';
  const medTokens: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    
    const isFreq = ['bd', 'bid', 'twice', 'bl', 'b1', 'bo', 'bd5', 'rfy', '8l',
                    'tds', 'tid', 'three', 'td5', 't18', 'tds5', 'td', 'tles', 'te', 't5',
                    'qds', 'qid', 'four', 'qd5',
                    'daily', 'waily', 'darly', 'tils', 'warly', 'om', 'nocte', 'mane'].includes(lower);
                    
    const isDose = /^\d+(?:\.\d+)?\s*(?:mg|g|gm|ml)?$/i.test(token) || 
                   /^\d+(?:\.\d+)?$/i.test(token) ||
                   /^(?:mg|g|gm|ml)$/i.test(token);

    if (isFreq) {
      frequency = token;
    } else if (isDose && !dosage) {
      dosage = token;
    } else {
      medTokens.push(token);
    }
  }

  return {
    medication: medTokens.join(' '),
    dosage,
    frequency
  };
};

/**
 * Resolves disagreement between local OCR and cloud VLM parsing by comparing database match
 * states. Cloud VLM results are prioritized for dosage parameters.
 */
const resolveLineDisagreement = async (
  localLine: string,
  cloudLine: string,
  matchDrug?: (text: string) => Promise<any>
): Promise<string> => {
  if (localLine.trim().toLowerCase() === cloudLine.trim().toLowerCase()) {
    return localLine;
  }

  const localParts = parseLineComponents(localLine);
  const cloudParts = parseLineComponents(cloudLine);

  let finalMedication = localParts.medication;
  let finalDosage = localParts.dosage;
  let finalFrequency = localParts.frequency;

  let localMatch: any = null;
  let cloudMatch: any = null;

  if (matchDrug) {
    localMatch = await matchDrug(localParts.medication || '');
    cloudMatch = await matchDrug(cloudParts.medication || '');

    if (localMatch.matched && cloudMatch.matched) {
      finalMedication = cloudParts.medication;
    } else if (localMatch.matched && !cloudMatch.matched) {
      finalMedication = localParts.medication;
    } else if (!localMatch.matched && cloudMatch.matched) {
      finalMedication = cloudParts.medication;
    } else {
      finalMedication = cloudParts.medication || localParts.medication;
    }
  } else {
    finalMedication = cloudParts.medication || localParts.medication;
  }

  if (localParts.frequency && cloudParts.frequency) {
    finalFrequency = cloudParts.frequency;
  } else {
    finalFrequency = cloudParts.frequency || localParts.frequency;
  }

  if (localParts.dosage && cloudParts.dosage) {
    finalDosage = cloudParts.dosage;
  } else {
    finalDosage = cloudParts.dosage || localParts.dosage;
  }

  return [finalMedication, finalDosage, finalFrequency].filter(Boolean).join(' ');
};

const resolveHybridLines = async (
  localText: string,
  cloudText: string,
  matchDrug?: (text: string) => Promise<any>
): Promise<string> => {
  const localLines = localText.split('\n').map(l => l.trim()).filter(Boolean);
  const cloudLines = cloudText.split('\n').map(l => l.trim()).filter(Boolean);
  
  const resolvedLines: string[] = [];
  const maxLines = Math.max(localLines.length, cloudLines.length);
  
  for (let i = 0; i < maxLines; i++) {
    const localLine = localLines[i] || '';
    const cloudLine = cloudLines[i] || '';
    
    if (!localLine && cloudLine) {
      resolvedLines.push(cloudLine);
      continue;
    }
    if (localLine && !cloudLine) {
      resolvedLines.push(localLine);
      continue;
    }
    
    const resolved = await resolveLineDisagreement(localLine, cloudLine, matchDrug);
    resolvedLines.push(resolved);
  }
  
  return resolvedLines.join('\n');
};

/**
 * Hook to manage the hybrid parsing workflow, coordinating online/offline states,
 * and performing a race between local ONNX OCR and cloud VLM endpoints.
 */
export const useHybridPrescriptionParser = ({ ocrServiceRef, appendLog, matchDrug }: ParserOptions) => {
  const parsePrescription = useCallback(
    async (
      rgbaBuffer: Uint8ClampedArray,
      width: number,
      height: number,
      scanMode: 'line' | 'block' = 'line',
      onRefined?: (result: HybridParseResult) => void
    ): Promise<HybridParseResult> => {
      appendLog('[Orchestrator] Probing connection speed and reachability...');
      const isOnline = await checkOnlineStatus(appendLog);
      appendLog(`[Orchestrator] Network Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

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

      if (!isOnline) {
        appendLog('[Orchestrator] Offline Mode active. Executing local track only.');
        const localText = await runLocalTrack();
        return { text: localText, source: 'local' };
      }

      appendLog('[Orchestrator] Online Mode. Initiating parallel race...');
      const localPromise = runLocalTrack();

      const runCloudTrack = async (): Promise<string> => {
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is not configured.');
        }

        appendLog('[Cloud Track] Base64 encoding visual payload...');
        const base64Image = convertRgbaToBase64(rgbaBuffer, width, height);

        const isBlock = scanMode === 'block';

        const prompt = isBlock
          ? `Analyze this cropped handwritten image of a medical prescription containing multiple lines of medications.
Extract the medication details for each line.
Return a JSON object with a "lines" array, where each item has the following fields:
- medication: the brand name or generic name (e.g. "Amoxil", "Lasix", "Lipitor", "Methotrexate")
- dosage: the dosage (e.g. "2gm", "250mg", "10", "7.5mg")
- frequency: the frequency or instructions (e.g. "Daily", "TDS", "BD")
Do not hallucinate or add any other text. Output strictly valid JSON matching this schema.`
          : `Analyze this cropped handwritten image from a medical prescription.
Extract the medication details.
Return a JSON object with the following fields:
- medication: the brand name or generic name (e.g. "Amoxil", "Lasix", "Lipitor", "Methotrexate")
- dosage: the dosage (e.g. "2gm", "250mg", "10", "7.5mg")
- frequency: the frequency or instructions (e.g. "Daily", "TDS", "BD")
Do not hallucinate or add any other text. Output strictly valid JSON matching this schema.`;

        const responseSchema = isBlock
          ? {
              type: 'OBJECT',
              properties: {
                lines: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      medication: { type: 'STRING' },
                      dosage: { type: 'STRING' },
                      frequency: { type: 'STRING' },
                    },
                    required: ['medication', 'dosage', 'frequency'],
                  },
                },
              },
              required: ['lines'],
            }
          : {
              type: 'OBJECT',
              properties: {
                medication: { type: 'STRING' },
                dosage: { type: 'STRING' },
                frequency: { type: 'STRING' },
              },
              required: ['medication', 'dosage', 'frequency'],
            };

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
            responseSchema,
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

        const parseCloudResponse = (jsonText: string): string => {
          const parsed = JSON.parse(jsonText.trim());
          if (isBlock && parsed.lines && Array.isArray(parsed.lines)) {
            return parsed.lines
              .map((line: any) => {
                return [line.medication, line.dosage, line.frequency]
                  .filter(val => !isNegativeOrEmpty(val))
                  .join(' ');
              })
              .filter(Boolean)
              .join('\n');
          } else {
            return [parsed.medication, parsed.dosage, parsed.frequency]
              .filter(val => !isNegativeOrEmpty(val))
              .join(' ');
          }
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

          const tokens = parseCloudResponse(jsonText);
          appendLog(`[Cloud Track] Gemini (${model}) parsed result:\n${tokens}`);
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

          const tokens = parseCloudResponse(jsonText);
          appendLog(`[Cloud Track] Groq parsed result:\n${tokens}`);
          return tokens;
        };

        try {
          return await runGeminiRequest('gemini-2.5-flash', 15000);
        } catch (err) {
          appendLog(`[Cloud Track] Primary gemini-2.5-flash failed/timed out: ${err instanceof Error ? err.message : String(err)}.`);
        }

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

      const localText = await localPromise;

      if (isOnline && onRefined) {
        // Run cloud refinement asynchronously to keep the UI responsive
        (async () => {
          try {
            const cloudResultText = await Promise.race([
              runCloudTrack(),
              new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('Cloud API request timed out (4000ms limit reached).')), 4000)
              ),
            ]);

            if (cloudResultText) {
              appendLog('[Orchestrator] Cloud background refinement received. Merging tracks...');
              const mergedText = await resolveHybridLines(localText, cloudResultText, matchDrug);
              appendLog(`[Orchestrator] Resolved hybrid refined text: "${mergedText.replace(/\n/g, ' | ')}"`);
              onRefined({ text: mergedText, source: 'cloud' });
            }
          } catch (err) {
            appendLog(`[Orchestrator] Cloud background refinement failed or timed out: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      }

      appendLog('[Orchestrator] Returning local OCR result instantly to user.');
      return { text: localText, source: 'local' };
    },
    [ocrServiceRef, appendLog, matchDrug]
  );

  return { parsePrescription };
};
