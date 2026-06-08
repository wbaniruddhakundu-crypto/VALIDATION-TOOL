import ExcelJS from "exceljs";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export interface AnalyteInfo {
  name: string;
  levels: number;
  unit?: string;
  allowableCV?: number;
  calibrator?: string;
  reagentLot?: string;
  reagentExpiry?: string;
  controlInfo?: Array<{ lot: string; limits: string }>;
}

export interface WorklistInfo {
  name: string;
  numDays: number;
  repsPerDay: number;
  intraDayReps: number;
  precisionType: string;
  analytes: AnalyteInfo[];
  metadata?: {
    location?: string;
    instrument?: string;
    hodcol?: string;
    technician?: string;
  };
}

export interface ResultRecord {
  analyteName: string;
  level: number;
  dayNumber: number;
  replication: number;
  precisionType: string;
  value?: number | null;
  date?: string;
}

// ── Styling ──────────────────────────────────────────────────────────────────

const COL_TITLE = "FFD4E157";       // yellow-green title bar
const COL_HEADER = "FF388E3C";      // green data header
const COL_CTRL = "FFFFF9C4";        // pale yellow control header
const COL_LABEL = "FFF5F5F5";
const COL_WHITE = "FFFFFFFF";

const thin: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBDBDBD" } };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function setTitle(cell: ExcelJS.Cell, bg: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.font = { bold: true, size: 11, color: { argb: "FF1A1A1A" } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = borders;
}
function setLabel(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_LABEL } };
  cell.font = { bold: true, size: 9 };
  cell.alignment = { vertical: "middle" };
  cell.border = borders;
}
function setValue(cell: ExcelJS.Cell) {
  cell.font = { size: 9 };
  cell.alignment = { vertical: "middle" };
  cell.border = borders;
}
function setHeader(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_HEADER } };
  cell.font = { bold: true, size: 9, color: { argb: COL_WHITE } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = borders;
}
function setData(cell: ExcelJS.Cell, bold = false) {
  cell.font = { size: 9, bold };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = borders;
  cell.numFmt = "0.####";
}

// ── Sheet builder — matches the lab template cell-for-cell ───────────────────

function buildSheet(
  ws: ExcelJS.Worksheet,
  analyte: AnalyteInfo,
  worklist: WorklistInfo,
  results: ResultRecord[],
  precisionType: "inter" | "intra",
) {
  const meta = worklist.metadata ?? {};
  const isIntra = precisionType === "intra";
  const reps = Math.max(isIntra ? worklist.intraDayReps : worklist.repsPerDay, 1);
  const days = isIntra ? 1 : Math.max(worklist.numDays, 1);

  const repStart = 2;                 // column B
  const repEnd = 1 + reps;            // last replication column
  const sdCol = 2 + reps;
  const meanCol = 3 + reps;
  const cvCol = 4 + reps;
  const allowCol = 5 + reps;
  const lastCol = allowCol;
  const L = colLetter;

  // Column widths
  ws.getColumn(1).width = 16;
  for (let c = repStart; c <= repEnd; c++) ws.getColumn(c).width = 13;
  ws.getColumn(sdCol).width = 10;
  ws.getColumn(meanCol).width = 10;
  ws.getColumn(cvCol).width = 10;
  ws.getColumn(allowCol).width = 13;

  // Row 1 blank, Row 2 title
  ws.getRow(1).height = 6;
  ws.mergeCells(`A2:${L(lastCol)}2`);
  const titleCell = ws.getCell("A2");
  titleCell.value = " REPLICATION EXPERIMENT FOR PRECISION VERIFICATION";
  ws.getRow(2).height = 22;
  setTitle(titleCell, COL_TITLE);
  for (let c = 1; c <= lastCol; c++) ws.getCell(`${L(c)}2`).border = borders;

  // Rows 3-7 metadata
  const metaRows: [string, string][] = [
    ["Location", meta.location ?? ""],
    ["Instrument", meta.instrument ?? ""],
    ["HOD/COL", meta.hodcol ?? ""],
    ["Technician", meta.technician ?? ""],
    ["Test Name", analyte.name],
  ];
  let r = 3;
  for (const [k, v] of metaRows) {
    ws.getCell(`A${r}`).value = k; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = v; setValue(ws.getCell(`B${r}`));
    r++;
  }

  r = 9; // blank row 8, control block starts at 9

  for (let level = 1; level <= analyte.levels; level++) {
    const ctrl = analyte.controlInfo?.[level - 1] ?? { lot: "", limits: "" };

    ws.getCell(`A${r}`).value = ` CONTROL ${level}`;
    setTitle(ws.getCell(`A${r}`), COL_CTRL);
    ws.getCell(`B${r}`).value = ctrl.lot; setValue(ws.getCell(`B${r}`));
    r++;

    ws.getCell(`A${r}`).value = "Control Limits"; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = ctrl.limits; setValue(ws.getCell(`B${r}`));
    r++;

    ws.getCell(`A${r}`).value = "Unit"; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = analyte.unit ?? ""; setValue(ws.getCell(`B${r}`));
    r++;

    ws.getCell(`A${r}`).value = "REAGENTS"; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = "LOT NO"; setLabel(ws.getCell(`B${r}`));
    ws.getCell(`C${r}`).value = "EXPIRY DATE"; setLabel(ws.getCell(`C${r}`));
    r++;

    ws.getCell(`A${r}`).value = "Reagent Kit"; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = analyte.reagentLot ?? ""; setValue(ws.getCell(`B${r}`));
    r++;

    ws.getCell(`A${r}`).value = "Controls"; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = ctrl.lot; setValue(ws.getCell(`B${r}`));
    ws.getCell(`C${r}`).value = analyte.reagentExpiry ?? ""; setValue(ws.getCell(`C${r}`));
    r++;

    ws.getCell(`A${r}`).value = "Calibrator"; setLabel(ws.getCell(`A${r}`));
    ws.getCell(`B${r}`).value = analyte.calibrator ?? ""; setValue(ws.getCell(`B${r}`));
    r++;

    // Data header row
    ws.getCell(`A${r}`).value = "DATE"; setHeader(ws.getCell(`A${r}`));
    for (let rep = 1; rep <= reps; rep++) {
      const c = repStart + rep - 1;
      ws.getCell(`${L(c)}${r}`).value = `REPLICATION-${rep}`;
      setHeader(ws.getCell(`${L(c)}${r}`));
    }
    ws.getCell(`${L(sdCol)}${r}`).value = "SD"; setHeader(ws.getCell(`${L(sdCol)}${r}`));
    ws.getCell(`${L(meanCol)}${r}`).value = "MEAN"; setHeader(ws.getCell(`${L(meanCol)}${r}`));
    ws.getCell(`${L(cvCol)}${r}`).value = "CV"; setHeader(ws.getCell(`${L(cvCol)}${r}`));
    ws.getCell(`${L(allowCol)}${r}`).value = "Allowable CV"; setHeader(ws.getCell(`${L(allowCol)}${r}`));
    ws.getRow(r).height = 20;
    r++;

    const firstDataRow = r;

    for (let day = 1; day <= days; day++) {
      // DATE label
      const dayResults = results.filter(
        (x) =>
          x.analyteName === analyte.name &&
          x.level === level &&
          x.precisionType === precisionType &&
          (isIntra ? x.dayNumber === 0 : x.dayNumber === day),
      );
      const dateLabel = dayResults.find((x) => x.date)?.date ?? (isIntra ? "Run 1" : `Day ${day}`);
      ws.getCell(`A${r}`).value = dateLabel; setData(ws.getCell(`A${r}`));

      // Replication values
      for (let rep = 1; rep <= reps; rep++) {
        const c = repStart + rep - 1;
        const found = dayResults.find((x) => x.replication === rep);
        const cell = ws.getCell(`${L(c)}${r}`);
        cell.value = found && found.value !== null && found.value !== undefined ? found.value : null;
        setData(cell);
      }

      // SD / MEAN / CV formulas (match the template)
      const range = `${L(repStart)}${r}:${L(repEnd)}${r}`;
      const sd = ws.getCell(`${L(sdCol)}${r}`);
      const mean = ws.getCell(`${L(meanCol)}${r}`);
      const cv = ws.getCell(`${L(cvCol)}${r}`);
      sd.value = { formula: `STDEV(${range})` } as ExcelJS.CellFormulaValue;
      mean.value = { formula: `AVERAGE(${range})` } as ExcelJS.CellFormulaValue;
      cv.value = { formula: `IF(${L(meanCol)}${r}=0,0,${L(sdCol)}${r}/${L(meanCol)}${r}*100)` } as ExcelJS.CellFormulaValue;
      setData(sd); setData(mean); setData(cv);

      const allow = ws.getCell(`${L(allowCol)}${r}`);
      allow.value = analyte.allowableCV ?? null;
      setData(allow);
      r++;
    }

    const lastDataRow = r - 1;

    // Overall stats row (matches template row 22 / 36)
    ws.getCell(`A${r}`).value = "Overall"; setData(ws.getCell(`A${r}`), true);
    for (let rep = 1; rep <= reps; rep++) {
      setData(ws.getCell(`${L(repStart + rep - 1)}${r}`));
    }
    const block = `${L(repStart)}${firstDataRow}:${L(repEnd)}${lastDataRow}`;
    const oSd = ws.getCell(`${L(sdCol)}${r}`);
    const oMean = ws.getCell(`${L(meanCol)}${r}`);
    const oCv = ws.getCell(`${L(cvCol)}${r}`);
    oSd.value = { formula: `STDEV(${block})` } as ExcelJS.CellFormulaValue;
    oMean.value = { formula: `AVERAGE(${block})` } as ExcelJS.CellFormulaValue;
    oCv.value = { formula: `IF(${L(meanCol)}${r}=0,0,${L(sdCol)}${r}/${L(meanCol)}${r}*100)` } as ExcelJS.CellFormulaValue;
    setData(oSd, true); setData(oMean, true); setData(oCv, true);
    setData(ws.getCell(`${L(allowCol)}${r}`), true);
    r++;
  }
}

async function buildWorkbook(
  analyte: AnalyteInfo,
  worklist: WorklistInfo,
  results: ResultRecord[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Precision Validation Tool";
  wb.created = new Date();

  const analyteResults = results.filter((r) => r.analyteName === analyte.name);
  const hasInter = analyteResults.some((r) => r.precisionType === "inter");
  const hasIntra = analyteResults.some((r) => r.precisionType === "intra");

  // Default to inter if nothing detected, so an empty template still exports.
  if (hasInter || (!hasInter && !hasIntra)) {
    buildSheet(wb.addWorksheet("Inter-Day"), analyte, worklist, results, "inter");
  }
  if (hasIntra) {
    buildSheet(wb.addWorksheet("Intra-Day"), analyte, worklist, results, "intra");
  }

  return wb.xlsx.writeBuffer();
}

// ── Template ("dummy" Excel) support ─────────────────────────────────────────
// The lab keeps a standard precision template that can vary run-to-run (fewer
// days or fewer replication columns). When the user uploads it, we populate the
// detected PDF data straight INTO that file, respecting its exact extent.

export interface TemplateBlock {
  headerRow: number;        // row containing "DATE" + "REPLICATION-n"
  repStartCol: number;      // first replication column (usually 2 = B)
  repCols: number;          // number of REPLICATION-* columns
  dayRows: number[];        // data row numbers (excludes the Overall row)
  unitRow: number | null;   // "Unit" row belonging to this control block
}

export interface ParsedTemplate {
  buffer: ArrayBuffer;      // original bytes, re-loaded fresh per analyte
  sheetName: string;
  testNameCell: { row: number; col: number } | null;
  blocks: TemplateBlock[];
  maxReps: number;
  maxDays: number;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && "richText" in v && Array.isArray(v.richText)) {
    return v.richText.map((t) => t.text).join("").trim();
  }
  return String(v).trim();
}

function scanSheet(ws: ExcelJS.Worksheet): {
  testNameCell: { row: number; col: number } | null;
  blocks: TemplateBlock[];
} {
  let testNameCell: { row: number; col: number } | null = null;
  const unitRows: number[] = [];
  const blocks: TemplateBlock[] = [];
  const rowCount = ws.rowCount;

  for (let r = 1; r <= rowCount; r++) {
    const a = cellText(ws.getCell(r, 1).value).toLowerCase();
    if (!a) continue;

    if (a === "test name" && !testNameCell) testNameCell = { row: r, col: 2 };
    if (a === "unit") unitRows.push(r);

    if (a === "date") {
      const repStartCol = 2;
      let repCols = 0;
      let c = repStartCol;
      while (/replication/i.test(cellText(ws.getCell(r, c).value))) {
        repCols++;
        c++;
      }

      const dayRows: number[] = [];
      let dr = r + 1;
      while (dr <= rowCount) {
        const dv = cellText(ws.getCell(dr, 1).value);
        if (!dv) break; // Overall row has an empty DATE cell
        if (/^(control|reagents?|unit|calibrator|controls)\b/i.test(dv)) break;
        dayRows.push(dr);
        dr++;
      }

      if (repCols > 0 && dayRows.length > 0) {
        blocks.push({ headerRow: r, repStartCol, repCols, dayRows, unitRow: null });
      }
    }
  }

  // Associate each block with the nearest "Unit" row above its header so unit
  // values land in the correct control block (robust to extra Unit rows).
  for (const block of blocks) {
    const candidates = unitRows.filter((u) => u < block.headerRow);
    block.unitRow = candidates.length ? Math.max(...candidates) : null;
  }

  return { testNameCell, blocks };
}

export async function parseTemplate(buffer: ArrayBuffer): Promise<ParsedTemplate> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Pick the sheet with the strongest precision grid (most detected blocks).
  let best: { ws: ExcelJS.Worksheet; scan: ReturnType<typeof scanSheet> } | null = null;
  for (const ws of wb.worksheets) {
    const scan = scanSheet(ws);
    if (scan.blocks.length > (best?.scan.blocks.length ?? 0)) best = { ws, scan };
  }

  const ws = best?.ws ?? wb.worksheets[0];
  const { testNameCell, blocks } = best?.scan ?? { testNameCell: null, blocks: [] };

  const maxReps = blocks.length ? Math.max(...blocks.map((b) => b.repCols)) : 0;
  const maxDays = blocks.length ? Math.max(...blocks.map((b) => b.dayRows.length)) : 0;

  return { buffer, sheetName: ws.name, testNameCell, blocks, maxReps, maxDays };
}

async function populateTemplate(
  tpl: ParsedTemplate,
  analyte: AnalyteInfo,
  results: ResultRecord[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.buffer);
  const ws = wb.getWorksheet(tpl.sheetName) ?? wb.worksheets[0];

  if (tpl.testNameCell) {
    ws.getCell(tpl.testNameCell.row, tpl.testNameCell.col).value = analyte.name;
  }

  const analyteResults = results.filter((r) => r.analyteName === analyte.name);
  // Inter-day templates have multiple day rows; intra is a single within-run set.
  const useInter = analyteResults.some((r) => r.precisionType === "inter");

  const fillRow = (row: number, block: TemplateBlock, rows: ResultRecord[]) => {
    if (rows.length === 0) return;
    const dateVal = rows.find((x) => x.date)?.date;
    if (dateVal) ws.getCell(row, 1).value = dateVal;
    for (let rep = 1; rep <= block.repCols; rep++) {
      const found = rows.find((x) => x.replication === rep);
      if (found && found.value !== null && found.value !== undefined) {
        ws.getCell(row, block.repStartCol + rep - 1).value = found.value;
      }
    }
  };

  tpl.blocks.forEach((block, bi) => {
    const level = bi + 1;
    if (block.unitRow && analyte.unit) ws.getCell(block.unitRow, 2).value = analyte.unit;

    if (useInter) {
      block.dayRows.forEach((row, di) => {
        const day = di + 1;
        const dayResults = analyteResults.filter(
          (x) => x.precisionType === "inter" && x.level === level && x.dayNumber === day,
        );
        fillRow(row, block, dayResults); // clips to repCols; leaves empty days as-is
      });
    } else {
      // Intra-day: a single run goes into the first data row only.
      const row = block.dayRows[0];
      const runResults = analyteResults.filter(
        (x) => x.precisionType === "intra" && x.level === level,
      );
      if (row) fillRow(row, block, runResults);
    }
  });

  return wb.xlsx.writeBuffer();
}

const safe = (s: string) => s.replace(/[^a-z0-9]/gi, "_");

export async function downloadAnalyteExcel(
  analyteName: string,
  _sessionName: string,
  worklist: WorklistInfo,
  results: ResultRecord[],
  template?: ParsedTemplate | null,
): Promise<void> {
  const analyte = worklist.analytes.find((a) => a.name === analyteName);
  if (!analyte) return;
  const buf = template
    ? await populateTemplate(template, analyte, results)
    : await buildWorkbook(analyte, worklist, results);
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safe(analyteName)}_Precision.xlsx`,
  );
}

export async function downloadAllAsZip(
  sessionName: string,
  worklist: WorklistInfo,
  results: ResultRecord[],
  template?: ParsedTemplate | null,
): Promise<void> {
  const zip = new JSZip();
  for (const analyte of worklist.analytes) {
    const buf = template
      ? await populateTemplate(template, analyte, results)
      : await buildWorkbook(analyte, worklist, results);
    zip.file(`${safe(analyte.name)}_Precision.xlsx`, buf);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  saveAs(blob, `${safe(sessionName || "Precision")}_All_Analytes.zip`);
}
