/**
 * @file imageProcessing.ts
 * Utility functions for image thresholding, CTC decoding, and bounding box extraction.
 */

export const CHARS = [
  "", " ", "!", "\"", "'", "(", ")", ",", "-", ".", "0", "1", "2", "3", "4", "5", "6", 
  "7", "8", "9", ":", ";", "?", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", 
  "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", 
  "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", 
  "t", "u", "v", "w", "x", "y", "z", "/", "+"
];

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Bradley-Roth adaptive thresholding
export const adaptiveThresholdBradley = (
  width: number,
  height: number,
  rgbaBuffer: Uint8ClampedArray,
  windowSize: number = 25,
  t: number = 15
): Uint8ClampedArray => {
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
};

export const binarizeImageData = (
  width: number,
  height: number,
  rgbaBuffer: Uint8ClampedArray,
  threshold?: number
): Uint8ClampedArray => {
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
};

// CTC Greedy Decoder implementation
export const decodeCTC = (logits: Float32Array, timeSteps: number, numClasses: number): string => {
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
};

export const findGlobalBoundingBox = (
  rgbaBuffer: Uint8ClampedArray,
  width: number,
  height: number,
  noiseThreshold: number = 2
): BoundingBox => {
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
};

export const extractSubImage = (
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
