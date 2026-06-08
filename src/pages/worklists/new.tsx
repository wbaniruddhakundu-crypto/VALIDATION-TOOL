import { useState } from "react";
import { useLocation } from "wouter";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateWorklist, getListWorklistsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ArrowLeft, Save, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const levelInfoSchema = z.object({
  lot: z.string().default(""),
  limits: z.string().default(""),
});

const analyteSchema = z.object({
  name: z.string().min(1, "Analyte name is required"),
  levels: z.coerce.number().min(1).max(10),
  unit: z.string().default(""),
  allowableCV: z.coerce.number().optional(),
  calibrator: z.string().default(""),
  reagentLot: z.string().default(""),
  reagentExpiry: z.string().default(""),
  controlInfo: z.array(levelInfoSchema).default([]),
});

const worklistSchema = z.object({
  name: z.string().min(1, "Worklist name is required"),
  numDays: z.coerce.number().min(1).max(20),
  repsPerDay: z.coerce.number().min(1).max(20),
  intraDayReps: z.coerce.number().min(1).max(40),
  precisionType: z.enum(["inter", "intra", "both"]),
  analytes: z.array(analyteSchema).min(1, "At least one analyte is required"),
  metadata: z.object({
    location: z.string().default(""),
    instrument: z.string().default(""),
    hodcol: z.string().default(""),
    technician: z.string().default(""),
  }).default({}),
});

type WorklistFormValues = z.infer<typeof worklistSchema>;

function AnalyteFields({ index, remove, control, register, isLast }: any) {
  const [expanded, setExpanded] = useState(false);
  const levels = useWatch({ control, name: `analytes.${index}.levels` }) || 2;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-3 bg-muted/30">
        <FormField control={control} name={`analytes.${index}.name`} render={({ field }) => (
          <FormItem className="flex-1 mb-0">
            <FormControl>
              <Input placeholder="Analyte name (e.g. AST)" {...field} className="h-8" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={control} name={`analytes.${index}.levels`} render={({ field }) => (
          <FormItem className="w-20 mb-0">
            <FormControl>
              <Input type="number" min={1} max={10} placeholder="Lvls" {...field} className="h-8 text-center" />
            </FormControl>
          </FormItem>
        )} />
        <FormField control={control} name={`analytes.${index}.unit`} render={({ field }) => (
          <FormItem className="w-20 mb-0">
            <FormControl>
              <Input placeholder="Unit" {...field} className="h-8 text-center" />
            </FormControl>
          </FormItem>
        )} />
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => remove(index)} disabled={isLast}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {expanded && (
        <div className="p-4 space-y-4 bg-background border-t border-border">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <FormField control={control} name={`analytes.${index}.allowableCV`} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Allowable %CV</FormLabel>
                <FormControl><Input type="number" step="0.1" placeholder="e.g. 3.3" {...field} className="h-8" /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`analytes.${index}.calibrator`} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Calibrator ID</FormLabel>
                <FormControl><Input placeholder="e.g. 326084C" {...field} className="h-8" /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`analytes.${index}.reagentLot`} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Reagent Lot No</FormLabel>
                <FormControl><Input placeholder="Lot number" {...field} className="h-8" /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`analytes.${index}.reagentExpiry`} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Reagent Expiry</FormLabel>
                <FormControl><Input placeholder="e.g. 31-Jul-25" {...field} className="h-8" /></FormControl>
              </FormItem>
            )} />
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Control Info per Level</p>
            <div className="space-y-2">
              {Array.from({ length: Number(levels) }).map((_, li) => (
                <div key={li} className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs text-muted-foreground font-medium">Level {li + 1}</span>
                  <div className="col-span-1" />
                  <FormField control={control} name={`analytes.${index}.controlInfo.${li}.lot`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Control Lot No</FormLabel>
                      <FormControl><Input placeholder="Lot no" {...field} className="h-7 text-xs" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={control} name={`analytes.${index}.controlInfo.${li}.limits`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Control Limits</FormLabel>
                      <FormControl><Input placeholder="e.g. 3.97-4.54" {...field} className="h-7 text-xs" /></FormControl>
                    </FormItem>
                  )} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewWorklist() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createWorklist = useCreateWorklist();

  const form = useForm<WorklistFormValues>({
    resolver: zodResolver(worklistSchema),
    defaultValues: {
      name: "",
      numDays: 5,
      repsPerDay: 5,
      intraDayReps: 20,
      precisionType: "both",
      analytes: [{ name: "", levels: 2, unit: "", controlInfo: [{lot:"",limits:""},{lot:"",limits:""}] }],
      metadata: { location: "", instrument: "", hodcol: "", technician: "" },
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "analytes" });
  const precisionType = form.watch("precisionType");

  const onSubmit = (data: WorklistFormValues) => {
    createWorklist.mutate(
      { data: data as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWorklistsQueryKey() });
          toast({ title: "Worklist created" });
          setLocation("/worklists");
        },
        onError: () => toast({ title: "Error", description: "Failed to create worklist", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="rounded-full">
          <Link href="/worklists"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Worklist</h1>
          <p className="text-muted-foreground text-sm mt-1">Define validation protocol and analyte parameters.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          {/* Lab Metadata */}
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Lab Information</CardTitle>
              <CardDescription className="text-xs">Appears in the exported Excel header</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="metadata.location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location / Lab Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Dr. Lal Path Labs" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="metadata.instrument" render={({ field }) => (
                <FormItem>
                  <FormLabel>Instrument Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Atellica, Cobas" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="metadata.hodcol" render={({ field }) => (
                <FormItem>
                  <FormLabel>HOD / COL Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Dr. Gaurav" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="metadata.technician" render={({ field }) => (
                <FormItem>
                  <FormLabel>Technician Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Ms Noble" {...field} /></FormControl>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Protocol Parameters */}
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Protocol Parameters</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-full">
                  <FormLabel>Worklist Name</FormLabel>
                  <FormControl><Input placeholder="e.g. CHEM ATELLICA Q3 2025" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="precisionType" render={({ field }) => (
                <FormItem className="col-span-full">
                  <FormLabel>Precision Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="both">Both (Inter-Day & Intra-Day)</SelectItem>
                      <SelectItem value="inter">Inter-Day Only</SelectItem>
                      <SelectItem value="intra">Intra-Day Only</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              {precisionType !== "intra" && (
                <>
                  <FormField control={form.control} name="numDays" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of Days</FormLabel>
                      <FormControl><Input type="number" min={1} max={20} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="repsPerDay" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Replicates per Day (Inter)</FormLabel>
                      <FormControl><Input type="number" min={1} max={20} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}

              {precisionType !== "inter" && (
                <FormField control={form.control} name="intraDayReps" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Intra-Day Replicates</FormLabel>
                    <FormControl><Input type="number" min={1} max={40} {...field} /></FormControl>
                    <FormDescription className="text-xs">Typically 20</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </CardContent>
          </Card>

          {/* Analytes */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-base">Analytes</CardTitle>
                <CardDescription className="text-xs">Click the arrow on each analyte to add control & reagent info</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", levels: 2, unit: "", calibrator: "", reagentLot: "", reagentExpiry: "", controlInfo: [{lot:"",limits:""},{lot:"",limits:""}] })}>
                <Plus className="w-4 h-4 mr-2" />Add Analyte
              </Button>
            </CardHeader>
            <CardContent>
              <div className="mb-2 grid grid-cols-[1fr_80px_80px_36px_36px] gap-2 px-3">
                <span className="text-xs text-muted-foreground font-medium">Name</span>
                <span className="text-xs text-muted-foreground font-medium text-center">Levels</span>
                <span className="text-xs text-muted-foreground font-medium text-center">Unit</span>
                <span />
                <span />
              </div>
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <AnalyteFields
                    key={field.id}
                    index={index}
                    remove={remove}
                    control={form.control}
                    register={form.register}
                    isLast={fields.length === 1}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3 pb-12">
            <Button type="button" variant="outline" asChild>
              <Link href="/worklists">Cancel</Link>
            </Button>
            <Button type="submit" disabled={createWorklist.isPending}>
              {createWorklist.isPending ? "Saving..." : (
                <><Save className="w-4 h-4 mr-2" />Save Worklist</>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
