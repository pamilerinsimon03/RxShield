/**
 * Serializes and crops a video frame snapshot into a horizontal line strip.
 * Maps relative offsets to coordinates on the native video resolution.
 */
export const captureAndCropFrame = (
  videoEl: HTMLVideoElement,
  canvasEl: HTMLCanvasElement,
  cropRatioY: number = 0.40, // 40% top offset (centered slice)
  cropRatioH: number = 0.20  // 20% vertical height (line reticle strip)
): ImageData | null => {
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return null;

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return null;

  // Crop a horizontal text alignment strip
  const cropW = Math.floor(vw * 0.9); // 90% width
  const cropH = Math.floor(vh * cropRatioH);
  const cropX = Math.floor((vw - cropW) / 2);
  const cropY = Math.floor(vh * cropRatioY);

  canvasEl.width = cropW;
  canvasEl.height = cropH;

  // Draw crop sub-rectangle onto hidden canvas
  ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return ctx.getImageData(0, 0, cropW, cropH);
};

/**
 * Computes the optimal threshold for binarization using Otsu's method.
 * Maximizes between-class variance of foreground and background pixel intensity.
 */
export const computeOtsuThreshold = (imgData: ImageData): number => {
  const data = imgData.data;
  const len = data.length;
  const histogram = new Array(256).fill(0);
  
  // 1. Compute histogram of grayscale values
  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    histogram[gray]++;
  }

  // Total number of pixels
  const total = len / 4;

  // Calculate sum of all intensity values
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let threshold = 127; // default fallback

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;

    wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];

    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    // Between-class variance
    const varBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = t;
    }
  }

  return threshold;
};

/**
 * Performs grayscale luma calculation and dynamic or static threshold binarization.
 * Converts raw color bytes directly to high-contrast black-and-white.
 * Formula: Y = 0.299R + 0.587G + 0.114B
 */
/**
 * Performs local adaptive thresholding using the Bradley-Roth algorithm.
 * Excellent for separating ink from paper under uneven lighting and shadow gradients.
 */
export const adaptiveThresholdBradley = (
  imgData: ImageData,
  windowSize: number = 25,
  t: number = 15
): ImageData => {
  const data = imgData.data;
  const w = imgData.width;
  const h = imgData.height;

  const gray = new Uint8Array(w * h);
  const integral = new Int32Array(w * h);

  // 1. Compute grayscale and integral image
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const gr = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * w + x] = gr;

      sum += gr;
      if (y === 0) {
        integral[y * w + x] = sum;
      } else {
        integral[y * w + x] = integral[(y - 1) * w + x] + sum;
      }
    }
  }

  // 2. Perform thresholding
  const s2 = Math.floor(windowSize / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      
      const x1 = Math.max(0, x - s2);
      const x2 = Math.min(w - 1, x + s2);
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(h - 1, y + s2);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      let sum = integral[y2 * w + x2];
      if (x1 > 0) {
        sum -= integral[y2 * w + (x1 - 1)];
      }
      if (y1 > 0) {
        sum -= integral[(y1 - 1) * w + x2];
      }
      if (x1 > 0 && y1 > 0) {
        sum += integral[(y1 - 1) * w + (x1 - 1)];
      }

      // If pixel value is below local threshold (local mean minus t%), make it black (0)
      const val = (gray[y * w + x] * count) < (sum * (100 - t) / 100) ? 0 : 255;

      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
    }
  }

  return imgData;
};

/**
 * Performs grayscale luma calculation and dynamic or static threshold binarization.
 * Falls back to Bradley-Roth local adaptive thresholding if no static threshold is provided.
 */
export const binarizeImageData = (
  imgData: ImageData,
  threshold?: number
): ImageData => {
  if (threshold === undefined) {
    console.log('[Binarizer] Running Bradley-Roth local adaptive binarizer...');
    return adaptiveThresholdBradley(imgData, 25, 15);
  }

  console.log(`[Binarizer] Running static binarizer with threshold: ${threshold}`);
  const data = imgData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const val = gray < threshold ? 0 : 255;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }

  return imgData;
};
