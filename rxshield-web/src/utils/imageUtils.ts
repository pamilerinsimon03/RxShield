// src/utils/imageUtils.ts

/**
 * Bradley-Roth adaptive thresholding
 */
export function adaptiveThresholdBradley(
  width: number,
  height: number,
  rgbaBuffer: Uint8ClampedArray,
  windowSize = 25,
  t = 15
): Uint8ClampedArray {
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
