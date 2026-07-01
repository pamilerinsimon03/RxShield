/**
 * Normalizes input text by converting it to uppercase, stripping non-alphanumeric
 * characters except standard delimiters (spaces, commas, slashes, periods, hyphens),
 * and compressing multiple consecutive spaces.
 */
export const normalizeText = (text: string): string => {
  let normalized = text.toUpperCase();
  normalized = normalized.replace(/[^A-Z0-9\s,\/\.\-]/g, '');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.trim();
};
