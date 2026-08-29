'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, ArrowRightCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select, Textarea } from '@/components/ui/input';
import { submitStatusChange, type StatusState } from './actions';

/**
 * Moving a change to its next stage.
 *
 * The options are computed server-side by `allowedNextStatuses` and passed in,
 * so this component holds no opinion about the lifecycle — when the commercial
 * process is finally written down, this form narrows without being touched.
 */
function MoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Moving…' : 'Move to stage'}
    </Button>
  );
}

export function StatusForm({
  potentialChangeId,
  currentStatus,
  options,
}: {
  potentialChangeId: string;
  currentStatus: string;
  options: string[];
}) {
  const [state, formAction] = useActionState<StatusState, FormData>(submitStatusChange, {});

  if (options.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightCircle aria-hidden className="size-4" />
            Next stage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {currentStatus === 'notice_assessment'
              ? 'Record the notice assessment first. Its outcome decides where this change goes next, so it is not a choice made from a list.'
              : 'This change has reached the end of its lifecycle.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightCircle aria-hidden className="size-4" />
          Next stage
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Recorded against your name, with whatever note you leave.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Move to</Label>
            <Select id="status" name="status" defaultValue="" required>
              <option value="" disabled>
                Choose a stage
              </option>
              {options.map((option) => (
                <option key={option} value={option} className="capitalize">
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              name="note"
              rows={2}
              placeholder="Why it is moving, or what it is waiting on"
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <MoveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
