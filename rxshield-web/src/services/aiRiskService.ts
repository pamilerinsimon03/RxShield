export interface AiRiskAnalysisReport {
  safetyWarnings: string[];
  foodDrugInteractions: string[];
  demographicRiskAssessment: string;
  clinicalRecommendation: string;
}

export interface AiRiskServiceInputs {
  genericName: string;
  dailyDose: string;
  verdict: string;
  checklistStatus: string;
  capturedImageUri: string | null;
}

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

/**
 * Executes AI safety analysis for a scanned prescription.
 * Uses Gemini 2.5 Flash with a 15s timeout, falling back to Qwen 3.6 27b on Groq with a 12s timeout.
 */
export const runAiRiskAnalysis = async (
  inputs: AiRiskServiceInputs
): Promise<AiRiskAnalysisReport> => {
  const { genericName, dailyDose, verdict, checklistStatus, capturedImageUri } = inputs;

  const prompt = `Analyze the prescription details and cross-reference them with the visual prescription image if provided.
Prescription Details:
- Medication (Generic Name): ${genericName}
- Daily Dose: ${dailyDose}
- Current Validation Verdict: ${verdict}
- Demographic Checklist Verification Status: ${checklistStatus}

Analyze the prescription details, evaluate potential demographic risks based on the checklist status (pregnancy/renal status), specify any food/drug interactions, and provide clinical recommendations.

Keep all parts of the response extremely brief and concise. Most especially, keep the clinical recommendation brief (maximum 1-2 sentences).

Return a strictly valid JSON object matching this schema:
{
  "safetyWarnings": ["list of major contraindications, severe side effects, or pediatric/geriatric risks"],
  "foodDrugInteractions": ["list of common food or drug interactions for this compound"],
  "demographicRiskAssessment": "A tailored evaluation based on whether required pregnancy/renal checks were checked or left unchecked by the clinician.",
  "clinicalRecommendation": "Final cautionary guidance or recommendation for the dispensing clinician."
}

Do NOT wrap the output in markdown code blocks (e.g. do not use \`\`\`json ... \`\`\`). Return only the raw JSON.`;

  const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  
  if (geminiApiKey) {
    try {
      const base64Image = capturedImageUri ? capturedImageUri.split(',')[1] : null;
      
      const parts: any[] = [{ text: prompt }];
      if (base64Image) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image,
          },
        });
      }

      const requestBody = {
        contents: [
          {
            parts,
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              safetyWarnings: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              foodDrugInteractions: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              demographicRiskAssessment: { type: 'STRING' },
              clinicalRecommendation: { type: 'STRING' },
            },
            required: ['safetyWarnings', 'foodDrugInteractions', 'demographicRiskAssessment', 'clinicalRecommendation'],
          },
        },
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
      
      console.log('[AI Risk Service] Dispatching request to Gemini (gemini-2.5-flash)...');
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
        15000
      );

      if (!response.ok) {
        throw new Error(`Gemini API response failure: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jsonText) {
        throw new Error('Empty payload returned from Gemini.');
      }

      return JSON.parse(jsonText.trim()) as AiRiskAnalysisReport;
    } catch (err) {
      console.error(
        `[AI Risk Service] Gemini primary attempt failed: ${
          err instanceof Error ? err.message : String(err)
        }. Trying Groq fallback...`
      );
    }
  } else {
    console.log('[AI Risk Service] Gemini API key not found. Trying Groq fallback directly...');
  }

  // Fallback to Groq Qwen
  const groqApiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error('All AI services failed: both Gemini and Groq API keys are missing or requests failed.');
  }

  const base64Image = capturedImageUri ? capturedImageUri.split(',')[1] : null;
  const contentParts: any[] = [{ type: 'text', text: prompt }];
  if (base64Image) {
    contentParts.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${base64Image}`,
      },
    });
  }

  const groqBody = {
    model: 'qwen/qwen3.6-27b',
    messages: [
      {
        role: 'user',
        content: contentParts,
      },
    ],
    response_format: {
      type: 'json_object',
    },
  };

  console.log('[AI Risk Service] Dispatching request to Groq (qwen/qwen3.6-27b)...');
  const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
  
  const response = await fetchWithTimeout(
    groqUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify(groqBody),
    },
    12000
  );

  if (!response.ok) {
    throw new Error(`Groq API response failure: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const jsonText = data.choices?.[0]?.message?.content;
  if (!jsonText) {
    throw new Error('Empty payload returned from Groq.');
  }

  return JSON.parse(jsonText.trim()) as AiRiskAnalysisReport;
};
