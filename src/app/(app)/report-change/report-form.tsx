'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { reportChange, type ReportState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Filing…' : 'File this change'}
    </Button>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm text-risk-red">
      <AlertCircle aria-hidden className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

/**
 * Required fields first, optional collapsed behind a disclosure. Someone
 * standing in a corridor should be able to finish this in four taps and a
 * photo; the detail can be added from a desk later.
 */
export function ReportChangeForm({
  projects,
  defaultProjectId,
  today,
}: {
  projects: { id: string; label: string }[];
  defaultProjectId?: string;
  today: string;
}) {
  const [state, formAction] = useActionState<ReportState, FormData>(reportChange, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="projectId">Project</Label>
            <Select id="projectId" name="projectId" defaultValue={defaultProjectId ?? ''} required>
              <option value="" disabled>
                Choose a project
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.projectId} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">What changed?</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={200}
              placeholder="Reception marble wall instead of paint"
            />
            <FieldError message={errors.title} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Describe it</Label>
            <Textarea
              id="description"
              name="description"
              required
              rows={4}
              placeholder="What was asked for, by whom, and what it replaces"
            />
            <FieldError message={errors.description} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" placeholder="Reception, Level 2" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requestedBy">Who requested it?</Label>
            <Input id="requestedBy" name="requestedBy" placeholder="Name and company" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eventDate">When did it happen?</Label>
              <Input id="eventDate" name="eventDate" type="date" defaultValue={today} required />
              <p className="text-xs text-muted-foreground">
                The notice deadline counts from this date.
              </p>
              <FieldError message={errors.eventDate} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workStatus">Has work started?</Label>
              <Select id="workStatus" name="workStatus" defaultValue="not_started">
                <option value="not_started">No, not started</option>
                <option value="in_progress">Yes, in progress</option>
                <option value="completed">Yes, completed</option>
                <option value="on_hold">On hold</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="urgency">Urgency</Label>
            <Select id="urgency" name="urgency" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="evidence">
              <span className="flex items-center gap-1.5">
                <Camera aria-hidden className="size-4" />
                Photo, screenshot or drawing
              </span>
            </Label>
            <Input
              id="evidence"
              name="evidence"
              type="file"
              multiple
              accept="image/*,application/pdf,audio/*"
              capture="environment"
              className="py-1.5"
            />
            <p className="text-xs text-muted-foreground">
              No proof means a weak claim. Attach what you can see now.
            </p>
          </div>
        </CardContent>
      </Card>

      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
          Add more detail (optional)
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trade">Trade</Label>
            <Input id="trade" name="trade" placeholder="Finishes, MEP, Joinery" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="drawingNumber">Drawing or RFI number</Label>
            <Input id="drawingNumber" name="drawingNumber" placeholder="AR-201 Rev C" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="estimatedValue">Estimated value (AED)</Label>
            <Input
              id="estimatedValue"
              name="estimatedValue"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
            />
            <p className="text-xs text-muted-foreground">
              A rough figure for triage. The QS prices it properly later.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="potentialTimeImpact"
              className="size-4 accent-[var(--primary)]"
            />
            This could delay the programme
          </label>
        </div>
      </details>

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-risk-red-bg px-3 py-2 text-sm text-risk-red"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
