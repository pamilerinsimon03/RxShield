export const levenshtein = (s1: string, s2: string): number => {
  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // Deletion
        matrix[i][j - 1] + 1,       // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return matrix[len1][len2];
};

export const jaro = (s1: string, s2: string): number => {
  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0 && len2 === 0) return 1.0;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;

  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(len2, i + matchWindow + 1);

    for (let j = start; j < end; j++) {
      if (!matches2[j] && s1[i] === s2[j]) {
        matches1[i] = true;
        matches2[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (matches1[i]) {
      while (!matches2[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const t = transpositions / 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3.0;
};

export const jaroWinkler = (s1: string, s2: string): number => {
  const jaroScore = jaro(s1, s2);
  const p = 0.1; // prefix scale factor
  let l = 0;     // prefix length (max 4)
  const maxPrefix = Math.min(4, s1.length, s2.length);

  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      l++;
    } else {
      break;
    }
  }

  return jaroScore + l * p * (1.0 - jaroScore);
};

export const getFuzzySimilarity = (s1: string, s2: string): number => {
  const str1 = s1.trim().toUpperCase();
  const str2 = s2.trim().toUpperCase();

  if (str1 === str2) return 1.0;

  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;

  const levDist = levenshtein(str1, str2);
  const levSim = 1.0 - levDist / maxLen;
  const jwSim = jaroWinkler(str1, str2);

  return (levSim + jwSim) / 2.0;
};
