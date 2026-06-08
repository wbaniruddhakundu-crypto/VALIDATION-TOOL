import { Link } from "wouter";
import { useListWorklists, useDeleteWorklist, getListWorklistsQueryKey, useCreateSession } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Plus, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function Worklists() {
  const { data: worklists, isLoading } = useListWorklists();
  const deleteWorklist = useDeleteWorklist();
  const createSession = useCreateSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this worklist?")) {
      deleteWorklist.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWorklistsQueryKey() });
          toast({ title: "Worklist deleted", description: "The worklist was successfully deleted." });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to delete worklist.", variant: "destructive" });
        }
      });
    }
  };

  const handleStartSession = (worklistId: number, worklistName: string) => {
    const sessionName = `${worklistName} Run - ${format(new Date(), "MMM d")}`;
    createSession.mutate({ data: { name: sessionName, worklistId } }, {
      onSuccess: (session) => {
        toast({ title: "Session created", description: "Validation session started successfully." });
        setLocation(`/sessions/${session.id}`);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to start session.", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Worklists</h1>
          <p className="text-muted-foreground mt-1">Manage your validation protocol templates.</p>
        </div>
        <Button asChild>
          <Link href="/worklists/new">
            <Plus className="w-4 h-4 mr-2" />
            New Worklist
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-2/3 mb-2" />
                <Skeleton className="h-4 w-1/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !worklists || worklists.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl bg-card">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No worklists defined</h3>
          <p className="text-muted-foreground max-w-sm mx-auto mb-6">
            Create a worklist to define the analytes, levels, and protocol parameters for your validation sessions.
          </p>
          <Button asChild>
            <Link href="/worklists/new">
              <Plus className="w-4 h-4 mr-2" />
              Create First Worklist
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {worklists.map((worklist) => (
            <Card key={worklist.id} className="flex flex-col border-border shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex justify-between items-start gap-4">
                  <div className="truncate">
                    <CardTitle className="text-lg truncate" title={worklist.name}>{worklist.name}</CardTitle>
                    <CardDescription className="mt-1">
                      Created {format(new Date(worklist.createdAt), "MMM d, yyyy")}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="shrink-0 uppercase text-[10px] tracking-wider">
                    {worklist.precisionType}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div className="text-muted-foreground">Analytes</div>
                  <div className="font-medium text-right">{worklist.analytes.length}</div>
                  
                  {worklist.precisionType !== "intra" && (
                    <>
                      <div className="text-muted-foreground">Inter-day</div>
                      <div className="font-medium text-right">{worklist.numDays}d × {worklist.repsPerDay} reps</div>
                    </>
                  )}
                  
                  {worklist.precisionType !== "inter" && (
                    <>
                      <div className="text-muted-foreground">Intra-day</div>
                      <div className="font-medium text-right">{worklist.intraDayReps} reps</div>
                    </>
                  )}
                </div>
                
                <div className="pt-2 flex flex-wrap gap-1">
                  {worklist.analytes.slice(0, 3).map((a, i) => (
                    <Badge key={i} variant="secondary" className="bg-secondary/50 font-normal">
                      {a.name} (L{a.levels})
                    </Badge>
                  ))}
                  {worklist.analytes.length > 3 && (
                    <Badge variant="secondary" className="bg-secondary/50 font-normal">
                      +{worklist.analytes.length - 3} more
                    </Badge>
                  )}
                </div>
              </CardContent>
              <div className="p-4 pt-0 mt-auto border-t border-border/50 flex gap-2 pt-4">
                <Button 
                  className="flex-1" 
                  onClick={() => handleStartSession(worklist.id, worklist.name)}
                  disabled={createSession.isPending}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Session
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(worklist.id)}
                  disabled={deleteWorklist.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
