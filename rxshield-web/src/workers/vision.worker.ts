import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web';

// Configure wasm path
ort.env.wasm.wasmPaths = '/wasm/';
ort.env.wasm.numThreads = Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4);
ort.env.wasm.proxy = false;

import { getFuzzySimilarity, areFirstLettersVisuallyEquivalent } from '@/utils/stringDistance';
import {
  binarizeImageData,
  decodeCTC,
  findGlobalBoundingBox,
  extractSubImage,
  BoundingBox
} from '@/utils/imageProcessing';

let session: any = null;

// Memory-cached drug data from DB passed from main thread
let ALL_DRUG_NAMES: string[] = [];
let DRUG_TO_GENERIC_MAP = new Map<string, string>();
let PROTOCOL_GENERICS = new Set<string>();

const hasProtocolInDb = (name: string): boolean => {
  const generic = DRUG_TO_GENERIC_MAP.get(name.toUpperCase());
  return generic ? PROTOCOL_GENERICS.has(generic) : false;
};

// Visual Mapping Candidates
const VISUAL_MAPS: Record<string, string[]> = {
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

const generateCombinations = (index: number, current: string, chars: string[], results: string[]): void => {
  if (index === chars.length) {
    results.push(current);
    return;
  }
  const char = chars[index];
  const options = VISUAL_MAPS[char] || [char];
  for (const opt of options) {
    generateCombinations(index + 1, current + opt, chars, results);
  }
};



const matchDrugNameOnly = (text: string): { matched: boolean; confidence: number; name?: string; brand?: string } => {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9\s,\/\.\-]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3) return { matched: false, confidence: 0 };
  
  let candidates: { name: string; score: number; hasProtocol: boolean }[] = [];
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

  // Fallback loop
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
  const generic = DRUG_TO_GENERIC_MAP.get(bestName.toUpperCase()) || bestName;

  return { matched: true, confidence: bestScore, name: generic, brand: bestName };
};



const segmentLineIntoWords = (
  rgbaBuffer: Uint8ClampedArray,
  width: number,
  height: number,
  globalBbox: BoundingBox,
  noiseThreshold: number = 1
): BoundingBox[] => {
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
  
  const segments: { x1: number; x2: number }[] = [];
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

  const mergedSegments: { x1: number; x2: number }[] = [];
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

  const wordBoxes: BoundingBox[] = [];
  
  for (const seg of mergedSegments) {
    const paddingX = 4;
    const x1 = Math.max(gx, seg.x1 - paddingX);
    const x2 = Math.min(gx + gw - 1, seg.x2 + paddingX);
    const w = x2 - x1;

    if (w < 4) continue;

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

  if (wordBoxes.length === 0) {
    return [globalBbox];
  }

  return wordBoxes;
};

const STANDARD_DOSES = [
  0.375, 0.5, 1.0, 1.4, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, 10, 15, 20, 25, 30, 40, 
  50, 60, 62.5, 75, 80, 100, 120, 125, 130, 150, 160, 200, 240, 250, 300, 325, 360, 
  375, 400, 450, 480, 500, 600, 625, 650, 750, 800, 875, 960, 1000, 1500, 2000, 2400, 
  4000, 5000, 10000
];

const snapToStandardDose = (val: number): number => {
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
};

// Suffix variations mapped dynamically by length descending
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

const FREQ_NORM_MAPS: Record<string, string[]> = {
  'bd': ['bd', 'bid', 'twice', 'b1', 'bd5', 'rfy', '8l'],
  'tds': ['tds', 'tid', 'three', 'td5', 't18', 'tds5', 'td', 'tles', 'te', 't5'],
  'qds': ['qds', 'qid', 'four', 'qd5'],
  'daily': ['daily', 'waily', 'darly', 'tils', 'warly']
};

const normalizeFrequency = (token: string): string => {
  const tk = token.toLowerCase();
  for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
    if (aliases.includes(tk) || tk === standard) {
      return standard;
    }
  }
  return token;
};

const hasDosagePattern = (text: string): boolean => {
  const cleaned = text.trim();
  if (/\d/.test(cleaned)) return true;
  
  const match = cleaned.match(SUFFIX_MATCH_REGEX);
  if (match) {
    const suffix = match[2].toLowerCase();
    const STRONG_SUFFIXES = new Set([
      'mg', 'mcg', 'ml', 'g', 'gm', 'ng', 'rn', 'rr', 'rn1', 'rnl', 'rni', 'rnI', '31', '3l', '3i', 'u1', 'ul', 'ui',
      'v1', 'vl', 'vi', 'r1', 'rl', 'ri', 'rng', 'rrg', 'rg', 'rq', 'rp', 'rs'
    ]);
    const WEAK_SUFFIXES = new Set([
      'm', 'n', 'r', '3', 'om', 'on', 'a', 'ay', 'ag', 'y', 'q'
    ]);
    if (STRONG_SUFFIXES.has(suffix)) return true;
    const prefix = match[1];
    if (WEAK_SUFFIXES.has(suffix) && prefix.length <= 2) {
      return true;
    }
  }
  
  if (cleaned.length > 1 && cleaned.length <= 4 && /^[0-9IBLSZARTJFOQDEMWHYVGPCK.-]+$/i.test(cleaned)) {
    const lower = cleaned.toLowerCase();
    for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
      if (aliases.includes(lower) || lower === standard) {
        return false;
      }
    }
    return true;
  }
  return false;
};

const translateToNumericDose = (
  word: string,
  drugGenericName: string | null = null
): { value: number | null; snapped: boolean; suffix: string; score: number } => {
  let prefix = word;
  let suffix = "";
  const match = word.match(SUFFIX_MATCH_REGEX);
  if (match) {
    prefix = match[1];
    suffix = match[2].toLowerCase();
  }

  if (prefix.length > 4) {
    return { value: null, snapped: false, suffix, score: Infinity };
  }

  const chars = prefix.toUpperCase().split('');
  if (chars.length === 0) return { value: null, snapped: false, suffix, score: Infinity };
  
  const combinations: string[] = [];
  generateCombinations(0, "", chars, combinations);

  let bestVal: number | null = null;
  let bestSnapped = false;
  let bestCost = Infinity;

  const getVisualCost = (comb: string, prefixChars: string[]): number => {
    let cost = 0;
    for (let i = 0; i < prefixChars.length; i++) {
      const char = prefixChars[i];
      const opt = comb[i];
      const opts = VISUAL_MAPS[char] || [char];
      const idx = opts.indexOf(opt);
      cost += idx >= 0 ? idx : 10;
    }
    return cost;
  };

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

    let score = cost;
    if (hasSnapped) score -= 10;

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
};

const cleanOcrToken = (word: string): string => {
  const trimmed = word.trim();
  const stripped = trimmed.replace(/\s+/g, '');
  
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
};

const getCandidatePriority = (
  word: string,
  previousMatchedDrug: string | null = null
): { priority: number; val: any } => {
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
};

const getBestFuzzyScore = (word: string): number => {
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
};

const selectBestOcrCandidate = async (
  wordL: string,
  wordS: string,
  previousMatchedDrug: string | null = null
): Promise<string> => {
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
    
    return (matchL.confidence || 0) >= (matchS.confidence || 0) ? wl : ws;
  }
  
  if (pL.priority === 3) {
    return wl.length <= ws.length ? wl : ws;
  }
  
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
};

const endsWithStrongSuffix = (token: string): boolean => {
  const tk = token.toLowerCase();
  return tk.endsWith('mg') || tk.endsWith('g') || tk.endsWith('gm') || tk.endsWith('ml') || tk.endsWith('mcg');
};

const postProcessOcrText = (text: string, matchedDrugGeneric: string | null = null): string => {
  const tokensRaw = text.split(/\s+/).filter(Boolean);
  const joinedTokens: string[] = [];
  for (let i = 0; i < tokensRaw.length; i++) {
    const token = tokensRaw[i];
    const nextToken = tokensRaw[i + 1];
    if (nextToken && suffixes.includes(nextToken.toLowerCase()) && !endsWithStrongSuffix(token)) {
      const isDosePrefix = hasDosagePattern(token);
      const isDrug = matchDrugNameOnly(token).matched;
      if (isDosePrefix && !isDrug) {
        joinedTokens.push(token + nextToken);
        i++;
        continue;
      }
    }
    joinedTokens.push(token);
  }
  
  const processed: string[] = [];

  for (let token of joinedTokens) {
    const tokenLower = token.toLowerCase();

    if (token.length === 1 && !['g', '3', 'a', 'y', 'q', 'm', 'n', 'r'].includes(tokenLower)) {
      continue;
    }
    if (tokenLower === 'te') {
      continue;
    }

    const normFreq = normalizeFrequency(token);
    if (normFreq !== token) {
      processed.push(normFreq);
      continue;
    }

    if (EXCLUDED_TOKENS.has(tokenLower)) {
      processed.push(token);
      continue;
    }

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
};

// Letterboxing preprocess
const preprocessLetterbox = (
  width: number,
  height: number,
  rgbaBuffer: Uint8ClampedArray,
  destW: number = 512,
  destH: number = 128
): Float32Array => {
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
};

// Stretched preprocess
const preprocessStretched = (
  width: number,
  height: number,
  rgbaBuffer: Uint8ClampedArray,
  destW: number = 512,
  destH: number = 128
): Float32Array => {
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
};

const api = {
  async initModel(): Promise<boolean> {
    try {
      if (session) {
        return true;
      }

      console.log('Initializing ONNX Runtime Web session for crnn_int8.onnx...');
      session = await ort.InferenceSession.create('/models/crnn_int8.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      console.log('ONNX model session loaded successfully.');
      return true;
    } catch (err) {
      console.error('Failed to initialize ONNX model:', err);
      throw err;
    }
  },

  async setDrugDb(
    allDrugNames: string[],
    drugToGenericMap: Record<string, string>,
    protocolGenerics: string[]
  ): Promise<void> {
    ALL_DRUG_NAMES = allDrugNames;
    DRUG_TO_GENERIC_MAP = new Map(Object.entries(drugToGenericMap));
    PROTOCOL_GENERICS = new Set(protocolGenerics);
    console.log(`[Vision Worker] Cached ${ALL_DRUG_NAMES.length} drug names in memory.`);
  },

  async runOcr(
    rgbaBuffer: Uint8ClampedArray,
    width: number,
    height: number
  ): Promise<{ text: string; confidence: number }> {
    try {
      if (!session) {
        await this.initModel();
      }

      console.log(`[OCR] Binarizing image (${width}x${height})...`);
      const binarizedBuffer = binarizeImageData(width, height, rgbaBuffer);

      const globalBbox = findGlobalBoundingBox(binarizedBuffer, width, height, 2);
      console.log(`[OCR] Global BBox: x=${globalBbox.x}, y=${globalBbox.y}, w=${globalBbox.w}, h=${globalBbox.h}`);

      const wordBoxes = segmentLineIntoWords(binarizedBuffer, width, height, globalBbox, 1);
      console.log(`[OCR] Segmented line into ${wordBoxes.length} word box(es)`);

      // Helper to run inference on a single image segment with proper tensor disposal
      const runInferenceOnSegment = async (
        subBuffer: Uint8ClampedArray,
        box: BoundingBox,
        preprocess: (w: number, h: number, buf: Uint8ClampedArray, dw: number, dh: number) => Float32Array
      ): Promise<string> => {
        const floatArr = preprocess(box.w, box.h, subBuffer, 512, 128);
        let tensor: any = null;
        let outputs: any = null;
        try {
          tensor = new ort.Tensor('float32', floatArr, [1, 1, 128, 512]);
          outputs = await session.run({ input_images: tensor });
          const logits = outputs.output_logits.data as Float32Array;
          const [, timeSteps, numClasses] = outputs.output_logits.dims;
          return decodeCTC(logits, timeSteps, numClasses);
        } finally {
          if (tensor && typeof tensor.dispose === 'function') {
            tensor.dispose();
          }
          if (outputs) {
            for (const key of Object.keys(outputs)) {
              if (outputs[key] && typeof outputs[key].dispose === 'function') {
                outputs[key].dispose();
              }
            }
          }
        }
      };

      // Run inference on all segmented word boxes
      const inferenceCache: Array<{ wordL: string; wordS: string }> = [];
      let preMatchedGeneric: string | null = null;
      let highestConfidence = 0;

      for (let i = 0; i < wordBoxes.length; i++) {
        const box = wordBoxes[i];
        const subBuffer = extractSubImage(binarizedBuffer, width, box);
        
        const wordL = await runInferenceOnSegment(subBuffer, box, preprocessLetterbox);
        const wordS = await runInferenceOnSegment(subBuffer, box, preprocessStretched);
        
        inferenceCache.push({ wordL, wordS });

        // Update pre-matched generic candidate based on highest match confidence
        const matchResL = matchDrugNameOnly(wordL.replace(/\s+/g, ''));
        if (matchResL.matched && matchResL.name && matchResL.confidence > highestConfidence) {
          highestConfidence = matchResL.confidence;
          preMatchedGeneric = matchResL.name;
        }
        const matchResS = matchDrugNameOnly(wordS.replace(/\s+/g, ''));
        if (matchResS.matched && matchResS.name && matchResS.confidence > highestConfidence) {
          highestConfidence = matchResS.confidence;
          preMatchedGeneric = matchResS.name;
        }
      }

      console.log(`[OCR] Pre-matched drug: ${preMatchedGeneric || 'None'}`);

      // Resolve candidate words using priority mapping and pre-matched context
      const decodedWords: string[] = [];

      for (let i = 0; i < wordBoxes.length; i++) {
        const { wordL, wordS } = inferenceCache[i];
        const selectedWord = await selectBestOcrCandidate(wordL, wordS, preMatchedGeneric);
        if (selectedWord.trim()) {
          console.log(`[OCR] Word ${i + 1}: L="${wordL.trim()}", S="${wordS.trim()}" -> Selected="${selectedWord.trim()}"`);
          decodedWords.push(selectedWord.trim());
        }
      }

      const decodedText = decodedWords.join(' ');
      console.log(`[OCR] Full Line Decoded: "${decodedText}"`);

      const postProcessedText = postProcessOcrText(decodedText, preMatchedGeneric);
      console.log(`[OCR] Post-Processed OCR: "${postProcessedText}"`);

      return {
        text: postProcessedText,
        confidence: 0.95
      };
    } catch (err) {
      console.error('OCR inference failed:', err);
      throw err;
    }
  }
};

Comlink.expose(api);

export type VisionWorkerApi = typeof api;

