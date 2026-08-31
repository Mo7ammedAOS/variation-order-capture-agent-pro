'use client';

import { useActionState } from 'react';
import { Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { uploadLibraryDocumentAction, type LibraryFormState } from './actions';

/**
 * The four documents the system reads.
 *
 * Drawings, photos and RFIs are absent on purpose. They are evidence — stored
 * and served, never read — and offering them here would imply the system
 * understands a drawing, which it does not.
 */
const TYPES = [
  { value: 'contract', label: 'Contract', hint: 'Conditions, preliminaries, the signed agreement' },
  { value: 'boq', label: 'BOQ / rates', hint: 'Priced bill of quantities, schedule of rates' },
  { value: 'specification', label: 'Specification / scope', hint: 'What is included, and to what standard' },
  { value: 'programme', label: 'Programme', hint: 'The baseline dates' },
] as const;

export function LibraryForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<LibraryFormState, FormData>(
    uploadLibraryDocumentAction,
    {},
  );

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-sm font-semibold">Add a document the system should read</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Contract, BOQ, rates, scope. These are checked against every change that comes in, so
          the system can say <em>&ldquo;this looks like it is already in scope&rdquo;</em> before a
          claim is built on it. PDF, Excel or text — a scanned page with no text layer cannot be
          read.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="documentType" className="text-sm font-medium">
            What is it?
          </label>
          <select
            id="documentType"
            name="documentType"
            defaultValue="boq"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label} — {type.hint}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">
            File
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.txt,application/pdf,text/plain,text/csv"
            className="text-sm file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        </div>

        <Button type="submit" disabled={pending} className="self-start">
          <Upload aria-hidden className="size-4" />
          {pending ? 'Reading it…' : 'Upload and index'}
        </Button>
      </form>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? (
        <p className={state.ok.includes('NOT searchable') ? 'text-sm text-amber-700' : 'text-sm text-emerald-700'}>
          {state.ok}
        </p>
      ) : null}
    </Card>
  );
}
