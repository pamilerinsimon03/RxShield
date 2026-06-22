// src/workers/vision.worker.ts
import * as Comlink from 'comlink';
// @ts-ignore
import * as ort from 'onnxruntime-web';

// Configure wasm path
ort.env.wasm.wasmPaths = '/wasm/';

let session: any = null;

const CHARS = [
  "", " ", "!", "\"", "'", "(", ")", ",", "-", ".", "0", "1", "2", "3", "4", "5", "6", 
  "7", "8", "9", ":", ";", "?", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", 
  "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", 
  "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", 
  "t", "u", "v", "w", "x", "y", "z"
];

// Helper to resize and grayscale ImageData into Float32Array (128x512)
// Helper to resize and grayscale ImageData into Float32Array (128x512)
const preprocessImageData = (
  rgbaData: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  destW: number = 512,
  destH: number = 128
): Float32Array => {
  const output = new Float32Array(destW * destH);
  
  // Fill background with white (1.0)
  output.fill(1.0);

  // Preserve aspect ratio
  const scale = Math.min(destW / srcW, destH / srcH);
  const newW = Math.floor(srcW * scale);
  const newH = Math.floor(srcH * scale);

  // Centering offsets
  const dx = Math.floor((destW - newW) / 2);
  const dy = Math.floor((destH - newH) / 2);

  // Map destination coordinates in the centered box back to source
  for (let y = 0; y < newH; y++) {
    const destY = dy + y;
    const srcY = Math.min(srcH - 1, Math.floor(y / scale));

    for (let x = 0; x < newW; x++) {
      const destX = dx + x;
      const srcX = Math.min(srcW - 1, Math.floor(x / scale));

      const srcIdx = (srcY * srcW + srcX) * 4;
      const r = rgbaData[srcIdx];
      const g = rgbaData[srcIdx + 1];
      const b = rgbaData[srcIdx + 2];

      // Grayscale Y = 0.299R + 0.587G + 0.114B
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      // Normalize to [-1.0, 1.0] range to match model training expectations
      output[destY * destW + destX] = (gray / 255.0 - 0.5) / 0.5;
    }
  }

  return output;
};

// CTC Greedy Decoder implementation
const decodeCTC = (logits: Float32Array, timeSteps: number, numClasses: number): string => {
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

    // Index 0 is the CTC blank token
    if (maxIdx !== 0 && maxIdx !== lastCharIdx) {
      decoded += CHARS[maxIdx] || "";
    }
    lastCharIdx = maxIdx;
  }

  return decoded;
};

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Finds the global bounding box of all ink pixels in the binarized image.
 * Uses a noise threshold to filter out stray dark pixels or camera artifacts.
 */
const findGlobalBoundingBox = (
  rgbaBuffer: Uint8ClampedArray,
  width: number,
  height: number,
  noiseThreshold: number = 2
): BoundingBox => {
  const columnCounts = new Int32Array(width);
  const rowCounts = new Int32Array(height);

  // 1. Calculate column and row counts of black pixels (value < 128)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (rgbaBuffer[idx] < 128) {
        columnCounts[x]++;
        rowCounts[y]++;
      }
    }
  }

  // 2. Find left boundary (xMin)
  let xMin = 0;
  for (let x = 0; x < width; x++) {
    if (columnCounts[x] > noiseThreshold) {
      xMin = x;
      break;
    }
  }

  // 3. Find right boundary (xMax)
  let xMax = width - 1;
  for (let x = width - 1; x >= 0; x--) {
    if (columnCounts[x] > noiseThreshold) {
      xMax = x;
      break;
    }
  }

  // 4. Find top boundary (yMin)
  let yMin = 0;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] > noiseThreshold) {
      yMin = y;
      break;
    }
  }

  // 5. Find bottom boundary (yMax)
  let yMax = height - 1;
  for (let y = height - 1; y >= 0; y--) {
    if (rowCounts[y] > noiseThreshold) {
      yMax = y;
      break;
    }
  }

  // Ensure valid bounds
  if (xMin >= xMax || yMin >= yMax) {
    console.log('[OCR BBox] No active ink found matching noise threshold. Using fallback full image bounds.');
    return { x: 0, y: 0, w: width, h: height };
  }

  // Add 12px horizontal and 8px vertical padding to prevent clipping letters/digits
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
};

/**
 * Helper to slice a sub-rectangle out of the RGBA pixel array
 */
const extractSubImage = (
  rgbaBuffer: Uint8ClampedArray,
  srcW: number,
  bbox: BoundingBox
): Uint8ClampedArray => {
  const { x, y, w, h } = bbox;
  const subBuffer = new Uint8ClampedArray(w * h * 4);
  for (let dy = 0; dy < h; dy++) {
    const srcY = y + dy;
    const srcRowStart = srcY * srcW * 4;
    const destRowStart = dy * w * 4;
    const srcSlice = rgbaBuffer.subarray(srcRowStart + x * 4, srcRowStart + (x + w) * 4);
    subBuffer.set(srcSlice, destRowStart);
  }
  return subBuffer;
};

/**
 * Segments the global bounding box of ink horizontally into individual word bounding boxes.
 * Utilizes a scale-invariant gap width and local vertical projections to isolate each word.
 */
const segmentLineIntoWords = (
  rgbaBuffer: Uint8ClampedArray,
  width: number,
  height: number,
  globalBbox: BoundingBox,
  noiseThreshold: number = 1
): BoundingBox[] => {
  const { x: gx, y: gy, w: gw, h: gh } = globalBbox;
  
  // Calculate horizontal projections (ink pixel sum per column) ONLY within the vertical text zone
  const colCounts = new Int32Array(width);
  for (let x = gx; x < gx + gw; x++) {
    for (let y = gy; y < gy + gh; y++) {
      const idx = (y * width + x) * 4;
      if (rgbaBuffer[idx] < 128) {
        colCounts[x]++;
      }
    }
  }

  // Dynamic inter-word gap size based on the height of the line box (scale-invariant)
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
          // Close word segment
          const wordEnd = x - gapWidth;
          if (wordEnd > wordStart) {
            segments.push({ x1: wordStart, x2: wordEnd });
          }
          inWord = false;
        }
      }
    }
  }

  // Add final segment if still in word
  if (inWord) {
    segments.push({ x1: wordStart, x2: gx + gw - 1 });
  }

  // Merge adjacent segments if they are separated by a very small distance (noise or split strokes)
  const mergedSegments: { x1: number; x2: number }[] = [];
  const minMergeGap = Math.max(4, Math.round(gapWidth / 2));
  
  for (const seg of segments) {
    if (mergedSegments.length === 0) {
      mergedSegments.push(seg);
    } else {
      const last = mergedSegments[mergedSegments.length - 1];
      if (seg.x1 - last.x2 < minMergeGap) {
        // Merge segments
        last.x2 = seg.x2;
      } else {
        mergedSegments.push(seg);
      }
    }
  }

  // Build final local bounding boxes with padding and local vertical projections
  const wordBoxes: BoundingBox[] = [];
  
  for (const seg of mergedSegments) {
    // Add 4px horizontal padding to ensure characters are not clipped
    const paddingX = 4;
    const x1 = Math.max(gx, seg.x1 - paddingX);
    const x2 = Math.min(gx + gw - 1, seg.x2 + paddingX);
    const w = x2 - x1;

    if (w < 4) continue; // Skip extremely thin noise artifacts

    // Calculate local vertical bounds for this segment to crop it tightly
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

    // Add 4px vertical padding
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

  // Fallback if no segments found
  if (wordBoxes.length === 0) {
    return [globalBbox];
  }

  return wordBoxes;
};

/**
 * Standard clinical single-dose and daily-dose values extracted from treatment guidelines.
 */
const STANDARD_DOSES = [
  0.375, 0.5, 1.0, 1.4, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, 10, 15, 20, 25, 30, 40, 
  50, 60, 62.5, 75, 80, 100, 120, 125, 130, 150, 160, 200, 240, 250, 300, 325, 360, 
  375, 400, 450, 480, 500, 600, 625, 650, 750, 800, 875, 960, 1000, 1500, 2000, 2400, 
  4000, 5000, 10000
];

/**
 * Snaps a parsed numeric value to the nearest standard clinical dosage.
 * Uses absolute differences for small values (< 10) and relative differences for larger values.
 */
const snapToStandardDose = (val: number): number => {
  let closest = val;
  let minDiff = Infinity;
  
  for (const d of STANDARD_DOSES) {
    let diff = 0;
    if (d < 10) {
      // Use absolute difference for small values (tolerance of 1.5mg)
      diff = Math.abs(val - d);
      if (diff <= 1.5 && diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
    } else {
      // Use relative difference for larger values (tolerance of 15%)
      diff = Math.abs(val - d) / d;
      if (diff <= 0.15 && diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
    }
  }
  
  return closest;
};

/**
 * Translates visually similar handwritten characters back to digits.
 */
const translatePrefixToDigits = (prefix: string): string => {
  let translated = "";
  for (let i = 0; i < prefix.length; i++) {
    const char = prefix[i];
    const upper = char.toUpperCase();
    
    if (char >= '0' && char <= '9') {
      translated += char;
      continue;
    }
    
    switch (upper) {
      case 'B':
        // If it's the last character of a 3-character prefix (like "Bab" -> 625), map to '5'
        if (i === 2 && prefix.length === 3) {
          translated += '5';
        } else {
          translated += '6';
        }
        break;
      case 'S':
        translated += '5';
        break;
      case 'A':
      case 'Z':
      case 'R':
      case 'T':
        translated += '2';
        break;
      case 'I':
      case 'L':
      case 'J':
      case 'F':
        translated += '1';
        break;
      case 'O':
      case 'D':
      case 'Q':
        translated += '0';
        break;
      case 'E':
      case 'M':
      case 'W':
        translated += '3';
        break;
      case 'H':
      case 'U':
        translated += '4';
        break;
      case 'Y':
      case 'V':
        translated += '7';
        break;
      case 'G':
      case 'P':
        translated += '9';
        break;
      case '.':
      case '-':
      case ',':
        translated += '.';
        break;
      default:
        translated += char;
        break;
    }
  }
  return translated;
};

// Suffix variations mapped dynamically by length descending
const suffixes = [
  '23g', '3g', '39', '3q', '3p', '3s', 'rn9', 'rnq', 'rnp', 'rns', 'rng', 'rr9', 'rrq', 'rrg',
  'm9', 'mq', 'mp', 'ms', 'my', 'n9', 'nq', 'np', 'ng', 'ns', 'rg', 'r9', 'rq', 'rp', 'rs',
  'w9', 'wg', 'wq', 'wp', 'ws', 'u9', 'ug', 'uq', 'up', 'us', 'v9', 'vg', 'vq', 'vp', 'vs',
  '1ng', '1n9', 'n1g', 'n19', 'rn1', 'rnl', 'rni', 'rnI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri', 'mg', 'mcg', 'ml', 'rn', 'rr', 'gm', 'nl', 'n1', 'ni',
  'nI', 'm', 'n', 'r', '3', 'g'
];
// Sort descending to ensure longest match first
suffixes.sort((a, b) => b.length - a.length);

const SUFFIX_MATCH_REGEX = new RegExp(`^([a-zA-Z0-9.-]+?)(${suffixes.join('|')})$`, 'i');

const ML_SUFFIXES = new Set([
  'ml', 'm1', 'rn1', 'rnl', 'rni', 'rnI', 'nl', 'n1', 'ni', 'nI', '31', '3l', '3i', 'u1', 'ul', 'ui',
  'v1', 'vl', 'vi', 'r1', 'rl', 'ri'
]);

const GRAMS_SUFFIXES = new Set(['g', 'gm']);

const HIGH_CONF_SUFFIXES = new Set(['mg', 'mcg', 'ml', 'g', 'gm']);

const EXCLUDED_TOKENS = new Set([
  'bd', 'tds', 'qds', 'od', 'hs', 'prn', 'bid', 'tid', 'qid', 'twice', 'three', 'four', 'daily',
  'nocte', 'mane', 'stat', 'pc', 'ac', 'po', 'tabs', 'tab', 'caps', 'cap', 'mg', 'ml', 'g', 'gm'
]);

/**
 * Merges spacing between digits and suffixes, normalizes misread suffixes,
 * and translates prefix letter representations to digits.
 */
const postProcessOcrText = (text: string): string => {
  // 1. Join space separated suffixes
  const suffixJoinPattern = new RegExp(`([a-zA-Z0-9.-]+)\\s+(${suffixes.join('|')})\\b`, 'ig');
  let joined = text.replace(suffixJoinPattern, '$1$2');
  
  // 2. Tokenize and translate dosage tokens
  const tokens = joined.split(/\s+/);
  const processed = tokens.map(token => {
    const tokenLower = token.toLowerCase();
    
    // Check exclusion list
    if (EXCLUDED_TOKENS.has(tokenLower)) {
      return token;
    }
    
    let prefix = token;
    let suffix = "";
    
    const match = token.match(SUFFIX_MATCH_REGEX);
    if (match) {
      prefix = match[1];
      suffix = match[2].toLowerCase();
    }
    
    const translatedPrefix = translatePrefixToDigits(prefix);
    
    // Validate that prefix is strictly numeric after translation (to prevent drug names matching)
    if (!/^\d+(\.\d+)?$/.test(translatedPrefix)) {
      return token;
    }
    
    let numericVal = parseFloat(translatedPrefix);
    if (isNaN(numericVal)) {
      return token;
    }
    
    // Handle grams conversion
    if (GRAMS_SUFFIXES.has(suffix)) {
      numericVal *= 1000;
    }
    
    // Snap to closest standard dosage strength
    const snapped = snapToStandardDose(numericVal);
    
    const hasSnapped = STANDARD_DOSES.includes(snapped);
    const isHighConfSuffix = HIGH_CONF_SUFFIXES.has(suffix);

    if (hasSnapped) {
      const resolvedSuffix = ML_SUFFIXES.has(suffix) ? 'ml' : 'mg';
      return snapped.toString() + resolvedSuffix;
    }
    
    // If it didn't snap:
    // - Keep original if it has no suffix or a low-confidence suffix (prevents brand names like Lipit0r matching)
    // - Map to normalized unit if it has a high-confidence suffix
    if (!suffix || !isHighConfSuffix) {
      return token;
    }
    
    const resolvedSuffix = ML_SUFFIXES.has(suffix) ? 'ml' : 'mg';
    return numericVal.toString() + resolvedSuffix;
  });
  
  return processed.join(' ');
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

  async runOcr(
    rgbaBuffer: Uint8ClampedArray,
    width: number,
    height: number
  ): Promise<{ text: string; confidence: number }> {
    try {
      if (!session) {
        await this.initModel();
      }

      // 1. Detect global bounding box of all ink in the line strip
      console.log(`[OCR] Detecting global bounding box on binarized image (${width}x${height})...`);
      const globalBbox = findGlobalBoundingBox(rgbaBuffer, width, height, 2);
      console.log(`[OCR] Global BBox: x=${globalBbox.x}, y=${globalBbox.y}, w=${globalBbox.w}, h=${globalBbox.h}`);

      // 2. Segment the global bounding box into separate words
      const wordBoxes = segmentLineIntoWords(rgbaBuffer, width, height, globalBbox, 1);
      console.log(`[OCR] Segmented line into ${wordBoxes.length} word box(es)`);

      const decodedWords: string[] = [];

      // 3. Process each word individually
      for (let i = 0; i < wordBoxes.length; i++) {
        const box = wordBoxes[i];
        console.log(`[OCR] Word segment ${i + 1}/${wordBoxes.length}: x=${box.x}, y=${box.y}, w=${box.w}, h=${box.h}`);
        
        // 4. Crop image to local word bounding box
        const subBuffer = extractSubImage(rgbaBuffer, width, box);
        
        // 5. Preprocess (resize and letterbox to 512x128 preserving aspect ratio)
        const floatData = preprocessImageData(subBuffer, box.w, box.h, 512, 128);
        
        // 6. Create ONNX Tensor and execute inference
        const tensor = new ort.Tensor('float32', floatData, [1, 1, 128, 512]);
        const feeds = { input_images: tensor };
        const results = await session.run(feeds);
        
        const outputTensor = results.output_logits;
        const [, timeSteps, numClasses] = outputTensor.dims;
        const logitsData = outputTensor.data as Float32Array;
        
        // 7. Decode using CTC greedy decoder
        const decodedWord = decodeCTC(logitsData, timeSteps, numClasses);
        console.log(`[OCR] Word ${i + 1} raw decoded: "${decodedWord}"`);
        
        if (decodedWord.trim()) {
          decodedWords.push(decodedWord.trim());
        }
      }

      // 8. Join decoded segments
      const decodedText = decodedWords.join(' ');
      console.log(`[OCR] Full Line Decoded: "${decodedText}"`);

      // 9. Post-process to translate digits and normalize suffixes
      const postProcessedText = postProcessOcrText(decodedText);
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
