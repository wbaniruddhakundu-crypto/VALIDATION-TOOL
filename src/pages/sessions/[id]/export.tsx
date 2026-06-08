import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetSession,
  useGetSessionResults,
  useGetSessionSummary,
  getGetSessionQueryKey,
  getGetSessionResultsQueryKey,
  getGetSessionSummaryQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadAnalyteExcel, downloadAllAsZip, type WorklistInfo, type ResultRecord } from "@/lib/excel-export";
import { useToast } from "@/hooks/use-toast";

export default function SessionExport() {
  const [, params] = useRoute("/sessions/:id/export");
  const sessionId = params?.id ? parseInt(params.id) : 0;
  const { toast } = useToast();

  // Track which analyte is currently being downloaded
  const [downloadingAnalyte, setDownloadingAnalyte] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) },
  });
  const { data: results, isLoading: resultsLoading } = useGetSessionResults(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionResultsQueryKey(sessionId) },
  });
  const { data: summary, isLoading: summaryLoading } = useGetSessionSummary(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionSummaryQueryKey(sessionId) },
  });

  if (sessionLoading || resultsLoading || summaryLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!session || !summary) return <div>Session not found</div>;

  const worklist = session.worklist;
  const analytes = (worklist.analytes as any[]).map((a) => ({
    name: a.name,
    levels: a.levels,
    unit: a.unit ?? "",
    allowableCV: a.allowableCV,
    calibrator: a.calibrator ?? "",
    reagentLot: a.reagentLot ?? "",
    reagentExpiry: a.reagentExpiry ?? "",
    controlInfo: a.controlInfo ?? [],
  }));

  const worklistInfo: WorklistInfo = {
    name: worklist.name,
    numDays: worklist.numDays,
    repsPerDay: worklist.repsPerDay,
    intraDayReps: worklist.intraDayReps,
    precisionType: worklist.precisionType,
    analytes,
    metadata: (worklist as any).metadata ?? {},
  };

  const resultRecords = (results ?? []) as ResultRecord[];
  const totalResults = resultRecords.filter((r) => r.value !== null && r.value !== undefined).length;

  const handleDownloadAnalyte = async (analyteName: string) => {
    setDownloadingAnalyte(analyteName);
    try {
      await downloadAnalyteExcel(analyteName, session.name, worklistInfo, resultRecords);
      toast({ title: `${analyteName}_Precision.xlsx downloaded` });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setDownloadingAnalyte(null);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      await downloadAllAsZip(session.name, worklistInfo, resultRecords);
      toast({ title: "All analytes downloaded as ZIP" });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-full">
            <Link href={`/sessions/${sessionId}`}><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Export Results</h1>
            <p className="text-muted-foreground text-sm mt-1">{session.name} — {totalResults} results recorded</p>
          </div>
        </div>
        <Button
          onClick={handleDownloadAll}
          disabled={downloadingAll || totalResults === 0}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {downloadingAll ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Building ZIP...</>
          ) : (
            <><Package className="w-4 h-4 mr-2" />Download All (ZIP)</>
          )}
        </Button>
      </div>

      {/* Per-analyte download buttons */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Download by Analyte</CardTitle>
          <CardDescription className="text-xs">
            Each file follows the standard precision template — metadata header, CONTROL 1/2 sections, DATE × REPLICATION grid, SD/MEAN/CV columns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {totalResults === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4 border border-dashed rounded-lg">
              No results yet. Upload PDFs or enter data before downloading.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {analytes.map((analyte) => {
                const analyteResults = resultRecords.filter((r) => r.analyteName === analyte.name && r.value !== null);
                const isDownloading = downloadingAnalyte === analyte.name;
                return (
                  <button
                    key={analyte.name}
                    onClick={() => handleDownloadAnalyte(analyte.name)}
                    disabled={isDownloading || !!downloadingAnalyte || downloadingAll}
                    className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left group"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-6 h-6 text-emerald-600 group-hover:text-primary transition-colors" />
                    )}
                    <div className="text-center">
                      <p className="font-semibold text-xs text-foreground">{analyte.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {analyteResults.length} result{analyteResults.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Precision Summary</CardTitle>
          <CardDescription className="text-xs">Overall statistics across all recorded results</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Analyte</TableHead>
                <TableHead className="text-xs">Level</TableHead>
                <TableHead className="text-xs text-right">N</TableHead>
                <TableHead className="text-xs text-right">Mean</TableHead>
                <TableHead className="text-xs text-right">SD</TableHead>
                <TableHead className="text-xs text-right">%CV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.stats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    No data recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                summary.stats.map((stat, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {stat.precisionType}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{stat.analyteName}</TableCell>
                    <TableCell className="text-sm">Level {stat.level}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{stat.n}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{stat.mean !== null ? stat.mean.toFixed(3) : "-"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{stat.sd !== null ? stat.sd.toFixed(3) : "-"}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {stat.cv !== null ? (
                        <span className={stat.cv > 5 ? "text-destructive" : "text-emerald-600"}>
                          {stat.cv.toFixed(2)}%
                        </span>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
