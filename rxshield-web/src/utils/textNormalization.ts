export const normalizeText = (text: string): string => {
  // 1. Convert to uppercase
  let normalized = text.toUpperCase();

  // 2. Strip out non-alphanumeric anomalies while preserving standard delimiters (spaces, commas, slashes, periods, hyphens)
  normalized = normalized.replace(/[^A-Z0-9\s,\/\.\-]/g, '');

  // 3. Compress multi-space gaps into a single space token and trim
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized.trim();
};

export function areFirstLettersVisuallyEquivalent(c1: string, c2: string): boolean {
  const char1 = c1.toUpperCase();
  const char2 = c2.toUpperCase();
  if (char1 === char2) return true;

  const groups = [
    ['I', 'L', 'J', 'F', 'T', '1', '7'],
    ['O', 'D', 'Q', '0', 'C', 'K'],
    ['S', '5', '8', 'B'],
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
