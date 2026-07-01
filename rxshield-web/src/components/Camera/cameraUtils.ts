/**
 * Serializes and crops a video frame snapshot into a horizontal line strip.
 * Maps relative offsets to coordinates on the native video resolution by:
 * 1. Calculating object-cover scale factor and scaled dimensions.
 * 2. Determining centering offsets of the scaled video inside container.
 * 3. Defining the crop box in container coordinates (e.g. reticle strip).
 * 4. Mapping container coordinates back to native video space and clamping to boundaries.
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
  const cw = videoEl.clientWidth;
  const ch = videoEl.clientHeight;

  if (!vw || !vh || !cw || !ch) return null;

  const scale = Math.max(cw / vw, ch / vh);

  const sw = vw * scale;
  const sh = vh * scale;

  const offsetX = (cw - sw) / 2;
  const offsetY = (ch - sh) / 2;

  const rectX = 32;
  const rectW = Math.max(10, cw - 64);
  const rectY = ch * cropRatioY;
  const rectH = ch * cropRatioH;

  const videoX = Math.floor((rectX - offsetX) / scale);
  const videoW = Math.floor(rectW / scale);
  const videoY = Math.floor((rectY - offsetY) / scale);
  const videoH = Math.floor(rectH / scale);

  const clampedX = Math.max(0, Math.min(vw - 1, videoX));
  const clampedY = Math.max(0, Math.min(vh - 1, videoY));
  const clampedW = Math.max(1, Math.min(vw - clampedX, videoW));
  const clampedH = Math.max(1, Math.min(vh - clampedY, videoH));

  canvasEl.width = clampedW;
  canvasEl.height = clampedH;

  ctx.drawImage(videoEl, clampedX, clampedY, clampedW, clampedH, 0, 0, clampedW, clampedH);
  return ctx.getImageData(0, 0, clampedW, clampedH);
};


/**
 * Computes the optimal threshold for binarization using Otsu's method.
 * Maximizes between-class variance of foreground and background pixel intensity.
 */
export const computeOtsuThreshold = (imgData: ImageData): number => {
  const data = imgData.data;
  const len = data.length;
  const histogram = new Array(256).fill(0);
  
  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    histogram[gray]++;
  }

  const total = len / 4;

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

    // Between-class variance calculation
    const varBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = t;
    }
  }

  return threshold;
};

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

  // Compute grayscale and integral image
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
