'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { saveProjectAction, type ProjectFormState } from './actions';

/**
 * Correcting the project itself.
 *
 * Everything here was typed once, on the afternoon the job was set up, usually
 * before the contract was signed and often from a WhatsApp message. Dates
 * move, values are agreed, names are spelt properly, and a code gets mistyped.
 * Without this page the only way to fix any of it is a database query, so in
 * practice it never gets fixed and the register slowly stops matching the job.
 */

export interface ProjectFormValues {
  projectCode: string;
  projectName: string;
  clientName: string;
  consultantName: string;
  projectLocation: string;
  contractNumber: string;
  contractStartDate: string;
  contractCompletionDate: string;
  originalContractValue: string;
  currency: string;
  projectStatus: string;
}

const STATUSES: { value: string; label: string }[] = [
  { value: 'tender', label: 'Tender' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save project'}
    </Button>
  );
}

function Field({
  name,
  label,
  hint,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ProjectForm({
  projectId,
  values,
}: {
  projectId: string;
  values: ProjectFormValues;
}) {
  const [state, action] = useActionState<ProjectFormState, FormData>(saveProjectAction, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Project</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            name="projectCode"
            label="Project code"
            hint="Changing it does not rewrite references already issued — PC-DXB-001-0004 stays as it was served."
          >
            <Input id="projectCode" name="projectCode" defaultValue={values.projectCode} required />
          </Field>
          <Field name="projectName" label="Project name">
            <Input id="projectName" name="projectName" defaultValue={values.projectName} required />
          </Field>
          <Field name="clientName" label="Client">
            <Input id="clientName" name="clientName" defaultValue={values.clientName} required />
          </Field>
          <Field name="consultantName" label="Consultant">
            <Input id="consultantName" name="consultantName" defaultValue={values.consultantName} />
          </Field>
          <Field name="projectLocation" label="Location">
            <Input
              id="projectLocation"
              name="projectLocation"
              defaultValue={values.projectLocation}
            />
          </Field>
          <Field name="contractNumber" label="Contract number">
            <Input
              id="contractNumber"
              name="contractNumber"
              defaultValue={values.contractNumber}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dates and value</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="contractStartDate" label="Contract start">
            <Input
              id="contractStartDate"
              name="contractStartDate"
              type="date"
              defaultValue={values.contractStartDate}
            />
          </Field>
          <Field name="contractCompletionDate" label="Contract completion">
            <Input
              id="contractCompletionDate"
              name="contractCompletionDate"
              type="date"
              defaultValue={values.contractCompletionDate}
            />
          </Field>
          <Field
            name="originalContractValue"
            label="Original contract value"
            hint="The contract sum before any variation. Blank if it is not agreed yet."
          >
            <Input
              id="originalContractValue"
              name="originalContractValue"
              inputMode="decimal"
              defaultValue={values.originalContractValue}
            />
          </Field>
          <Field name="currency" label="Currency">
            <Input
              id="currency"
              name="currency"
              maxLength={3}
              defaultValue={values.currency}
              className="uppercase"
            />
          </Field>
          <Field
            name="projectStatus"
            label="Status"
            hint="Only active and awarded projects are chased, reported on, or offered when a change is captured."
          >
            <select
              id="projectStatus"
              name="projectStatus"
              defaultValue={values.projectStatus}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SaveButton />
        {state.error ? (
          <p className="flex items-center gap-1.5 text-sm text-risk-red">
            <AlertCircle aria-hidden className="size-4" />
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p className="flex items-center gap-1.5 text-sm text-risk-green">
            <CheckCircle2 aria-hidden className="size-4" />
            Saved. The change is on the project&apos;s activity trail.
          </p>
        ) : null}
      </div>
    </form>
  );
}
