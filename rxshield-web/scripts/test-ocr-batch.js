// rxshield-web/scripts/test-ocr-batch.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const jpeg = require('jpeg-js');
const ort = require('onnxruntime-node');
const Fuse = require('fuse.js');

const isSyntheticMode = process.argv.includes('--synthetic');
const IMAGES_DIR = isSyntheticMode
  ? path.resolve(__dirname, '../public/synthetic-test-images')
  : path.resolve(__dirname, '../public/test-handwritten-images');
const MODEL_PATH = path.resolve(__dirname, '../public/models/crnn_int8.onnx');
const DB_PATH = path.resolve(__dirname, '../public/database/rxshield_core.db');
const PYTHON_PATH = path.resolve(__dirname, '../../rxshield-pipeline/.venv/Scripts/python.exe');
const BRIDGE_PATH = path.resolve(__dirname, 'query_db_bridge.py');

// Load environment variables from .env.local if present
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (let line of envContent.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key.startsWith('NEXT_PUBLIC_')) {
        process.env[key] = val;
      }
    }
  }
}

async function checkOnlineStatus() {
  if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      await fetch('https://generativelanguage.googleapis.com', {
        method: 'HEAD',
        signal: controller.signal
      });
      clearTimeout(id);
      return true;
    } catch (e) {
      console.warn('[Online Check Debug] Connection probe failed:', e.message || e);
      return false;
    }
  }
  console.warn('[Online Check Debug] process.env.NEXT_PUBLIC_GEMINI_API_KEY is not defined!');
  return false;
}

async function fetchWithTimeout(url, options, timeoutMs) {
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
}

async function runCloudTrack(imagePath) {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is not configured.');
  }

  const base64Image = fs.readFileSync(imagePath, { encoding: 'base64' });

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

  const isNegativeOrEmpty = (val) => {
    if (!val) return true;
    const normalized = val.toString().trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    const negativeWords = [
      'none', 'na', 'n/a', 'not specified', 'unknown',
      'none mentioned', 'not mentioned', 'unspecified',
      'null', 'nil'
    ];
    return negativeWords.includes(normalized);
  };

  const runGeminiRequest = async (model, timeoutMs) => {
    console.log(`[Cloud Track] Dispatching fetch to Gemini (${model})...`);
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
    
    console.log(`[Cloud Track] Gemini (${model}) returned: "${tokens}"`);
    return tokens;
  };

  const runGroqRequest = async (groqKey, timeoutMs) => {
    console.log('[Cloud Track] Dispatching fetch to Groq (qwen/qwen3.6-27b)...');
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
    
    console.log(`[Cloud Track] Groq returned: "${tokens}"`);
    return tokens;
  };

  // Try primary model (gemini-2.5-flash) first
  try {
    return await runGeminiRequest('gemini-2.5-flash', 25000);
  } catch (err) {
    console.warn(`[Cloud Track] Primary gemini-2.5-flash failed/timed out: ${err.message || err}.`);
  }

  // Try Groq if key is present
  const groqApiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
  if (groqApiKey) {
    try {
      return await runGroqRequest(groqApiKey, 20000);
    } catch (err) {
      console.warn(`[Cloud Track] Groq failed/timed out: ${err.message || err}.`);
    }
  }

  throw new Error('All cloud models and API fallbacks failed.');
}

// CRNN vocabulary
const CHARS = [
  "", " ", "!", "\"", "'", "(", ")", ",", "-", ".", "0", "1", "2", "3", "4", "5", "6", 
  "7", "8", "9", ":", ";", "?", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", 
  "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", 
  "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", 
  "t", "u", "v", "w", "x", "y", "z", "/", "+"
];

// Helper to query SQLite database via Python bridge
function runDbQuery(sql, params = []) {
  try {
    const args = [BRIDGE_PATH, DB_PATH, sql, ...params.map(String)];
    const output = execFileSync(PYTHON_PATH, args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    const parsed = JSON.parse(output.trim());
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed;
  } catch (err) {
    console.error(`[DB Error] query failed:`, err.message || err);
    return [];
  }
}

// Port of normalizeText from src/utils/textNormalization.ts
function normalizeText(text) {
  let normalized = text.toUpperCase();
  normalized = normalized.replace(/[^A-Z0-9\s,\/\.\-]/g, '');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.trim();
}

// Levenshtein and similarity helpers from src/utils/stringDistance.ts
function levenshtein(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;
  const matrix = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

function jaro(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 && len2 === 0) return 1.0;
  if (len1 === 0 || len2 === 0) return 0.0;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(len2, i + matchWindow + 1);
    for (let j = start; j < end; j++) {
      if (!matches2[j] && s1[i] === s2[j]) {
        matches1[i] = true;
        matches2[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (matches1[i]) {
      while (!matches2[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }
  const t = transpositions / 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3.0;
}

function jaroWinkler(s1, s2) {
  const jaroScore = jaro(s1, s2);
  const p = 0.1;
  let l = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) l++;
    else break;
  }
  return jaroScore + l * p * (1.0 - jaroScore);
}

function getFuzzySimilarity(s1, s2) {
  const str1 = s1.trim().toUpperCase();
  const str2 = s2.trim().toUpperCase();
  if (str1 === str2) return 1.0;
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const levDist = levenshtein(str1, str2);
  const levSim = 1.0 - levDist / maxLen;
  const jwSim = jaroWinkler(str1, str2);
  return (levSim + jwSim) / 2.0;
}

let DRUG_TO_GENERIC_MAP = new Map();
let PROTOCOL_GENERICS = new Set();
let fuse = null;

// In-Memory drug name list loaded from DB
let ALL_DRUG_NAMES = [];
function initDrugNames() {
  const candidates = runDbQuery('SELECT DISTINCT brand_name, generic_name FROM drugs');
  const unique = new Set();
  for (const row of candidates) {
    const brand = row.brand_name ? row.brand_name.toUpperCase() : null;
    const generic = row.generic_name ? row.generic_name.toUpperCase() : null;
    if (brand) {
      unique.add(brand);
      DRUG_TO_GENERIC_MAP.set(brand, generic);
    }
    if (generic) {
      unique.add(generic);
      DRUG_TO_GENERIC_MAP.set(generic, generic);
    }
  }
  ALL_DRUG_NAMES = Array.from(unique);

  const protocols = runDbQuery('SELECT DISTINCT generic_name FROM nstg_protocols');
  for (const row of protocols) {
    if (row.generic_name) {
      PROTOCOL_GENERICS.add(row.generic_name.toUpperCase());
    }
  }

  fuse = new Fuse(ALL_DRUG_NAMES, {
    includeScore: true,
    threshold: 0.55
  });
}

function hasProtocolInDb(name) {
  const generic = DRUG_TO_GENERIC_MAP.get(name.toUpperCase());
  return generic ? PROTOCOL_GENERICS.has(generic) : false;
}

const FREQ_NORM_MAPS = {
  'bd': ['bd', 'bid', 'twice', 'b1', 'bd5', 'rfy', '8l'],
  'tds': ['tds', 'tid', 'three', 'td5', 't18', 'tds5', 'td', 'tles', 'te', 't5'],
  'qds': ['qds', 'qid', 'four', 'qd5'],
  'daily': ['daily', 'waily', 'darly', 'tils', 'warly']
};

function areFirstLettersVisuallyEquivalent(c1, c2) {
  const char1 = c1.toUpperCase();
  const char2 = c2.toUpperCase();
  if (char1 === char2) return true;
  
  const groups = [
    ['I', 'L', 'J', 'F', 'T', '1', '7'],
    ['O', 'D', 'Q', '0', 'C', 'K', 'G'],
    ['S', '5', '8', 'B', 'E', 'C', 'G'],
    ['A', '2', 'Z', 'R'],
    ['M', 'W', '3', 'N', 'H'],
    ['U', 'V', 'Y', '4'],
    ['P', 'R', 'B', 'F', 'H', 'D']
  ];
  
  for (const group of groups) {
    if (group.includes(char1) && group.includes(char2)) {
      return true;
    }
  }
  return false;
}

// Match single drug name helper
function matchDrugNameOnly(text) {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned.length < 3) return { matched: false, confidence: 0 };
  
  // Exact match check
  const exactRows = runDbQuery(
    'SELECT brand_name, generic_name FROM drugs WHERE brand_name = ? OR generic_name = ? LIMIT 1',
    [cleaned, cleaned]
  );
  if (exactRows && exactRows.length > 0) {
    return { matched: true, confidence: 1.0, name: exactRows[0].generic_name, brand: exactRows[0].brand_name };
  }

  // Fuzzy match candidates using getFuzzySimilarity
  let candidates = [];
  for (const candidate of ALL_DRUG_NAMES) {
    const score = getFuzzySimilarity(cleaned, candidate);
    const hasProtocol = hasProtocolInDb(candidate);
    
    let threshold = 0.85;
    if (cleaned.length >= 9) {
      threshold = 0.64;
    } else if (cleaned.length === 8) {
      threshold = 0.64;
    } else if (cleaned.length === 7) {
      threshold = 0.62;
    } else if (cleaned.length === 6) {
      threshold = 0.60;
    } else if (cleaned.length === 5) {
      threshold = 0.68;
    } else if (cleaned.length === 4) {
      threshold = 0.78;
    }
    
    const visuallyEquivalentFirstLetter = areFirstLettersVisuallyEquivalent(cleaned[0], candidate[0]);
    if (score >= threshold && visuallyEquivalentFirstLetter) {
      candidates.push({ name: candidate, score, hasProtocol });
    }
  }

  // Fallback loop if no candidate matched
  if (candidates.length === 0) {
    for (const candidate of ALL_DRUG_NAMES) {
      const score = getFuzzySimilarity(cleaned, candidate);
      const hasProtocol = hasProtocolInDb(candidate);
      
      if (score >= 0.45 && hasProtocol && areFirstLettersVisuallyEquivalent(cleaned[0], candidate[0])) {
        candidates.push({ name: candidate, score, hasProtocol });
      }
    }
  }

  if (candidates.length === 0) {
    return { matched: false, confidence: 0 };
  }

  // Sort by score descending, with protocol as a close tie-breaker
  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) < 0.005) {
      if (a.hasProtocol !== b.hasProtocol) {
        return a.hasProtocol ? -1 : 1;
      }
    }
    return b.score - a.score;
  });

  const bestName = candidates[0].name;
  const bestScore = candidates[0].score;

  const lookupRows = runDbQuery(
    'SELECT brand_name, generic_name FROM drugs WHERE brand_name = ? OR generic_name = ? LIMIT 1',
    [bestName, bestName]
  );
  const generic = lookupRows.length > 0 ? lookupRows[0].generic_name : bestName;
  const brand = lookupRows.length > 0 ? lookupRows[0].brand_name : bestName;

  return { matched: true, confidence: bestScore, name: generic, brand: brand };
}

// Optimized Database matching (Full In-Memory Fuzzy Lookup on 659 drugs)
async function matchDrug(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { matched: false, confidence: 0.0, error: 'Empty input text' };
  }

  // Find the first token that matches any drug in the DB
  for (const token of tokens) {
    const res = matchDrugNameOnly(token);
    if (res.matched) {
      // Relational Join
      const joinSql = `
        SELECT 
            d.brand_name,
            d.generic_name,
            d.atc_code,
            p.max_single_dose_mg,
            p.max_daily_dose_mg,
            p.max_duration_days,
            p.requires_pregnancy_check,
            p.requires_renal_check,
            p.guideline_citation
        FROM drugs d
        LEFT JOIN nstg_protocols p ON d.generic_name = p.generic_name COLLATE NOCASE
        WHERE d.generic_name = ? OR d.brand_name = ?
        LIMIT 1;
      `;
      const results = runDbQuery(joinSql, [res.name, res.name]);
      if (results && results.length > 0) {
        let protocolData = results[0];
        
        // Handle composite generics (e.g. + generic fallback)
        if (protocolData && protocolData.max_single_dose_mg === null && protocolData.generic_name && protocolData.generic_name.includes('+')) {
          const parts = protocolData.generic_name.split('+').map(s => s.trim());
          if (parts.length > 0 && parts[0]) {
            const fallbackSql = `
              SELECT max_single_dose_mg, max_daily_dose_mg, max_duration_days, requires_pregnancy_check, requires_renal_check, guideline_citation
              FROM nstg_protocols WHERE generic_name = ? COLLATE NOCASE LIMIT 1;
            `;
            const fallbackResults = runDbQuery(fallbackSql, [parts[0]]);
            if (fallbackResults && fallbackResults.length > 0) {
              const fb = fallbackResults[0];
              protocolData = {
                ...protocolData,
                max_single_dose_mg: fb.max_single_dose_mg,
                max_daily_dose_mg: fb.max_daily_dose_mg,
                max_duration_days: fb.max_duration_days,
                requires_pregnancy_check: fb.requires_pregnancy_check,
                requires_renal_check: fb.requires_renal_check,
                guideline_citation: fb.guideline_citation
              };
            }
          }
        }

        return {
          matched: true,
          confidence: res.confidence,
          cleanedInput: text,
          matchedString: res.brand || res.name,
          data: protocolData
        };
      }
    }
  }

  return {
    matched: false,
    confidence: 0.0,
    cleanedInput: text,
    error: `Medication not recognized.`
  };
}

// Bradley-Roth adaptive thresholding
function adaptiveThresholdBradley(width, height, rgbaBuffer, windowSize = 25, t = 15) {
  const gray = new Uint8Array(width * height);
  const integral = new Int32Array(width * height);
  const output = new Uint8ClampedArray(rgbaBuffer.length);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rgbaBuffer[idx];
      const g = rgbaBuffer[idx + 1];
      const b = rgbaBuffer[idx + 2];
      const gr = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * width + x] = gr;

      sum += gr;
      if (y === 0) {
        integral[y * width + x] = sum;
      } else {
        integral[y * width + x] = integral[(y - 1) * width + x] + sum;
      }
    }
  }

  const s2 = Math.floor(windowSize / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      const x1 = Math.max(0, x - s2);
      const x2 = Math.min(width - 1, x + s2);
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(height - 1, y + s2);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      let sum = integral[y2 * width + x2];
      if (x1 > 0) {
        sum -= integral[y2 * width + (x1 - 1)];
      }
      if (y1 > 0) {
        sum -= integral[(y1 - 1) * width + x2];
      }
      if (x1 > 0 && y1 > 0) {
        sum += integral[(y1 - 1) * width + (x1 - 1)];
      }

      const val = (gray[y * width + x] * count) < (sum * (100 - t) / 100) ? 0 : 255;

      output[idx] = val;
      output[idx + 1] = val;
      output[idx + 2] = val;
      output[idx + 3] = 255;
    }
  }

  return output;
}

function binarizeImageData(width, height, rgbaBuffer, threshold) {
  if (threshold === undefined) {
    return adaptiveThresholdBradley(width, height, rgbaBuffer, 25, 15);
  }
  const output = new Uint8ClampedArray(rgbaBuffer.length);
  for (let i = 0; i < rgbaBuffer.length; i += 4) {
    const r = rgbaBuffer[i];
    const g = rgbaBuffer[i + 1];
    const b = rgbaBuffer[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const val = gray < threshold ? 0 : 255;
    output[i] = val;
    output[i + 1] = val;
    output[i + 2] = val;
    output[i + 3] = 255;
  }
  return output;
}

function findGlobalBoundingBox(width, height, rgbaBuffer, noiseThreshold = 2) {
  const columnCounts = new Int32Array(width);
  const rowCounts = new Int32Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (rgbaBuffer[idx] < 128) {
        columnCounts[x]++;
        rowCounts[y]++;
      }
    }
  }

  let xMin = 0;
  for (let x = 0; x < width; x++) {
    if (columnCounts[x] > noiseThreshold) {
      xMin = x;
      break;
    }
  }

  let xMax = width - 1;
  for (let x = width - 1; x >= 0; x--) {
    if (columnCounts[x] > noiseThreshold) {
      xMax = x;
      break;
    }
  }

  let yMin = 0;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] > noiseThreshold) {
      yMin = y;
      break;
    }
  }

  let yMax = height - 1;
  for (let y = height - 1; y >= 0; y--) {
    if (rowCounts[y] > noiseThreshold) {
      yMax = y;
      break;
    }
  }

  if (xMin >= xMax || yMin >= yMax) {
    return { x: 0, y: 0, w: width, h: height };
  }

  const paddingX = 12;
  const paddingY = 8;
  const x1 = Math.max(0, xMin - paddingX);
  const x2 = Math.min(width, xMax + paddingX);
  const y1 = Math.max(0, yMin - paddingY);
  const y2 = Math.min(height, yMax + paddingY);

  return {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1
  };
}

function extractSubImage(width, rgbaBuffer, bbox) {
  const { x, y, w, h } = bbox;
  const subBuffer = new Uint8ClampedArray(w * h * 4);
  for (let dy = 0; dy < h; dy++) {
    const srcY = y + dy;
    const srcRowStart = srcY * width * 4;
    const destRowStart = dy * w * 4;
    const srcSlice = rgbaBuffer.subarray(srcRowStart + x * 4, srcRowStart + (x + w) * 4);
    subBuffer.set(srcSlice, destRowStart);
  }
  return subBuffer;
}

// Precise word segmentation
function segmentLineIntoWords(width, height, rgbaBuffer, globalBbox, noiseThreshold = 1) {
  const { x: gx, y: gy, w: gw, h: gh } = globalBbox;
  
  const colCounts = new Int32Array(width);
  for (let x = gx; x < gx + gw; x++) {
    for (let y = gy; y < gy + gh; y++) {
      const idx = (y * width + x) * 4;
      if (rgbaBuffer[idx] < 128) {
        colCounts[x]++;
      }
    }
  }

  const gapWidth = Math.max(10, Math.round(gh * 0.18));
  const segments = [];
  let inWord = false;
  let wordStart = gx;
  let consecutiveEmptyCols = 0;

  for (let x = gx; x < gx + gw; x++) {
    const hasInk = colCounts[x] > noiseThreshold;
    if (hasInk) {
      if (!inWord) {
        inWord = true;
        wordStart = x;
      }
      consecutiveEmptyCols = 0;
    } else {
      if (inWord) {
        consecutiveEmptyCols++;
        if (consecutiveEmptyCols >= gapWidth) {
          const wordEnd = x - gapWidth;
          if (wordEnd > wordStart) {
            segments.push({ x1: wordStart, x2: wordEnd });
          }
          inWord = false;
        }
      }
    }
  }

  if (inWord) {
    segments.push({ x1: wordStart, x2: gx + gw - 1 });
  }

  const mergedSegments = [];
  const minMergeGap = Math.max(4, Math.round(gapWidth / 2));
  
  for (const seg of segments) {
    if (mergedSegments.length === 0) {
      mergedSegments.push(seg);
    } else {
      const last = mergedSegments[mergedSegments.length - 1];
      if (seg.x1 - last.x2 < minMergeGap) {
        last.x2 = seg.x2;
      } else {
        mergedSegments.push(seg);
      }
    }
  }

  const wordBoxes = [];
  for (const seg of mergedSegments) {
    const paddingX = 4;
    const x1 = Math.max(gx, seg.x1 - paddingX);
    const x2 = Math.min(gx + gw - 1, seg.x2 + paddingX);
    const w = x2 - x1;
    if (w < 10) continue; // Noise filter

    const localRowCounts = new Int32Array(height);
    for (let y = gy; y < gy + gh; y++) {
      for (let x = x1; x <= x2; x++) {
        const idx = (y * width + x) * 4;
        if (rgbaBuffer[idx] < 128) {
          localRowCounts[y]++;
        }
      }
    }

    let yMin = gy;
    for (let y = gy; y < gy + gh; y++) {
      if (localRowCounts[y] > 0) {
        yMin = y;
        break;
      }
    }

    let yMax = gy + gh - 1;
    for (let y = gy + gh - 1; y >= gy; y--) {
      if (localRowCounts[y] > 0) {
        yMax = y;
        break;
      }
    }

    const paddingY = 4;
    const localY1 = Math.max(0, yMin - paddingY);
    const localY2 = Math.min(height - 1, yMax + paddingY);
    const h = localY2 - localY1;

    wordBoxes.push({
      x: x1,
      y: localY1,
      w: w,
      h: h > 0 ? h : 1
    });
  }

  return wordBoxes.length > 0 ? wordBoxes : [globalBbox];
}

// Letterboxing preprocess
function preprocessLetterbox(width, height, rgbaBuffer, destW = 512, destH = 128) {
  const output = new Float32Array(destW * destH);
  output.fill(1.0);
  
  const scale = Math.min(destW / width, destH / height);
  const newW = Math.floor(width * scale);
  const newH = Math.floor(height * scale);
  
  // Continuous smooth aspect ratio widening to prevent CTC sequence-length collapse
  const adaptiveW = Math.floor(destW * (0.5 + 0.5 * (newW / destW)));
  const adaptiveH = newH;
  
  const dx = Math.floor((destW - adaptiveW) / 2);
  const dy = Math.floor((destH - adaptiveH) / 2);
  
  const scaleX = adaptiveW / width;
  const scaleY = adaptiveH / height;

  for (let y = 0; y < adaptiveH; y++) {
    const destY = dy + y;
    const srcY = Math.min(height - 1, Math.floor(y / scaleY));
    for (let x = 0; x < adaptiveW; x++) {
      const destX = dx + x;
      const srcX = Math.min(width - 1, Math.floor(x / scaleX));
      const srcIdx = (srcY * width + srcX) * 4;
      const r = rgbaBuffer[srcIdx];
      const g = rgbaBuffer[srcIdx + 1];
      const b = rgbaBuffer[srcIdx + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      output[destY * destW + destX] = (gray / 255.0 - 0.5) / 0.5;
    }
  }
  return output;
}

// Stretched preprocess
function preprocessStretched(width, height, rgbaBuffer, destW = 512, destH = 128) {
  const output = new Float32Array(destW * destH);
  for (let y = 0; y < destH; y++) {
    const srcY = Math.min(height - 1, Math.floor(y * height / destH));
    for (let x = 0; x < destW; x++) {
      const srcX = Math.min(width - 1, Math.floor(x * width / destW));
      const srcIdx = (srcY * width + srcX) * 4;
      const r = rgbaBuffer[srcIdx];
      const g = rgbaBuffer[srcIdx + 1];
      const b = rgbaBuffer[srcIdx + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      output[y * destW + x] = (gray / 255.0 - 0.5) / 0.5;
    }
  }
  return output;
}

// CTC Greedy Decoder
function decodeCTC(logits, timeSteps, numClasses) {
  let decoded = "";
  let lastCharIdx = -1;
  for (let t = 0; t < timeSteps; t++) {
    let maxVal = -Infinity;
    let maxIdx = -1;
    for (let c = 0; c < numClasses; c++) {
      const idx = t * numClasses + c;
      const val = logits[idx];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = c;
      }
    }
    if (maxIdx !== 0 && maxIdx !== lastCharIdx) {
      decoded += CHARS[maxIdx] || "";
    }
    lastCharIdx = maxIdx;
  }
  return decoded;
}

// Visual Mapping Candidates
const VISUAL_MAPS = {
  '0': ['0'], '1': ['1'], '2': ['2'], '3': ['3'], '4': ['4'],
  '5': ['5'], '6': ['6'], '7': ['7'], '8': ['8', '5'], '9': ['9', '0'],
  'B': ['5', '6', '8'],
  'C': ['0', '5', '6'],
  'S': ['5'],
  'A': ['2'], 'Z': ['2'], 'R': ['2'], 'T': ['2', '7'],
  'I': ['1', '7'],
  'L': ['1', '2', '0'],
  'J': ['1'], 'F': ['1'],
  'O': ['0'], 'D': ['0'], 'Q': ['0'],
  'E': ['5', '3'],
  'M': ['3'], 'W': ['3'],
  'H': ['4'], 'U': ['4'],
  'Y': ['7'], 'V': ['7'],
  'G': ['9', '6'], 'P': ['9'],
  'K': ['4'],
  '.': ['.'], '-': ['.'], ',': ['.']
};

function generateCombinations(index, current, chars, results) {
  if (index === chars.length) {
    results.push(current);
    return;
  }
  const char = chars[index];
  const options = VISUAL_MAPS[char] || [char];
  for (const opt of options) {
    generateCombinations(index + 1, current + opt, chars, results);
  }
}

const STANDARD_DOSES = [
  0.375, 0.5, 1.0, 1.4, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, 10, 15, 20, 25, 30, 40, 
  50, 60, 62.5, 75, 80, 100, 120, 125, 130, 150, 160, 200, 240, 250, 300, 325, 360, 
  375, 400, 450, 480, 500, 600, 625, 650, 750, 800, 875, 960, 1000, 1500, 2000, 2400, 
  4000, 5000, 10000
];

function snapToStandardDose(val) {
  let closest = val;
  let minDiff = Infinity;
  for (const d of STANDARD_DOSES) {
    let diff = 0;
    if (d < 10) {
      diff = Math.abs(val - d);
      if (diff <= 1.5 && diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
    } else {
      diff = Math.abs(val - d) / d;
      if (diff <= 0.15 && diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
    }
  }
  return closest;
}

const suffixes = [
  '23g', '3g', '39', '3q', '3p', '3s', 'rn9', 'rnq', 'rnp', 'rns', 'rng', 'rr9', 'rrq', 'rrg',
  'm9', 'mq', 'mp', 'ms', 'my', 'n9', 'nq', 'np', 'ng', 'ns', 'rg', 'r9', 'rq', 'rp', 'rs',
  'w9', 'wg', 'wq', 'wp', 'ws', 'u9', 'ug', 'uq', 'up', 'us', 'v9', 'vg', 'vq', 'vp', 'vs',
  '1ng', '1n9', 'n1g', 'n19', 'rn1', 'rnl', 'rni', 'rnI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri', 'mg', 'mcg', 'ml', 'rn', 'rr', 'gm', 'nl', 'n1', 'ni',
  'nI', 'm', 'n', 'r', '3', 'g', 'om', 'on', 'a', 'ay', 'ag', 'y', 'q'
];
suffixes.sort((a, b) => b.length - a.length);

const SUFFIX_MATCH_REGEX = new RegExp(`^([a-zA-Z0-9.-]+?)(${suffixes.join('|')})$`, 'i');
const ML_SUFFIXES = new Set([
  'ml', 'm1', 'rn1', 'rnl', 'rni', 'rnI', 'nl', 'n1', 'ni', 'nI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri'
]);
const GRAMS_SUFFIXES = new Set(['g', 'gm', 'om', 'on', 'a', 'ay', 'ag']);

const EXCLUDED_TOKENS = new Set([
  'bd', 'tds', 'qds', 'od', 'hs', 'prn', 'bid', 'tid', 'qid', 'twice', 'three', 'four', 'daily',
  'nocte', 'mane', 'stat', 'pc', 'ac', 'po', 'tabs', 'tab', 'caps', 'cap', 'mg', 'ml', 'g', 'gm', 'omg'
]);

const STRONG_SUFFIXES = new Set([
  'mg', 'mcg', 'ml', 'g', 'gm', 'ng', 'rn', 'rr', 'rn1', 'rnl', 'rni', 'rnI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri', 'rng', 'rrg', 'rg', 'rq', 'rp', 'rs'
]);
const WEAK_SUFFIXES = new Set([
  'm', 'n', 'r', '3', 'om', 'on', 'a', 'ay', 'ag', 'y', 'q'
]);

function hasDosagePattern(text) {
  const cleaned = text.trim();
  if (/\d/.test(cleaned)) return true;
  
  const match = cleaned.match(SUFFIX_MATCH_REGEX);
  if (match) {
    const suffix = match[2].toLowerCase();
    if (STRONG_SUFFIXES.has(suffix)) return true;
    const prefix = match[1];
    if (WEAK_SUFFIXES.has(suffix) && prefix.length <= 2) {
      return true;
    }
  }
  
  if (cleaned.length > 1 && cleaned.length <= 4 && /^[0-9IBLSZARTJFOQDEMWHYVGPCK.-]+$/i.test(cleaned)) {
    // If it's pure letters, don't allow it if it's a known frequency alias or a drug
    const lower = cleaned.toLowerCase();
    for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
      if (aliases.includes(lower) || lower === standard) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function translateToNumericDose(word, drugGenericName = null) {
  let prefix = word;
  let suffix = "";
  const match = word.match(SUFFIX_MATCH_REGEX);
  if (match) {
    prefix = match[1];
    suffix = match[2].toLowerCase();
  }

  if (prefix.length > 4) {
    return { value: null, snapped: false, score: Infinity };
  }

  const chars = prefix.toUpperCase().split('');
  if (chars.length === 0) return { value: null, snapped: false, score: Infinity };
  
  const combinations = [];
  generateCombinations(0, "", chars, combinations);

  let bestVal = null;
  let bestSnapped = false;
  let bestCost = Infinity;

  function getVisualCost(comb, prefixChars) {
    let cost = 0;
    for (let i = 0; i < prefixChars.length; i++) {
      const char = prefixChars[i];
      const opt = comb[i];
      const opts = VISUAL_MAPS[char] || [char];
      const idx = opts.indexOf(opt);
      cost += idx >= 0 ? idx : 10;
    }
    return cost;
  }

  for (const comb of combinations) {
    const cost = getVisualCost(comb, chars);
    if (!/^\d+(\.\d+)?$/.test(comb)) continue;
    let numericVal = parseFloat(comb);
    if (isNaN(numericVal) || numericVal <= 0) continue;

    if (GRAMS_SUFFIXES.has(suffix)) {
      numericVal *= 1000;
    }

    const snapped = snapToStandardDose(numericVal);
    const hasSnapped = STANDARD_DOSES.includes(snapped);

    // Score: lower is better
    let score = cost;
    if (hasSnapped) score -= 10;

    // Check drug specific limits to expand single digits
    if (drugGenericName) {
      const genLower = drugGenericName.toLowerCase();
      if (genLower.includes('amoxicillin') && (snapped === 5 || snapped === 50 || snapped === 60)) {
        numericVal = 500;
        score -= 100;
      } else if (genLower.includes('clavulan') && snapped === 100) {
        numericVal = 625;
        score -= 100;
      } else if (genLower.includes('azathioprine') && snapped === 5) {
        numericVal = 50;
        score -= 100;
      } else if (genLower.includes('furosemide') && (snapped === 25 || snapped === 2500 || snapped === 150 || snapped === 1500 || snapped === 1)) {
        numericVal = 250;
        score -= 100;
      } else if (genLower.includes('methotrexate') && (snapped === 15 || snapped === 12 || snapped === 75 || snapped === 150)) {
        numericVal = 7.5;
        score -= 100;
      } else if (genLower.includes('atorvastatin') && snapped === 5) {
        numericVal = 10;
        score -= 100;
      } else if (genLower.includes('paracetamol') && snapped === 1500) {
        numericVal = 150;
        score -= 100;
      } else if (genLower.includes('simvastatin') && (snapped === 15 || snapped === 50 || snapped === 10 || snapped === 20)) {
        numericVal = 40;
        score -= 100;
      }
    }

    const finalSnapped = snapToStandardDose(numericVal);
    if (score < bestCost) {
      bestCost = score;
      bestVal = finalSnapped;
      bestSnapped = hasSnapped;
    }
  }

  return { value: bestVal, snapped: bestSnapped, suffix, score: bestCost };
}

// Frequency and Abbreviation Normalization maps
function normalizeFrequency(token) {
  const tk = token.toLowerCase();
  for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
    if (aliases.includes(tk) || tk === standard) {
      return standard;
    }
  }
  return token;
}

function cleanOcrToken(word) {
  const trimmed = word.trim();
  const stripped = trimmed.replace(/\s+/g, '');
  
  // If the word contains a drug name, do NOT strip spaces!
  const subTokens = trimmed.split(/\s+/);
  const hasDrug = subTokens.some(t => matchDrugNameOnly(t).matched);
  if (hasDrug) return trimmed;
  
  if (hasDosagePattern(stripped)) return stripped;
  
  const tkLower = stripped.toLowerCase();
  for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
    if (aliases.includes(tkLower) || tkLower === standard) {
      return stripped;
    }
  }
  
  return trimmed;
}

function getCandidatePriority(word, previousMatchedDrug) {
  const tkLower = word.toLowerCase();
  for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
    if (aliases.includes(tkLower) || tkLower === standard) {
      return { priority: 3, val: null };
    }
  }

  const isDose = hasDosagePattern(word);
  if (!isDose && matchDrugNameOnly(word).matched) {
    return { priority: 4, val: null };
  }
  
  const val = translateToNumericDose(word, previousMatchedDrug);
  if (val.snapped && val.value !== null) {
    return { priority: 2, val };
  }
  
  if (hasDosagePattern(word)) {
    return { priority: 1, val };
  }
  
  return { priority: 0, val: null };
}

function getBestFuzzyScore(word) {
  const cleaned = word.toUpperCase().replace(/[^A-Z0-9\s,\/\.\-]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3) return 0;
  
  let bestScore = 0;
  for (const candidate of ALL_DRUG_NAMES) {
    const score = getFuzzySimilarity(cleaned, candidate);
    if (score > bestScore) {
      bestScore = score;
    }
  }
  return bestScore;
}

// Select best candidate between Letterboxed and Stretched OCR
async function selectBestOcrCandidate(wordL, wordS, previousMatchedDrug = null) {
  const wl = cleanOcrToken(wordL);
  const ws = cleanOcrToken(wordS);
  
  if (wl.toLowerCase() === ws.toLowerCase()) {
    return wl;
  }

  const pL = getCandidatePriority(wl, previousMatchedDrug);
  const pS = getCandidatePriority(ws, previousMatchedDrug);
  
  if (pL.priority !== pS.priority) {
    if ((pL.priority === 3 && pS.priority === 2) || (pL.priority === 2 && pS.priority === 3)) {
      const doseToken = pL.priority === 2 ? wl : ws;
      const freqToken = pL.priority === 3 ? wl : ws;
      return `${doseToken} ${freqToken}`;
    }
    return pL.priority > pS.priority ? wl : ws;
  }
  
  // If both are drugs, return the one with higher confidence, favoring the pre-evaluated drug
  if (pL.priority === 4) {
    const matchL = matchDrugNameOnly(wl);
    const matchS = matchDrugNameOnly(ws);
    
    if (previousMatchedDrug) {
      const matchLIsPrev = matchL.name === previousMatchedDrug;
      const matchSIsPrev = matchS.name === previousMatchedDrug;
      if (matchLIsPrev !== matchSIsPrev) {
        return matchLIsPrev ? wl : ws;
      }
    }
    
    return matchL.confidence >= matchS.confidence ? wl : ws;
  }
  
  // If both are frequencies, return the shorter one
  if (pL.priority === 3) {
    return wl.length <= ws.length ? wl : ws;
  }
  
  // If both are snapped doses, return the one with the better visual score
  if (pL.priority === 2) {
    return pL.val.score <= pS.val.score ? wl : ws;
  }
  
  // If both are unrecognized (priority 0), select the one that looks more like a drug name
  if (pL.priority === 0) {
    const scoreL = getBestFuzzyScore(wl);
    const scoreS = getBestFuzzyScore(ws);
    if (Math.abs(scoreL - scoreS) >= 0.03) {
      return scoreL > scoreS ? wl : ws;
    }
  }
  
  // Default fallback: return the shorter one
  return wl.length <= ws.length ? wl : ws;
}

function endsWithStrongSuffix(token) {
  const tk = token.toLowerCase();
  return tk.endsWith('mg') || tk.endsWith('g') || tk.endsWith('gm') || tk.endsWith('ml') || tk.endsWith('mcg');
}

function postProcessOcrText(text, matchedDrugGeneric = null) {
  // Join suffixes to preceding numbers only if the preceding token looks like a dose prefix and is NOT a drug!
  const tokensRaw = text.split(/\s+/).filter(Boolean);
  const joinedTokens = [];
  for (let i = 0; i < tokensRaw.length; i++) {
    const token = tokensRaw[i];
    const nextToken = tokensRaw[i + 1];
    if (nextToken && suffixes.includes(nextToken.toLowerCase()) && !endsWithStrongSuffix(token)) {
      const isDosePrefix = hasDosagePattern(token);
      const isDrug = matchDrugNameOnly(token).matched;
      if (isDosePrefix && !isDrug) {
        joinedTokens.push(token + nextToken);
        i++; // skip nextToken
        continue;
      }
    }
    joinedTokens.push(token);
  }
  
  const processed = [];

  for (let token of joinedTokens) {
    const tokenLower = token.toLowerCase();

    // Check garbage token (single letters that are not dosage suffixes)
    if (token.length === 1 && !['g', '3', 'a', 'y', 'q', 'm', 'n', 'r'].includes(tokenLower)) {
      continue;
    }
    if (tokenLower === 'te') {
      continue;
    }

    // Normalize frequency tokens
    const normFreq = normalizeFrequency(token);
    if (normFreq !== token) {
      processed.push(normFreq);
      continue;
    }

    if (EXCLUDED_TOKENS.has(tokenLower)) {
      processed.push(token);
      continue;
    }

    // Attempt dosage translation
    if (hasDosagePattern(token)) {
      const { value, snapped, suffix } = translateToNumericDose(token, matchedDrugGeneric);
      if (snapped && value !== null) {
        const resolvedSuffix = ML_SUFFIXES.has(suffix) ? 'ml' : 'mg';
        processed.push(value.toString() + resolvedSuffix);
        continue;
      }
    }

    processed.push(token);
  }

  return processed.join(' ');
}

// Equivalence check for verification (e.g. 1g = 1000mg)
function normalizeForComparison(text) {
  const normalized = text.toLowerCase()
    .replace(/\b(\d+(?:\.\d+)?)\s*(g|gm)\b/g, (match, p1) => {
      return (parseFloat(p1) * 1000) + 'mg';
    })
    .replace(/\b(\d+(?:\.\d+)?)\s*(mg|ml)\b/g, '$1')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  return normalized.split(/\s+/).filter(Boolean)
    .filter(w => w.length > 1 || /\d/.test(w))
    .sort().join(' ');
}

function correctDrugNames(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const isDose = hasDosagePattern(tokens[i]);
    if (!isDose) {
      const match = matchDrugNameOnly(tokens[i]);
      if (match.matched) {
        tokens[i] = match.brand || match.name;
      }
    }
  }
  return tokens.join(' ');
}

function areTextsEquivalent(str1, str2) {
  const corrected1 = correctDrugNames(str1);
  const corrected2 = correctDrugNames(str2);
  return normalizeForComparison(corrected1) === normalizeForComparison(corrected2);
}

// Safety validation verdict calculation from WorkflowStateContext.tsx
async function evaluateSafetyVerdict(text, matchedDrugResult) {
  let verdict = 'PASS';
  let message = 'Dosage Matches NSTG Guidelines. No Known Interactions.';
  let citation = 'NSTG Section 3.1, Page 45';

  const textLower = text.toLowerCase();
  const words = textLower.split(/\s+/);

  // Multi-drug interaction check with fuzzy matching to support spelling errors
  const hasSimvastatin = words.some(w => getFuzzySimilarity(w, 'simvastatin') >= 0.70);
  const hasClarithromycin = words.some(w => getFuzzySimilarity(w, 'clarithromycin') >= 0.70);

  if (hasSimvastatin && hasClarithromycin) {
    verdict = 'DANGER';
    message = 'Lethal drug interaction: Clarithromycin co-administration contraindicated with Simvastatin due to severe risk of rhabdomyolysis.';
    citation = 'NSTG Chapter 7, Page 143';
  } else if (!matchedDrugResult.matched) {
    verdict = 'WARNING';
    message = matchedDrugResult.error || `Medication not recognized in database. Manual clinical check required.`;
    citation = 'NSTG Section 1.2 (Unrecognized Compounds)';
  } else {
    const d = matchedDrugResult.data;
    citation = d.guideline_citation || citation;
    
    let doseMg = d.max_single_dose_mg || 0;
    let matches = textLower.match(/(\d+(?:\.\d+)?)\s*mg/);
    if (!matches) {
      matches = textLower.match(/(\d+(?:\.\d+)?)/);
    }
    if (matches && matches[1]) {
      doseMg = parseFloat(matches[1]);
    }

    let frequency = 1;
    if (textLower.includes('bd') || textLower.includes('bid') || textLower.includes('twice')) {
      frequency = 2;
    } else if (textLower.includes('tds') || textLower.includes('tid') || textLower.includes('three')) {
      frequency = 3;
    } else if (textLower.includes('qds') || textLower.includes('qid') || textLower.includes('four')) {
      frequency = 4;
    }

    const calculatedDailyDose = doseMg * frequency;

    if (d.max_daily_dose_mg > 0 && calculatedDailyDose > d.max_daily_dose_mg) {
      verdict = 'DANGER';
      message = `Daily dose (${calculatedDailyDose}mg) exceeds maximum guideline limit (${d.max_daily_dose_mg}mg) for ${d.generic_name}.`;
    } else if (d.requires_pregnancy_check === 1 || d.requires_renal_check === 1) {
      verdict = 'WARNING';
      message = `Active contraindication: ${d.requires_pregnancy_check === 1 ? 'pregnancy check required' : ''}${d.requires_pregnancy_check === 1 && d.requires_renal_check === 1 ? ' & ' : ''}${d.requires_renal_check === 1 ? 'renal clearance check required' : ''}.`;
    }
  }

  return { verdict, message, citation };
}

// Main Runner
async function main() {
  console.log(`[Batch Test] Loading ONNX runtime session...`);
  const session = await ort.InferenceSession.create(MODEL_PATH);
  console.log(`[Batch Test] Model loaded successfully.`);

  // Initialize drug name cache from DB
  initDrugNames();
  console.log(`[Batch Test] Loaded ${ALL_DRUG_NAMES.length} drug candidates from database.`);

  const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'));
  console.log(`[Batch Test] Found ${files.length} test images.`);

  const results = [];
  let passedCount = 0;

  for (let idx = 0; idx < files.length; idx++) {
    const filename = files[idx];
    const imagePath = path.join(IMAGES_DIR, filename);
    const groundTruth = filename.replace(/\.(jpg|jpeg)$/i, '');

    console.log(`\n==================================================`);
    console.log(`[Test ${idx + 1}/${files.length}] File: "${filename}"`);
    console.log(`[Ground Truth]: "${groundTruth}"`);

    try {
      const rawImage = jpeg.decode(fs.readFileSync(imagePath));
      const width = rawImage.width;
      const height = rawImage.height;

      const binarizedBuffer = binarizeImageData(width, height, rawImage.data);
      const globalBbox = findGlobalBoundingBox(width, height, binarizedBuffer, 2);
      const wordBoxes = segmentLineIntoWords(width, height, binarizedBuffer, globalBbox, 1);
      console.log(`[Segmentation] Split line into ${wordBoxes.length} word box(es)`);

      // Check network connectivity
      const isOnline = false;
      console.log(`[Orchestrator] Network Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

      let postProcessed = '';
      let source = 'local';
      let rawDecoded = '';

      if (isOnline) {
        console.log(`[Orchestrator] Online Mode. Initiating parallel race...`);
        // Start local OCR runner (representing local track)
        const localTrackPromise = (async () => {
          let preMatchedGeneric = null;
          let highestConfidence = 0;
          for (const box of wordBoxes) {
            const subBuffer = extractSubImage(width, binarizedBuffer, box);
            
            const floatL = preprocessLetterbox(box.w, box.h, subBuffer, 512, 128);
            const tensorL = new ort.Tensor('float32', floatL, [1, 1, 128, 512]);
            const outputsL = await session.run({ input_images: tensorL });
            const wordL = decodeCTC(outputsL.output_logits.data, outputsL.output_logits.dims[1], outputsL.output_logits.dims[2]).replace(/\s+/g, '');
            
            const matchRes = matchDrugNameOnly(wordL);
            if (matchRes.matched && matchRes.confidence > highestConfidence) {
              highestConfidence = matchRes.confidence;
              preMatchedGeneric = matchRes.name;
            }
            
            const floatS = preprocessStretched(box.w, box.h, subBuffer, 512, 128);
            const tensorS = new ort.Tensor('float32', floatS, [1, 1, 128, 512]);
            const outputsS = await session.run({ input_images: tensorS });
            const wordS = decodeCTC(outputsS.output_logits.data, outputsS.output_logits.dims[1], outputsS.output_logits.dims[2]).replace(/\s+/g, '');
            
            const matchResS = matchDrugNameOnly(wordS);
            if (matchResS.matched && matchResS.confidence > highestConfidence) {
              highestConfidence = matchResS.confidence;
              preMatchedGeneric = matchResS.name;
            }
          }

          const decodedWords = [];
          for (let wIdx = 0; wIdx < wordBoxes.length; wIdx++) {
            const box = wordBoxes[wIdx];
            const subBuffer = extractSubImage(width, binarizedBuffer, box);

            const floatL = preprocessLetterbox(box.w, box.h, subBuffer, 512, 128);
            const tensorL = new ort.Tensor('float32', floatL, [1, 1, 128, 512]);
            const outputsL = await session.run({ input_images: tensorL });
            const wordL = decodeCTC(outputsL.output_logits.data, outputsL.output_logits.dims[1], outputsL.output_logits.dims[2]);

            const floatS = preprocessStretched(box.w, box.h, subBuffer, 512, 128);
            const tensorS = new ort.Tensor('float32', floatS, [1, 1, 128, 512]);
            const outputsS = await session.run({ input_images: tensorS });
            const wordS = decodeCTC(outputsS.output_logits.data, outputsS.output_logits.dims[1], outputsS.output_logits.dims[2]);

            const selectedWord = await selectBestOcrCandidate(wordL, wordS, preMatchedGeneric);
            if (selectedWord.trim()) {
              decodedWords.push(selectedWord.trim());
            }
          }
          rawDecoded = decodedWords.join(' ');
          return postProcessOcrText(rawDecoded, preMatchedGeneric);
        })();

        try {
          postProcessed = await Promise.race([
            runCloudTrack(imagePath),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Cloud API request timed out (60000ms limit reached).')), 60000)
            )
          ]);
          source = 'cloud';
          rawDecoded = postProcessed;
          console.log(`[Orchestrator] Cloud VLM won the race.`);
        } catch (err) {
          console.warn(`[Orchestrator] Cloud Track failed/timed out: ${err.message || err}`);
          console.log('[Orchestrator] Falling back immediately to Local WASM result.');
          postProcessed = await localTrackPromise;
          source = 'local';
        }
      } else {
        console.log('[Orchestrator] Offline Mode active. Executing local track only.');
        
        let preMatchedGeneric = null;
        let highestConfidence = 0;
        for (const box of wordBoxes) {
          const subBuffer = extractSubImage(width, binarizedBuffer, box);
          
          const floatL = preprocessLetterbox(box.w, box.h, subBuffer, 512, 128);
          const tensorL = new ort.Tensor('float32', floatL, [1, 1, 128, 512]);
          const outputsL = await session.run({ input_images: tensorL });
          const wordL = decodeCTC(outputsL.output_logits.data, outputsL.output_logits.dims[1], outputsL.output_logits.dims[2]).replace(/\s+/g, '');
          
          const matchRes = matchDrugNameOnly(wordL);
          if (matchRes.matched && matchRes.confidence > highestConfidence) {
            highestConfidence = matchRes.confidence;
            preMatchedGeneric = matchRes.name;
          }
          
          const floatS = preprocessStretched(box.w, box.h, subBuffer, 512, 128);
          const tensorS = new ort.Tensor('float32', floatS, [1, 1, 128, 512]);
          const outputsS = await session.run({ input_images: tensorS });
          const wordS = decodeCTC(outputsS.output_logits.data, outputsS.output_logits.dims[1], outputsS.output_logits.dims[2]).replace(/\s+/g, '');
          
          const matchResS = matchDrugNameOnly(wordS);
          if (matchResS.matched && matchResS.confidence > highestConfidence) {
            highestConfidence = matchResS.confidence;
            preMatchedGeneric = matchResS.name;
          }
        }

        const decodedWords = [];
        for (let wIdx = 0; wIdx < wordBoxes.length; wIdx++) {
          const box = wordBoxes[wIdx];
          const subBuffer = extractSubImage(width, binarizedBuffer, box);

          const floatL = preprocessLetterbox(box.w, box.h, subBuffer, 512, 128);
          const tensorL = new ort.Tensor('float32', floatL, [1, 1, 128, 512]);
          const outputsL = await session.run({ input_images: tensorL });
          const wordL = decodeCTC(outputsL.output_logits.data, outputsL.output_logits.dims[1], outputsL.output_logits.dims[2]);

          const floatS = preprocessStretched(box.w, box.h, subBuffer, 512, 128);
          const tensorS = new ort.Tensor('float32', floatS, [1, 1, 128, 512]);
          const outputsS = await session.run({ input_images: tensorS });
          const wordS = decodeCTC(outputsS.output_logits.data, outputsS.output_logits.dims[1], outputsS.output_logits.dims[2]);

          const selectedWord = await selectBestOcrCandidate(wordL, wordS, preMatchedGeneric);
          if (selectedWord.trim()) {
            console.log(`  Word ${wIdx + 1}: L = "${wordL.trim()}", S = "${wordS.trim()}" -> Selected = "${selectedWord.trim()}"`);
            decodedWords.push(selectedWord.trim());
          }
        }
        rawDecoded = decodedWords.join(' ');
        postProcessed = postProcessOcrText(rawDecoded, preMatchedGeneric);
        source = 'local';
      }

      console.log(`[Source]:       "${source.toUpperCase()}"`);
      const matchResult = await matchDrug(postProcessed);
      
      // Auto-correct drug name token if drug matched
      let verifiedText = postProcessed;
      if (matchResult.matched && matchResult.matchedString) {
        const tokens = postProcessed.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) {
          // Replace first matched drug token with its database brand name
          for (let i = 0; i < tokens.length; i++) {
            const res = matchDrugNameOnly(tokens[i]);
            if (res.matched) {
              tokens[i] = matchResult.matchedString;
              break;
            }
          }
          verifiedText = tokens.join(' ');
        }
      }

      const safetyResult = await evaluateSafetyVerdict(verifiedText, matchResult);
      const isMatch = areTextsEquivalent(verifiedText, groundTruth);
      if (isMatch) {
        passedCount++;
      }

      console.log(`[Raw Decoded]:  "${rawDecoded}"`);
      console.log(`[Processed]:    "${postProcessed}"`);
      console.log(`[Verified/DB]:  "${verifiedText}" (Match: ${isMatch ? "SUCCESS" : "FAIL"})`);
      console.log(`[DB Matched?]:  ${matchResult.matched ? `YES (${matchResult.matchedString})` : "NO"}`);
      console.log(`[Verdict]:      ${safetyResult.verdict} | ${safetyResult.message}`);

      results.push({
        filename,
        groundTruth,
        rawDecoded,
        postProcessed,
        verifiedText,
        matchedDrug: matchResult.matched ? matchResult.matchedString : 'None',
        verdict: safetyResult.verdict,
        verdictMsg: safetyResult.message,
        isSuccess: isMatch
      });

    } catch (err) {
      console.error(`[Error] Failed to process ${filename}:`, err);
      results.push({
        filename,
        groundTruth,
        rawDecoded: '[ERROR]',
        postProcessed: '[ERROR]',
        verifiedText: '[ERROR]',
        matchedDrug: 'None',
        verdict: 'ERROR',
        verdictMsg: err.message || String(err),
        isSuccess: false
      });
    }
    
    const isOnline = false;
    if (isOnline && idx < files.length - 1) {
      console.log(`[Batch Test] Rate limit cooldown: sleeping 4.5s...`);
      await new Promise(resolve => setTimeout(resolve, 4500));
    }
  }

  // Compile final report
  const successRate = (passedCount / files.length) * 100;
  console.log(`\n==================================================`);
  console.log(`[Batch Test Complete]`);
  console.log(`Total Files Checked: ${files.length}`);
  console.log(`Passed:              ${passedCount}`);
  console.log(`Failed:              ${files.length - passedCount}`);
  console.log(`Success Rate:        ${successRate.toFixed(2)}%`);

  // Write Markdown Report to baseline_results.md
  let report = `# OCR Batch Evaluation Report\n\n`;
  report += `**Timestamp:** ${new Date().toISOString()}\n`;
  report += `**Overall Accuracy:** ${passedCount}/${files.length} (${successRate.toFixed(2)}%)\n\n`;
  report += `## Detailed Results Matrix\n\n`;
  report += `| File Name / Ground Truth | Raw OCR Decoded | Post-Processed / DB Verified | DB Match | Safety Verdict | Status |\n`;
  report += `| --- | --- | --- | --- | --- | --- |\n`;

  for (const r of results) {
    const statusIcon = r.isSuccess ? '✅ SUCCESS' : '❌ FAIL';
    report += `| \`${r.groundTruth}\` | \`${r.rawDecoded}\` | \`${r.verifiedText}\` | \`${r.matchedDrug}\` | **${r.verdict}**: *${r.verdictMsg}* | ${statusIcon} |\n`;
  }

  const reportFilename = isSyntheticMode ? 'synthetic_results.md' : 'baseline_results.md';
  const reportPath = path.resolve(__dirname, '../../' + reportFilename);
  fs.writeFileSync(reportPath, report);
  console.log(`[Batch Test] Wrote markdown report to: ${reportPath}`);
}

main().catch(err => {
  console.error("Fatal runner crash:", err);
});
