'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Clock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select, Textarea } from '@/components/ui/input';
import { isRework, statusLabel } from '@/lib/status-labels';
import { submitStatusChange, type StatusState } from './actions';

/**
 * Sending a change back, and saying what a change is waiting on.
 *
 * It used to be titled "Next stage" with a "Move to" dropdown, which was true
 * when a dropdown advanced the lifecycle. It no longer does: assessments,
 * approvals and pricing each move the change themselves, because a decision
 * with evidence behind it should not be reachable by picking a word from a
 * list. What survives here is REWORK — sending it back to somebody — which is
 * a different act and reads differently.
 *
 * Osman read the old panel and could not tell what it was for. He was right:
 * it offered "Move to: pm scope review" on a change sitting at pricing, which
 * announces a step backwards as though it were the way forward, in machine
 * words, with an optional note.
 *
 * The empty case matters just as much. It used to say "this change has reached
 * the end of its lifecycle" for a change that was very much alive and simply
 * waiting on two approvals — alarming, and wrong.
 */

export type BlockedReason =
  | 'assessment'
  | 'notice_gate'
  | 'pricing'
  | 'final_gate'
  | 'ended'
  | null;

const BLOCKED_COPY: Record<Exclude<BlockedReason, null>, { title: string; body: string }> = {
  assessment: {
    title: 'Waiting on the notice assessment',
    body: 'Whether a contractual notice is required decides where this goes next, so it is answered rather than chosen from a list.',
  },
  notice_gate: {
    title: 'Waiting on two approvals',
    body: 'The project manager and the managing director both have to approve issuing the notice before this moves. Their decisions are what advance it.',
  },
  pricing: {
    title: 'Waiting on the price',
    body: 'The quantity surveyor either submits a build-up, or records that the work is already covered by the contract. Either answer moves it on.',
  },
  final_gate: {
    title: 'Waiting on the final approval',
    body: 'The submitted price is with the project manager and the managing director. Both have to approve before the variation is agreed.',
  },
  ended: {
    title: 'This change is closed',
    body: 'Nothing further happens to it. The record and its history stay on the file.',
  },
};

function MoveButton({ rework }: { rework: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={rework ? 'outline' : 'default'} disabled={pending}>
      {pending ? 'Saving…' : rework ? 'Send it back' : 'Move it on'}
    </Button>
  );
}

export function StatusForm({
  potentialChangeId,
  currentStatus,
  options,
  blockedBy,
}: {
  potentialChangeId: string;
  currentStatus: string;
  options: string[];
  blockedBy: BlockedReason;
}) {
  const [state, formAction] = useActionState<StatusState, FormData>(submitStatusChange, {});

  if (options.length === 0) {
    const copy = BLOCKED_COPY[blockedBy ?? 'ended'];
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock aria-hidden className="size-4" />
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
        </CardContent>
      </Card>
    );
  }

  // Everything on offer is an earlier stage, which is the usual case now.
  const allRework = options.every((option) => isRework(currentStatus, option));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCcw aria-hidden className="size-4" />
          {allRework ? 'Send this back for rework' : 'Move this on'}
        </CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {allRework
            ? 'If something is wrong or missing, return it to the stage that can fix it. The person there gets it back on their list, with your reason.'
            : 'Recorded against your name, with whatever note you leave.'}
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">{allRework ? 'Send it back to' : 'Move to'}</Label>
            <Select id="status" name="status" defaultValue="" required>
              <option value="" disabled>
                Choose a stage
              </option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">{allRework ? 'What needs fixing?' : 'Note (optional)'}</Label>
            <Textarea
              id="note"
              name="note"
              rows={2}
              required={allRework}
              placeholder={
                allRework
                  ? 'What is wrong, or what is missing, so the next person does not have to guess.'
                  : 'Why it is moving, or what it is waiting on'
              }
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-risk-red-bg px-3.5 py-2.5 text-sm text-risk-red"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <MoveButton rework={allRework} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
