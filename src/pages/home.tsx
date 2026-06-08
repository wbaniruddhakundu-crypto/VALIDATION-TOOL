import { useState, useRef, useMemo } from "react";
import {
  Upload, Loader2, FileText, CheckCircle2, Plus, Trash2, FileSpreadsheet,
  Package, X, FlaskConical, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { extractTextFromPDF, parseAnalyzerText, type ParsedResult } from "@/lib/pdf-parser";
import {
  downloadAnalyteExcel, downloadAllAsZip, parseTemplate,
  type WorklistInfo, type ResultRecord, type ParsedTemplate,
} from "@/lib/excel-export";

interface Slot {
  id: string;
  kind: "inter" | "intra";
  day: number;
  label: string;
  fileNames: string[];
  results: ParsedResult[];
}

let slotCounter = 0;
const makeId = () => `slot_${Date.now()}_${slotCounter++}`;

export default function Home() {
  const { toast } = useToast();

  const [slots, setSlots] = useState<Slot[]>([
    { id: makeId(), kind: "inter", day: 1, label: "Day 1", fileNames: [], results: [] },
    { id: makeId(), kind: "inter", day: 2, label: "Day 2", fileNames: [], results: [] },
    { id: makeId(), kind: "inter", day: 3, label: "Day 3", fileNames: [], results: [] },
    { id: makeId(), kind: "inter", day: 4, label: "Day 4", fileNames: [], results: [] },
    { id: makeId(), kind: "inter", day: 5, label: "Day 5", fileNames: [], results: [] },
  ]);
  const [intraSlot, setIntraSlot] = useState<Slot>({
    id: makeId(), kind: "intra", day: 0, label: "Intra-Day", fileNames: [], results: [],
  });

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [downloadingAnalyte, setDownloadingAnalyte] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const [template, setTemplate] = useState<ParsedTemplate | null>(null);
  const [templateName, setTemplateName] = useState<string>("");
  const [parsingTemplate, setParsingTemplate] = useState(false);
  const templateRef = useRef<HTMLInputElement | null>(null);

  const [showLabInfo, setShowLabInfo] = useState(false);
  const [labInfo, setLabInfo] = useState({
    sessionName: "Precision Run",
    location: "",
    instrument: "",
    hodcol: "",
    technician: "",
  });

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Parse one or more PDFs into a slot, accumulating by control level ───────
  const handleUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    slot: Slot,
  ) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploadingId(slot.id);
    try {
      let added: ParsedResult[] = [];
      const addedNames: string[] = [];
      let failed = 0;

      for (const file of files) {
        try {
          const text = await extractTextFromPDF(file);
          const parsed = parseAnalyzerText(text, slot.kind);
          if (parsed.length === 0) { failed++; continue; }
          // Force the slot's day onto inter results so data lands in the right day.
          const normalized = parsed.map((r) => ({
            ...r,
            dayNumber: slot.kind === "inter" ? slot.day : 0,
          }));
          added = added.concat(normalized);
          addedNames.push(file.name);
        } catch {
          failed++;
        }
      }

      if (added.length === 0) {
        toast({
          title: "No results found",
          description: "Couldn't read these PDFs. Make sure they're analyzer Assay Reports (Siemens/Atellica format).",
          variant: "destructive",
        });
        return;
      }

      // Levels present in the newly added files — replace those levels so a
      // re-upload of the same level overwrites cleanly.
      const newLevels = new Set(added.map((r) => r.level));

      const merge = (s: Slot): Slot => ({
        ...s,
        fileNames: [...s.fileNames, ...addedNames],
        results: [...s.results.filter((r) => !newLevels.has(r.level)), ...added],
      });

      if (slot.kind === "intra") {
        setIntraSlot((prev) => merge(prev));
      } else {
        setSlots((prev) => prev.map((s) => (s.id === slot.id ? merge(s) : s)));
      }

      const analytes = [...new Set(added.map((r) => r.analyteName))];
      const levels = [...new Set(added.map((r) => r.level))].sort();
      toast({
        title: `${slot.label} — ${added.length} results added`,
        description: `${analytes.length} analytes · Level${levels.length > 1 ? "s" : ""} ${levels.join(", ")}${failed ? ` · ${failed} file(s) skipped` : ""}`,
      });
    } finally {
      setUploadingId(null);
      e.target.value = "";
    }
  };

  const clearSlot = (slot: Slot) => {
    const reset = (s: Slot): Slot => ({ ...s, fileNames: [], results: [] });
    if (slot.kind === "intra") setIntraSlot((prev) => reset(prev));
    else setSlots((prev) => prev.map((s) => (s.id === slot.id ? reset(s) : s)));
  };

  // ── Parse the lab's template ("dummy" Excel) the data populates into ─────────
  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingTemplate(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseTemplate(buf);
      if (parsed.blocks.length === 0) {
        toast({
          title: "Couldn't read the template",
          description: "No DATE / REPLICATION grid was found. Upload the precision template Excel.",
          variant: "destructive",
        });
        return;
      }
      setTemplate(parsed);
      setTemplateName(file.name);
      toast({
        title: "Template loaded",
        description: `${parsed.blocks.length} control(s) · up to ${parsed.maxDays} day(s) · ${parsed.maxReps} replicate(s). Data fills into this exact layout.`,
      });
    } catch {
      toast({ title: "Couldn't read the template", description: "Make sure it's a valid .xlsx file.", variant: "destructive" });
    } finally {
      setParsingTemplate(false);
      e.target.value = "";
    }
  };

  const clearTemplate = () => {
    setTemplate(null);
    setTemplateName("");
  };

  const addDay = () => {
    const nextDay = slots.length > 0 ? Math.max(...slots.map((s) => s.day)) + 1 : 1;
    setSlots((prev) => [...prev, { id: makeId(), kind: "inter", day: nextDay, label: `Day ${nextDay}`, fileNames: [], results: [] }]);
  };

  const removeDay = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  // ── Aggregate all parsed data into a worklist + result records ──────────────
  const { worklistInfo, resultRecords, analyteSummary, totalResults } = useMemo(() => {
    const allParsed: ParsedResult[] = [
      ...slots.flatMap((s) => s.results),
      ...intraSlot.results,
    ];

    const analyteNames = [...new Set(allParsed.map((r) => r.analyteName))].sort();

    const analytes = analyteNames.map((name) => {
      const rs = allParsed.filter((r) => r.analyteName === name);
      const levels = Math.max(...rs.map((r) => r.level), 1);
      const unit = rs.find((r) => r.unit)?.unit ?? "";
      const controlInfo = Array.from({ length: levels }).map(() => ({ lot: "", limits: "" }));
      return { name, levels, unit, controlInfo };
    });

    const inter = allParsed.filter((r) => r.precisionType === "inter");
    const intra = allParsed.filter((r) => r.precisionType === "intra");

    const numDays = Math.max(...inter.map((r) => r.dayNumber), 1);
    const repsPerDay = Math.max(...inter.map((r) => r.replication), 1);
    const intraDayReps = Math.max(...intra.map((r) => r.replication), 1);

    const hasInter = inter.length > 0;
    const hasIntra = intra.length > 0;
    const precisionType = hasInter && hasIntra ? "both" : hasIntra ? "intra" : "inter";

    const wl: WorklistInfo = {
      name: labInfo.sessionName,
      numDays,
      repsPerDay,
      intraDayReps,
      precisionType,
      analytes,
      metadata: {
        location: labInfo.location,
        instrument: labInfo.instrument,
        hodcol: labInfo.hodcol,
        technician: labInfo.technician,
      },
    };

    const records: ResultRecord[] = allParsed
      .filter((r) => r.value !== null)
      .map((r) => ({
        analyteName: r.analyteName,
        level: r.level,
        dayNumber: r.dayNumber,
        replication: r.replication,
        precisionType: r.precisionType,
        value: r.value,
        date: r.date,
      }));

    const summary = analyteNames.map((name) => ({
      name,
      count: records.filter((r) => r.analyteName === name).length,
    }));

    return {
      worklistInfo: wl,
      resultRecords: records,
      analyteSummary: summary,
      totalResults: records.length,
    };
  }, [slots, intraSlot, labInfo]);

  const handleDownloadAnalyte = async (name: string) => {
    setDownloadingAnalyte(name);
    try {
      await downloadAnalyteExcel(name, labInfo.sessionName, worklistInfo, resultRecords, template);
      toast({ title: `${name}_Precision.xlsx downloaded` });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setDownloadingAnalyte(null);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      await downloadAllAsZip(labInfo.sessionName, worklistInfo, resultRecords, template);
      toast({ title: "All analytes downloaded as ZIP" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };

  // ── Slot card UI ────────────────────────────────────────────────────────────
  const SlotCard = ({ slot, removable }: { slot: Slot; removable?: boolean }) => {
    const isUploading = uploadingId === slot.id;
    const hasData = slot.results.length > 0;
    const analytes = [...new Set(slot.results.map((r) => r.analyteName))];
    const levels = [...new Set(slot.results.map((r) => r.level))].sort();

    return (
      <div
        className={`relative rounded-xl border-2 transition-all ${
          hasData ? "border-emerald-300 bg-emerald-50/40" : "border-dashed border-border hover:border-primary/50 bg-card"
        }`}
      >
        <input
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          ref={(el) => { fileRefs.current[slot.id] = el; }}
          onChange={(e) => handleUpload(e, slot)}
        />

        {removable && (
          <button
            onClick={() => removeDay(slot.id)}
            className="absolute top-2 right-2 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove this day"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="p-4 flex flex-col items-center text-center gap-2 min-h-[160px] justify-center">
          {hasData ? (
            <>
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              <p className="font-semibold text-sm text-foreground">{slot.label}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 max-w-full">
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate">{slot.fileNames.length} file(s)</span>
              </p>
              <p className="text-[11px] text-emerald-700 font-medium">
                {slot.results.length} results · {analytes.length} analytes
              </p>
              <p className="text-[10px] text-muted-foreground">Level{levels.length > 1 ? "s" : ""} {levels.join(", ")}</p>
              <div className="flex gap-1.5 mt-1">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!!uploadingId} onClick={() => fileRefs.current[slot.id]?.click()}>
                  <Plus className="w-3 h-3 mr-1" />Add file
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => clearSlot(slot)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className={`p-2.5 rounded-full ${slot.kind === "intra" ? "bg-amber-100" : "bg-primary/10"}`}>
                {slot.kind === "intra" ? (
                  <FlaskConical className="w-5 h-5 text-amber-600" />
                ) : (
                  <Upload className="w-5 h-5 text-primary" />
                )}
              </div>
              <p className="font-semibold text-sm text-foreground">{slot.label}</p>
              <p className="text-[11px] text-muted-foreground">PDF report(s) — L1, L2…</p>
              <Button
                size="sm"
                className="h-8 text-xs mt-1"
                disabled={isUploading || !!uploadingId}
                onClick={() => fileRefs.current[slot.id]?.click()}
              >
                {isUploading ? (
                  <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Reading…</>
                ) : (
                  <><Upload className="w-3 h-3 mr-1.5" />Upload PDF(s)</>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="border-b border-border pb-5">
        <h1 className="text-3xl font-bold tracking-tight">Upload & Generate</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Upload your analyzer PDF reports day by day (one or more per day — e.g. Level 1 and Level 2 files).
          Analytes, days and replicates are detected automatically, and each analyte's precision Excel is
          generated to match your template — no manual setup needed.
        </p>
      </div>

      {/* Optional lab info */}
      <Card className="shadow-sm">
        <button
          onClick={() => setShowLabInfo((s) => !s)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div>
            <p className="font-semibold text-sm">Lab Information <span className="text-muted-foreground font-normal">(optional — appears in Excel header)</span></p>
          </div>
          {showLabInfo ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showLabInfo && (
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs">Run / Session Name</Label>
              <Input value={labInfo.sessionName} onChange={(e) => setLabInfo({ ...labInfo, sessionName: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Input value={labInfo.location} onChange={(e) => setLabInfo({ ...labInfo, location: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Instrument</Label>
              <Input value={labInfo.instrument} onChange={(e) => setLabInfo({ ...labInfo, instrument: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">HOD / COL</Label>
              <Input value={labInfo.hodcol} onChange={(e) => setLabInfo({ ...labInfo, hodcol: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Technician</Label>
              <Input value={labInfo.technician} onChange={(e) => setLabInfo({ ...labInfo, technician: e.target.value })} className="h-9" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Template ("dummy" Excel) upload */}
      <Card className={`shadow-sm ${template ? "border-emerald-200" : ""}`}>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            ref={(el) => { templateRef.current = el; }}
            onChange={handleTemplateUpload}
          />
          <div className="flex items-start gap-3 flex-1">
            <div className={`p-2.5 rounded-full ${template ? "bg-emerald-100" : "bg-primary/10"}`}>
              {template ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <FileSpreadsheet className="w-5 h-5 text-primary" />}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm">
                Template Excel <span className="text-muted-foreground font-normal">(optional — populate into your lab's exact file)</span>
              </p>
              {template ? (
                <p className="text-[11px] text-emerald-700 font-medium truncate">
                  {templateName} — {template.blocks.length} control(s) · up to {template.maxDays} day(s) · {template.maxReps} replicate(s)
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Upload your precision template and data fills into it — respecting however many days / replicates it has. Without one, a standard sheet is generated.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant={template ? "outline" : "default"}
              disabled={parsingTemplate}
              onClick={() => templateRef.current?.click()}
            >
              {parsingTemplate ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Reading…</>
              ) : (
                <><Upload className="w-3.5 h-3.5 mr-1.5" />{template ? "Replace" : "Upload Template"}</>
              )}
            </Button>
            {template && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearTemplate}>
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Inter-Day uploads */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Inter-Day Precision <span className="text-sm font-normal text-muted-foreground">{template ? `(up to ${template.maxDays} days × ${template.maxReps} replicates — per template)` : "(5 replicates / day)"}</span></h2>
            <p className="text-sm text-muted-foreground">Upload each day's PDF(s). Each day becomes one row; replicates fill across the columns.</p>
          </div>
          <Button variant="outline" size="sm" onClick={addDay}>
            <Plus className="w-4 h-4 mr-1.5" />Add Day
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {slots.map((slot) => (
            <SlotCard key={slot.id} slot={slot} removable={slots.length > 1} />
          ))}
        </div>
      </div>

      {/* Intra-Day upload */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Intra-Day Precision <span className="text-sm font-normal text-muted-foreground">(20 replicates, single run)</span></h2>
          <p className="text-sm text-muted-foreground">Upload the within-run PDF(s) containing all replicates (e.g. 20 reps).</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SlotCard slot={intraSlot} />
        </div>
      </div>

      {/* Results & downloads */}
      {totalResults > 0 && (
        <Card className="shadow-sm border-emerald-200">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div>
              <CardTitle className="text-base">Detected Analytes ({analyteSummary.length})</CardTitle>
              <CardDescription className="text-xs">
                {totalResults} results populated. Click an analyte to download its Excel, or grab them all as a ZIP.
              </CardDescription>
            </div>
            <Button
              onClick={handleDownloadAll}
              disabled={downloadingAll}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
            >
              {downloadingAll ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Building ZIP…</>
              ) : (
                <><Package className="w-4 h-4 mr-2" />Download All (ZIP)</>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {analyteSummary.map((a) => {
                const isDownloading = downloadingAnalyte === a.name;
                return (
                  <button
                    key={a.name}
                    onClick={() => handleDownloadAnalyte(a.name)}
                    disabled={isDownloading || !!downloadingAnalyte || downloadingAll}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all disabled:opacity-50 group"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-5 h-5 text-emerald-600 group-hover:text-primary transition-colors" />
                    )}
                    <span className="font-semibold text-xs text-foreground truncate max-w-full">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground">{a.count} results</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
