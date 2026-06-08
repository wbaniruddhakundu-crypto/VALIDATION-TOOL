export function calculateStats(values: (number | null)[]) {
  const validValues = values.filter((v): v is number => v !== null && !isNaN(v));
  if (validValues.length === 0) {
    return { mean: null, sd: null, cv: null, n: 0 };
  }

  const n = validValues.length;
  const sum = validValues.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  if (n === 1) {
    return { mean, sd: null, cv: null, n };
  }

  const squaredDiffs = validValues.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  
  const cv = mean !== 0 ? (sd / mean) * 100 : null;

  return { mean, sd, cv, n };
}
