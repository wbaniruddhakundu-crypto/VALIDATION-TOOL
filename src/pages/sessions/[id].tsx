import { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetSession,
  useGetSessionResults,
  useSaveSessionResults,
  getGetSessionQueryKey,
  getGetSessionResultsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, CheckCircle2, AlertCircle, Upload, Loader2, FileText, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { calculateStats } from "@/lib/stats";
import { extractTextFromPDF, parseAnalyzerText, type ParsedResult } from "@/lib/pdf-parser";
import type { ResultEntry } from "@workspace/api-client-react";

type UploadStatus = { file: string; count: number } | null;

export default function SessionDetail() {
  const [, params] = useRoute("/sessions/:id");
  const sessionId = params?.id ? parseInt(params.id) : 0;

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) },
  });
  const { data: results, isLoading: resultsLoading } = useGetSessionResults(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionResultsQueryKey(sessionId) },
  });

  const saveResults = useSaveSessionResults();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // One hidden file input ref per day + one for intra
  const dayFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const intraFileRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<string>("inter");
  const [activeDay, setActiveDay] = useState<number>(1);
  const [localResults, setLocalResults] = useState<Record<string, string>>({});

  // Per-day upload state: key = "day_N" or "intra"
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});

  useEffect(() => {
    if (results) {
      const init: Record<string, string> = {};
      results.forEach((r) => {
        if (r.value !== null && r.value !== undefined) {
          const key = `${r.precisionType}_${r.dayNumber}_${r.analyteName}_${r.level}_${r.replication}`;
          init[key] = r.value.toString();
        }
      });
      setLocalResults(init);
    }
  }, [results]);

  useEffect(() => {
    if (session) {
      setActiveTab(session.worklist.precisionType === "intra" ? "intra" : "inter");
    }
  }, [session]);

  const handleInputChange = (
    precisionType: string,
    dayNumber: number,
    analyteName: string,
    level: number,
    replication: number,
    value: string,
  ) => {
    const key = `${precisionType}_${dayNumber}_${analyteName}_${level}_${replication}`;
    setLocalResults((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = (precisionType: string, dayNumber = 0) => {
    if (!session) return;
    const entries: ResultEntry[] = [];
    session.worklist.analytes.forEach((analyte) => {
      for (let level = 1; level <= analyte.levels; level++) {
        const reps = precisionType === "inter" ? session.worklist.repsPerDay : session.worklist.intraDayReps;
        for (let rep = 1; rep <= reps; rep++) {
          const key = `${precisionType}_${dayNumber}_${analyte.name}_${level}_${rep}`;
          const valStr = localResults[key];
          if (valStr?.trim()) {
            const val = parseFloat(valStr);
            if (!isNaN(val)) entries.push({ precisionType, dayNumber, analyteName: analyte.name, level, replication: rep, value: val });
          }
        }
      }
    });

    saveResults.mutate(
      { id: sessionId, data: { results: entries } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSessionResultsQueryKey(sessionId) });
          toast({ title: "Saved", description: precisionType === "inter" ? `Day ${dayNumber} results saved.` : "Intra-day results saved." });
        },
        onError: () => toast({ title: "Error", description: "Failed to save.", variant: "destructive" }),
      },
    );
  };

  const handlePdfUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    precisionType: "inter" | "intra",
    dayNumber: number,
    uploadKey: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;

    setUploadingKey(uploadKey);
    try {
      const text = await extractTextFromPDF(file);
      const parsed = parseAnalyzerText(text, precisionType);

      if (parsed.length === 0) {
        toast({
          title: "No results found",
          description: "Could not extract results from this PDF. Ensure it is an analyzer Assay Report.",
          variant: "destructive",
        });
        return;
      }

      // Update local state immediately
      const newLocal = { ...localResults };
      const entriesToSave: ResultEntry[] = [];

      parsed.forEach((r) => {
        if (r.value === null) return;
        const storedDay = precisionType === "inter" ? dayNumber : 0;
        const key = `${precisionType}_${storedDay}_${r.analyteName}_${r.level}_${r.replication}`;
        newLocal[key] = r.value.toString();
        entriesToSave.push({
          analyteName: r.analyteName,
          level: r.level,
          dayNumber: storedDay,
          replication: r.replication,
          precisionType,
          value: r.value,
        });
      });

      setLocalResults(newLocal);
      if (precisionType === "inter") setActiveDay(dayNumber);

      saveResults.mutate(
        { id: sessionId, data: { results: entriesToSave } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetSessionResultsQueryKey(sessionId) });
            const analytes = [...new Set(parsed.map((r) => r.analyteName))];
            setUploadStatus((prev) => ({
              ...prev,
              [uploadKey]: { file: file.name, count: entriesToSave.length },
            }));
            toast({
              title: `Day ${dayNumber} PDF loaded — ${entriesToSave.length} results`,
              description: `Analytes: ${analytes.slice(0, 5).join(", ")}${analytes.length > 5 ? ` +${analytes.length - 5} more` : ""}`,
            });
          },
          onError: () => toast({ title: "Save failed", variant: "destructive" }),
        },
      );
    } catch {
      toast({ title: "PDF error", description: "Failed to read the PDF file.", variant: "destructive" });
    } finally {
      setUploadingKey(null);
      e.target.value = "";
    }
  };

  const handleIntraPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;

    setUploadingKey("intra");
    try {
      const text = await extractTextFromPDF(file);
      const parsed = parseAnalyzerText(text, "intra");

      if (parsed.length === 0) {
        toast({ title: "No results found", description: "Could not extract intra-day results from this PDF.", variant: "destructive" });
        return;
      }

      const newLocal = { ...localResults };
      const entriesToSave: ResultEntry[] = [];

      parsed.forEach((r) => {
        if (r.value === null) return;
        const key = `intra_0_${r.analyteName}_${r.level}_${r.replication}`;
        newLocal[key] = r.value.toString();
        entriesToSave.push({ analyteName: r.analyteName, level: r.level, dayNumber: 0, replication: r.replication, precisionType: "intra", value: r.value });
      });

      setLocalResults(newLocal);

      saveResults.mutate(
        { id: sessionId, data: { results: entriesToSave } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetSessionResultsQueryKey(sessionId) });
            setUploadStatus((prev) => ({ ...prev, intra: { file: file.name, count: entriesToSave.length } }));
            toast({ title: `Intra-Day PDF loaded — ${entriesToSave.length} results` });
          },
          onError: () => toast({ title: "Save failed", variant: "destructive" }),
        },
      );
    } catch {
      toast({ title: "PDF error", variant: "destructive" });
    } finally {
      setUploadingKey(null);
      e.target.value = "";
    }
  };

  const calcRowStats = (pt: string, day: number, name: string, level: number, reps: number) => {
    const vals: (number | null)[] = [];
    for (let rep = 1; rep <= reps; rep++) {
      const v = parseFloat(localResults[`${pt}_${day}_${name}_${level}_${rep}`] ?? "");
      vals.push(isNaN(v) ? null : v);
    }
    return calculateStats(vals);
  };

  if (sessionLoading || resultsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-bold">Session not found</h2>
        <Button asChild className="mt-6"><Link href="/sessions">Back to Sessions</Link></Button>
      </div>
    );
  }

  const worklist = session.worklist;
  const hasInter = worklist.precisionType === "inter" || worklist.precisionType === "both";
  const hasIntra = worklist.precisionType === "intra" || worklist.precisionType === "both";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-full">
            <Link href="/sessions"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{session.name}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Protocol: <span className="font-medium text-foreground">{worklist.name}</span>
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/sessions/${sessionId}/export`}>Export & Summary</Link>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted">
          {hasInter && <TabsTrigger value="inter" className="data-[state=active]:bg-background">Inter-Day Precision</TabsTrigger>}
          {hasIntra && <TabsTrigger value="intra" className="data-[state=active]:bg-background">Intra-Day Precision</TabsTrigger>}
        </TabsList>

        {/* ── INTER-DAY ────────────────────────────────────────────────────── */}
        {hasInter && (
          <TabsContent value="inter" className="m-0 space-y-4">
            {/* Day selector tabs */}
            <Tabs value={activeDay.toString()} onValueChange={(v) => setActiveDay(parseInt(v))}>
              <TabsList className="bg-transparent border-b border-border w-full justify-start h-auto p-0 rounded-none overflow-x-auto flex-nowrap">
                {Array.from({ length: worklist.numDays }).map((_, i) => {
                  const day = i + 1;
                  const key = `day_${day}`;
                  const st = uploadStatus[key];
                  const hasData = Object.keys(localResults).some((k) => k.startsWith(`inter_${day}_`));
                  return (
                    <TabsTrigger
                      key={day}
                      value={day.toString()}
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-5 flex items-center gap-2"
                    >
                      Day {day}
                      {hasData && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {Array.from({ length: worklist.numDays }).map((_, i) => {
                const day = i + 1;
                const uploadKey = `day_${day}`;
                const st = uploadStatus[uploadKey];
                const isUploading = uploadingKey === uploadKey;

                return (
                  <TabsContent key={day} value={day.toString()} className="m-0 pt-4">
                    {/* Hidden file input for this day */}
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      ref={(el) => { dayFileRefs.current[uploadKey] = el; }}
                      onChange={(e) => handlePdfUpload(e, "inter", day, uploadKey)}
                    />

                    <Card className="shadow-sm">
                      <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b">
                        <div>
                          <CardTitle className="text-sm font-semibold">Day {day} — {worklist.repsPerDay} Replicates (Inter-Day)</CardTitle>
                          {st && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {st.file} — {st.count} results loaded
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs border-primary text-primary hover:bg-primary/10"
                            disabled={isUploading || !!uploadingKey}
                            onClick={() => dayFileRefs.current[uploadKey]?.click()}
                          >
                            {isUploading ? (
                              <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Parsing...</>
                            ) : (
                              <><Upload className="w-3 h-3 mr-1.5" />Upload Day {day} PDF</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => handleSave("inter", day)}
                            disabled={saveResults.isPending}
                          >
                            <Save className="w-3 h-3 mr-1.5" />Save Day {day}
                          </Button>
                        </div>
                      </CardHeader>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-muted/50 text-muted-foreground border-b">
                            <tr>
                              <th className="font-medium p-3 whitespace-nowrap min-w-[110px]">Analyte</th>
                              <th className="font-medium p-3 whitespace-nowrap min-w-[70px]">Level</th>
                              {Array.from({ length: worklist.repsPerDay }).map((_, r) => (
                                <th key={r} className="font-medium p-3 text-center whitespace-nowrap min-w-[80px]">Rep {r + 1}</th>
                              ))}
                              <th className="font-medium p-3 text-right whitespace-nowrap border-l border-border bg-muted/30 min-w-[70px]">Mean</th>
                              <th className="font-medium p-3 text-right whitespace-nowrap bg-muted/30 min-w-[70px]">SD</th>
                              <th className="font-medium p-3 text-right whitespace-nowrap bg-muted/30 min-w-[70px]">%CV</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {worklist.analytes.map((analyte) =>
                              Array.from({ length: analyte.levels }).map((_, l) => {
                                const level = l + 1;
                                const stats = calcRowStats("inter", day, analyte.name, level, worklist.repsPerDay);
                                return (
                                  <tr key={`${analyte.name}-${level}`} className="hover:bg-muted/20">
                                    <td className="p-3 font-semibold text-foreground">{l === 0 ? analyte.name : ""}</td>
                                    <td className="p-2 text-muted-foreground text-xs">Level {level}</td>
                                    {Array.from({ length: worklist.repsPerDay }).map((_, r) => {
                                      const rep = r + 1;
                                      const key = `inter_${day}_${analyte.name}_${level}_${rep}`;
                                      return (
                                        <td key={rep} className="p-1.5">
                                          <Input
                                            type="number"
                                            step="any"
                                            className="h-8 text-center font-mono text-xs bg-transparent"
                                            value={localResults[key] ?? ""}
                                            onChange={(e) => handleInputChange("inter", day, analyte.name, level, rep, e.target.value)}
                                            placeholder="-"
                                          />
                                        </td>
                                      );
                                    })}
                                    <td className="p-2 text-right font-mono border-l border-border bg-muted/10 text-xs">{stats.mean !== null ? stats.mean.toFixed(2) : "-"}</td>
                                    <td className="p-2 text-right font-mono bg-muted/10 text-xs">{stats.sd !== null ? stats.sd.toFixed(2) : "-"}</td>
                                    <td className="p-2 text-right font-mono font-medium bg-muted/10 text-xs">
                                      {stats.cv !== null ? (
                                        <span className={stats.cv > 5 ? "text-destructive" : "text-emerald-600"}>{stats.cv.toFixed(2)}%</span>
                                      ) : "-"}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </TabsContent>
                );
              })}
            </Tabs>
          </TabsContent>
        )}

        {/* ── INTRA-DAY ────────────────────────────────────────────────────── */}
        {hasIntra && (
          <TabsContent value="intra" className="m-0 space-y-4">
            {/* Hidden file input for intra */}
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              ref={intraFileRef}
              onChange={handleIntraPdfUpload}
            />

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b">
                <div>
                  <CardTitle className="text-sm font-semibold">Intra-Day Results — {worklist.intraDayReps} Replicates</CardTitle>
                  {uploadStatus["intra"] && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {uploadStatus["intra"]!.file} — {uploadStatus["intra"]!.count} results loaded
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-primary text-primary hover:bg-primary/10"
                    disabled={uploadingKey === "intra" || !!uploadingKey}
                    onClick={() => intraFileRef.current?.click()}
                  >
                    {uploadingKey === "intra" ? (
                      <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Parsing...</>
                    ) : (
                      <><Upload className="w-3 h-3 mr-1.5" />Upload Intra PDF</>
                    )}
                  </Button>
                  <Button size="sm" className="h-8 text-xs" onClick={() => handleSave("intra", 0)} disabled={saveResults.isPending}>
                    <Save className="w-3 h-3 mr-1.5" />Save Intra-Day
                  </Button>
                </div>
              </CardHeader>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b">
                    <tr>
                      <th className="font-medium p-3 whitespace-nowrap sticky left-0 z-10 bg-muted/50 min-w-[110px]">Analyte</th>
                      <th className="font-medium p-3 whitespace-nowrap sticky left-[110px] z-10 bg-muted/50 min-w-[70px]">Level</th>
                      {Array.from({ length: worklist.intraDayReps }).map((_, r) => (
                        <th key={r} className="font-medium p-3 text-center whitespace-nowrap min-w-[75px]">Rep {r + 1}</th>
                      ))}
                      <th className="font-medium p-3 text-right whitespace-nowrap border-l border-border bg-muted/30">Mean</th>
                      <th className="font-medium p-3 text-right whitespace-nowrap bg-muted/30">SD</th>
                      <th className="font-medium p-3 text-right whitespace-nowrap bg-muted/30">%CV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {worklist.analytes.map((analyte) =>
                      Array.from({ length: analyte.levels }).map((_, l) => {
                        const level = l + 1;
                        const stats = calcRowStats("intra", 0, analyte.name, level, worklist.intraDayReps);
                        return (
                          <tr key={`${analyte.name}-${level}`} className="hover:bg-muted/20">
                            <td className="p-3 font-semibold sticky left-0 z-10 bg-card">{l === 0 ? analyte.name : ""}</td>
                            <td className="p-2 text-muted-foreground text-xs sticky left-[110px] z-10 bg-card">Level {level}</td>
                            {Array.from({ length: worklist.intraDayReps }).map((_, r) => {
                              const rep = r + 1;
                              const key = `intra_0_${analyte.name}_${level}_${rep}`;
                              return (
                                <td key={rep} className="p-1.5">
                                  <Input
                                    type="number"
                                    step="any"
                                    className="h-8 text-center font-mono text-xs bg-transparent"
                                    value={localResults[key] ?? ""}
                                    onChange={(e) => handleInputChange("intra", 0, analyte.name, level, rep, e.target.value)}
                                    placeholder="-"
                                  />
                                </td>
                              );
                            })}
                            <td className="p-2 text-right font-mono border-l border-border bg-muted/10 text-xs">{stats.mean !== null ? stats.mean.toFixed(2) : "-"}</td>
                            <td className="p-2 text-right font-mono bg-muted/10 text-xs">{stats.sd !== null ? stats.sd.toFixed(2) : "-"}</td>
                            <td className="p-2 text-right font-mono font-medium bg-muted/10 text-xs">
                              {stats.cv !== null ? (
                                <span className={stats.cv > 5 ? "text-destructive" : "text-emerald-600"}>{stats.cv.toFixed(2)}%</span>
                              ) : "-"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
