'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { submitNoticeAssessment, type AssessmentState } from './actions';

const OPTIONS = [
  {
    value: 'required',
    title: 'Notice Required',
    description: 'A contractual notice must be served. The change moves to drafting.',
  },
  {
    value: 'not_required',
    title: 'Notice Not Required',
    description: 'No notice needed. The change still goes to QS pricing.',
  },
  {
    value: 'needs_more_information',
    title: 'Needs More Information',
    description: 'Cannot decide yet. Records the blocker and what is missing.',
  },
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : 'Record assessment'}
    </Button>
  );
}

export function AssessmentForm({ potentialChangeId }: { potentialChangeId: string }) {
  const [state, formAction] = useActionState<AssessmentState, FormData>(
    submitNoticeAssessment,
    {},
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gavel aria-hidden className="size-4" />
          Notice assessment
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your decision is recorded against your name and cannot be made by anyone else on
          your behalf.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Assessment outcome</legend>
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="outcome"
                  value={option.value}
                  required
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-sm text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Reasoning</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Clause relied on, what is missing, or why no notice is needed"
            />
          </div>

          {state.error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          ) : null}

          <div>
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
