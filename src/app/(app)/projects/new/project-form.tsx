'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { CancelButton } from '@/components/ui/page-actions';
import { createProjectAction, type ProjectFormState } from '../actions';

/**
 * Only three fields are required — code, name, client. Everything else can be
 * filled in later from the project page.
 *
 * That is deliberate. A project gets set up on the day it is won, often from a
 * phone, by someone who has the client's name and not the contract number. A
 * form that demands all of it produces either a wrong contract number or no
 * project at all.
 */

const STATUSES = [
  ['tender', 'Tender — not yet won'],
  ['awarded', 'Awarded — not started'],
  ['active', 'Active'],
  ['on_hold', 'On hold'],
] as const;

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-risk-red">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto sm:min-w-52" disabled={pending}>
      {pending ? 'Creating…' : 'Create project'}
    </Button>
  );
}

export function ProjectForm() {
  const [state, formAction] = useActionState<ProjectFormState, FormData>(
    createProjectAction,
    {},
  );
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="projectCode"
              label="Project code"
              hint="Appears on every change number, e.g. PC-DXB-001-0001"
              error={err.projectCode}
            >
              <Input
                id="projectCode"
                name="projectCode"
                required
                placeholder="DXB-005"
                autoCapitalize="characters"
              />
            </Field>
            <Field name="projectStatus" label="Status">
              <Select id="projectStatus" name="projectStatus" defaultValue="active">
                {STATUSES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field name="projectName" label="Project name" error={err.projectName}>
            <Input
              id="projectName"
              name="projectName"
              required
              placeholder="Marina Gate Lobby Refurbishment"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="clientName" label="Client" error={err.clientName}>
              <Input id="clientName" name="clientName" required placeholder="Emaar Properties" />
            </Field>
            <Field name="consultantName" label="Consultant" hint="Optional">
              <Input id="consultantName" name="consultantName" placeholder="Aedas Interiors" />
            </Field>
          </div>

          <Field name="projectLocation" label="Location" hint="Optional">
            <Input
              id="projectLocation"
              name="projectLocation"
              placeholder="Dubai Marina, Dubai"
            />
          </Field>
        </CardContent>
      </Card>

      <details className="panel bg-card">
        <summary className="cursor-pointer select-none p-5 text-sm font-semibold sm:p-6">
          Contract details
          <span className="ms-2 font-normal text-muted-foreground">
            optional, and editable later
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-border/60 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="contractNumber" label="Contract number">
              <Input id="contractNumber" name="contractNumber" placeholder="ABC/2026/005" />
            </Field>
            <Field
              name="originalContractValue"
              label="Contract value"
              hint="Figures only. The currency is set beside it."
            >
              <Input
                id="originalContractValue"
                name="originalContractValue"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="12500000"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="currency" label="Currency">
              <Select id="currency" name="currency" defaultValue="AED">
                <option value="AED">AED</option>
                <option value="USD">USD</option>
                <option value="SAR">SAR</option>
                <option value="GBP">GBP</option>
                <option value="EUR">EUR</option>
              </Select>
            </Field>
            <Field name="contractStartDate" label="Start date">
              <Input id="contractStartDate" name="contractStartDate" type="date" />
            </Field>
            <Field name="contractCompletionDate" label="Completion date">
              <Input
                id="contractCompletionDate"
                name="contractCompletionDate"
                type="date"
              />
            </Field>
          </div>
        </div>
      </details>

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-risk-red-bg px-3.5 py-2.5 text-sm text-risk-red"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <CancelButton href="/projects" className="w-full sm:w-auto" />
        <SubmitButton />
      </div>
    </form>
  );
}
