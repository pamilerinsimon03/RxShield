export const normalizeText = (text: string): string => {
  // 1. Convert to uppercase
  let normalized = text.toUpperCase();

  // 2. Strip out non-alphanumeric anomalies while preserving standard delimiters (spaces, commas, slashes, periods, hyphens)
  normalized = normalized.replace(/[^A-Z0-9\s,\/\.\-]/g, '');

  // 3. Compress multi-space gaps into a single space token and trim
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized.trim();
};
