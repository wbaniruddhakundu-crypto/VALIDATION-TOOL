import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

export interface ParsedResult {
  analyteName: string;
  level: number;
  dayNumber: number;
  replication: number;
  precisionType: string;
  value: number | null;
  unit: string;
  date?: string;
}

export interface ParseSummary {
  results: ParsedResult[];
  analytes: string[];
  days: number[];
  levels: number[];
}

/**
 * Extract text from PDF, reconstructing lines using the Y-position of each text
 * item so that the analyte gray heading, SID line and result line stay on their
 * own logical lines.
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const lineMap = new Map<number, Array<{ x: number; str: string }>>();

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x, str: item.str });
    }

    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = items.map((i) => i.str).join(" ").trim();
      if (lineText) fullText += lineText + "\n";
    }
    fullText += "\n";
  }

  return fullText;
}

/**
 * The analyte gray heading is always the line immediately after the page banner
 * "Order Time: All  Sample Type: All  Analyzer: All", followed by "Result".
 * Names may be split by the PDF layout (e.g. "APO A1") so spaces are removed,
 * yielding APOA1, APOB, AMY_2, GGT_2, UN_c, etc.
 */
const ANALYTE_ANCHOR = /Order\s*Time:.*Analyzer:\s*All/i;

function readAnalyteName(lines: string[], anchorIdx: number): string {
  let name = "";
  for (let j = anchorIdx + 1; j < Math.min(anchorIdx + 5, lines.length); j++) {
    if (/^Result$/i.test(lines[j]) || /^Patient\s+Name/i.test(lines[j])) break;
    name += lines[j];
  }
  return name.replace(/\s+/g, "");
}

/**
 * Parse analyzer report text (extracted from a Siemens/Atellica Assay Report PDF).
 *
 * Each measurement is a separate "CH PRECISION DAYn" block whose own replicate
 * line always restarts at "1". Therefore the replicate number is assigned by
 * COUNTING sequential measurements per (analyte, day, level), not by reading the
 * PDF's "1". The populated value is the reportable Result (number before the
 * unit), e.g. 2.5 g/dL -> 2.5, 32 U/L -> 32.
 */
export function parseAnalyzerText(text: string, precisionType = "inter"): ParsedResult[] {
  const results: ParsedResult[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // Single-letter fragments (H, I, L) are layout artifacts, not real analytes.
  const SKIP_ANALYTES = new Set(["H", "I", "L"]);
  // Template capacity: 5 replication columns (inter) / 20 (intra). If a report
  // contains extra measurements, keep the first N to match the grid.
  const maxReps = precisionType === "intra" ? 20 : 5;

  let currentAnalyte = "";
  const repCounter = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Analyte gray heading (line right after the page banner) ────────────────
    if (ANALYTE_ANCHOR.test(line)) {
      currentAnalyte = readAnalyteName(lines, i);
      continue;
    }

    // ── Measurement block start: "CH PRECISION DAY1 06/03/2026" ───────────────
    const dayM = line.match(/CH\s*PRECISION\s*DAY\s*(\d+)/i);
    if (dayM && currentAnalyte && !SKIP_ANALYTES.has(currentAnalyte)) {
      const day = parseInt(dayM[1], 10);
      let level: number | null = null;
      let value: number | null = null;
      let unit = "";
      let date = (line.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || "";

      // SID may be on one line: "CH PRECISION DAY1 L1"
      const sameLineLevel = line.match(/DAY\s*\d+\s+L\s*(\d+)/i);
      if (sameLineLevel) level = parseInt(sameLineLevel[1], 10);

      // Scan the block (until the next CH PRECISION line) for value + level.
      for (let k = i + 1; k < Math.min(i + 9, lines.length); k++) {
        const lk = lines[k];
        if (/CH\s*PRECISION\s*DAY\s*\d+/i.test(lk)) break;

        if (value === null) {
          // Result row: "***** ***** 2.5 g/dL 281.0098 Low" (unit optional, e.g. "0")
          let vm = lk.match(/\*+\s+\*+\s+([\d.]+)(?:\s+([A-Za-zµ%][A-Za-zµ/%]*))?/);
          // Fallback — replicate row: "1 2.5 g/dL 281.0098 06/03/2026 6:56 PM"
          if (!vm) vm = lk.match(/^\d+\s+([\d.]+)\s+([A-Za-zµ%][A-Za-zµ/%]*)\s+[-\d.]/);
          if (vm) { value = parseFloat(vm[1]); unit = vm[2] ?? ""; }
        }

        if (level === null) {
          const lm = lk.match(/^L\s*(\d+)\b/) || lk.match(/\bL\s*(\d+)\s+\d/);
          if (lm) level = parseInt(lm[1], 10);
        }

        if (!date) {
          const dm = lk.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dm) date = dm[1];
        }
      }

      if (level === null) level = 1;

      if (value !== null && !isNaN(value)) {
        const key = `${currentAnalyte}|${day}|${level}`;
        const rep = (repCounter.get(key) || 0) + 1;
        if (rep > maxReps) continue; // keep only the first N to fit the grid
        repCounter.set(key, rep);
        results.push({
          analyteName: currentAnalyte,
          level,
          dayNumber: precisionType === "inter" ? day : 0,
          replication: rep,
          precisionType,
          value,
          unit,
          date,
        });
      }
    }
  }

  return results;
}

/** Parse and return a summary (analytes/days/levels) alongside the results. */
export function parseWithSummary(text: string, precisionType = "inter"): ParseSummary {
  const results = parseAnalyzerText(text, precisionType);
  const analytes = [...new Set(results.map((r) => r.analyteName))];
  const days = [...new Set(results.map((r) => r.dayNumber))].filter((d) => d > 0).sort((a, b) => a - b);
  const levels = [...new Set(results.map((r) => r.level))].sort((a, b) => a - b);
  return { results, analytes, days, levels };
}
