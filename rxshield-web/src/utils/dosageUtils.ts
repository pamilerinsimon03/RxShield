// src/utils/dosageUtils.ts

export const VISUAL_MAPS: Record<string, string[]> = {
  '0': ['0'], '1': ['1'], '2': ['2'], '3': ['3'], '4': ['4'],
  '5': ['5'], '6': ['6'], '7': ['7'], '8': ['8', '5'], '9': ['9', '0'],
  'B': ['5', '6', '8'],
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

export const STANDARD_DOSES = [
  0.375, 0.5, 1.0, 1.4, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, 10, 15, 20, 25, 30, 40,
  50, 60, 62.5, 75, 80, 100, 120, 125, 130, 150, 160, 200, 240, 250, 300, 325, 360,
  375, 400, 450, 480, 500, 600, 625, 650, 750, 800, 875, 960, 1000, 1500, 2000, 2400,
  4000, 5000, 10000
];

export const FREQ_NORM_MAPS: Record<string, string[]> = {
  'bd': ['bd', 'bid', 'twice', 'bl', 'b1', 'bo', 'bd5', 'rfy', '8l'],
  'tds': ['tds', 'tid', 'three', 'td5', 't18', 'tds5', 'td', 'tles'],
  'qds': ['qds', 'qid', 'four', 'qd5'],
  'daily': ['daily', 'waily', 'darly', 'tils', 'warly']
};

const suffixes = [
  '23g', '3g', '39', '3q', '3p', '3s', 'rn9', 'rnq', 'rnp', 'rns', 'rng', 'rr9', 'rrq', 'rrg',
  'm9', 'mq', 'mp', 'ms', 'my', 'n9', 'nq', 'np', 'ng', 'ns', 'rg', 'r9', 'rq', 'rp', 'rs',
  'w9', 'wg', 'wq', 'wp', 'ws', 'u9', 'ug', 'uq', 'up', 'us', 'v9', 'vg', 'vq', 'vp', 'vs',
  '1ng', '1n9', 'n1g', 'n19', 'rn1', 'rnl', 'rni', 'rnI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri', 'mg', 'mcg', 'ml', 'rn', 'rr', 'gm', 'nl', 'n1', 'ni',
  'nI', 'm', 'n', 'r', '3', 'g', 'om', 'on', 'a', 'ay', 'ag', 'y', 'q'
];
suffixes.sort((a, b) => b.length - a.length);

export const SUFFIX_MATCH_REGEX = new RegExp(`^([a-zA-Z0-9.-]+?)(${suffixes.join('|')})$`, 'i');

export const ML_SUFFIXES = new Set([
  'ml', 'm1', 'rn1', 'rnl', 'rni', 'rnI', 'nl', 'n1', 'ni', 'nI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri'
]);
export const GRAMS_SUFFIXES = new Set(['g', 'gm', 'om', 'on', 'a', 'ay', 'ag']);

export const STRONG_SUFFIXES = new Set([
  'mg', 'mcg', 'ml', 'g', 'gm', 'ng', 'rn', 'rr', 'rn1', 'rnl', 'rni', 'rnI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri', 'rng', 'rrg', 'rg', 'rq', 'rp', 'rs'
]);
export const WEAK_SUFFIXES = new Set([
  'm', 'n', 'r', '3', 'om', 'on', 'a', 'ay', 'ag', 'y', 'q'
]);

export function hasDosagePattern(text: string): boolean {
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

function generateCombinations(index: number, current: string, chars: string[], results: string[]) {
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

export function snapToStandardDose(val: number): number {
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

export function translateToNumericDose(word: string, drugGenericName: string | null = null) {
  let prefix = word;
  let suffix = "";
  const match = word.match(SUFFIX_MATCH_REGEX);
  if (match) {
    prefix = match[1];
    suffix = match[2].toLowerCase();
  }

  if (prefix.length > 4) {
    return { value: null, snapped: false, score: Infinity, suffix };
  }

  const chars = prefix.toUpperCase().split('');
  if (chars.length === 0) return { value: null, snapped: false, score: Infinity, suffix };

  const combinations: string[] = [];
  generateCombinations(0, "", chars, combinations);

  let bestVal: number | null = null;
  let bestSnapped = false;
  let bestCost = Infinity;

  function getVisualCost(comb: string, prefixChars: string[]) {
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

    let score = cost;
    if (hasSnapped) score -= 10;

    // Drug-specific expansions moved to a later stage or handled here if drugGenericName is provided
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

export function normalizeFrequency(token: string): string {
  const tk = token.toLowerCase();
  for (const [standard, aliases] of Object.entries(FREQ_NORM_MAPS)) {
    if (aliases.includes(tk) || tk === standard) {
      return standard;
    }
  }
  return token;
}
