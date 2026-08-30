'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, Clock, ThumbsDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { decideApprovalAction, type ApprovalState } from './actions';

/**
 * Both seats, side by side, whether or not you can fill either.
 *
 * Showing the seat you cannot fill is the point. "Waiting on the managing
 * director" is information a project manager needs; a panel that hides what it
 * cannot offer you leaves everybody guessing where a change actually is.
 *
 * Rejection is a separate, deliberate action with a required reason, not a
 * second button beside Approve. Someone rejecting has to type something, which
 * is the smallest possible speed bump in front of an answer that sends work
 * back to another person.
 */

export interface SeatView {
  id: string;
  seatLabel: string;
  decision: 'pending' | 'approved' | 'rejected';
  assignedToName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  /** Whether the signed-in person may fill this seat right now. */
  mine: boolean;
}

function SubmitButton({
  decision,
  label,
}: {
  decision: 'approved' | 'rejected';
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      variant={decision === 'approved' ? 'default' : 'outline'}
      size="sm"
      disabled={pending}
      className={decision === 'rejected' ? 'border-risk-red/40 text-risk-red' : undefined}
    >
      {decision === 'approved' ? (
        <Check aria-hidden className="size-4" />
      ) : (
        <ThumbsDown aria-hidden className="size-4" />
      )}
      {pending ? 'Saving…' : label}
    </Button>
  );
}

function SeatRow({ seat, potentialChangeId }: { seat: SeatView; potentialChangeId: string }) {
  const [state, formAction] = useActionState<ApprovalState, FormData>(decideApprovalAction, {});
  const [rejecting, setRejecting] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-xl bg-secondary/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{seat.seatLabel}</span>
        {seat.decision === 'approved' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-risk-green-bg px-2 py-0.5 text-xs font-semibold text-risk-green">
            <CheckCircle2 aria-hidden className="size-3" />
            Approved
          </span>
        ) : seat.decision === 'rejected' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-risk-red-bg px-2 py-0.5 text-xs font-semibold text-risk-red">
            <X aria-hidden className="size-3" />
            Rejected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-risk-amber-bg px-2 py-0.5 text-xs font-semibold text-risk-amber">
            <Clock aria-hidden className="size-3" />
            Waiting
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {seat.decision === 'pending'
          ? seat.assignedToName
            ? `With ${seat.assignedToName}.`
            : 'Nobody holds this authority yet. Grant it in Settings → Permissions.'
          : `${seat.decidedByName ?? 'Someone'}${seat.decidedAt ? ` on ${seat.decidedAt}` : ''}.`}
      </p>

      {seat.comment ? (
        <p className="rounded-lg bg-card px-3 py-2 text-sm leading-relaxed">{seat.comment}</p>
      ) : null}

      {seat.decision === 'pending' && seat.mine ? (
        <form action={formAction} className="mt-1 flex flex-col gap-2.5">
          <input type="hidden" name="approvalId" value={seat.id} />
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

          {rejecting ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`comment-${seat.id}`}>Why are you rejecting it?</Label>
              <Textarea
                id={`comment-${seat.id}`}
                name="comment"
                rows={2}
                required
                placeholder="What has to change before this can be approved."
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {rejecting ? (
              <>
                <SubmitButton decision="rejected" label="Confirm rejection" />
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <SubmitButton decision="approved" label="Approve" />
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  className="text-sm text-risk-red underline-offset-4 hover:underline"
                >
                  Reject instead
                </button>
              </>
            )}
          </div>

          {state.error ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-risk-red">
              <AlertCircle aria-hidden className="size-4" />
              {state.error}
            </p>
          ) : null}
          {state.ok ? (
            <p className="flex items-center gap-2 text-sm text-risk-green">
              <CheckCircle2 aria-hidden className="size-4" />
              {state.ok}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

export function ApprovalPanel({
  potentialChangeId,
  gateLabel,
  round,
  seats,
}: {
  potentialChangeId: string;
  gateLabel: string;
  round: number;
  seats: SeatView[];
}) {
  const done = seats.every((seat) => seat.decision === 'approved');

  return (
    <Card tone={done ? 'plain' : 'work'}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{gateLabel}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Both are required. {round > 1 ? `Round ${round}, after an earlier rejection.` : null}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2.5">
          {seats.map((seat) => (
            <SeatRow key={seat.id} seat={seat} potentialChangeId={potentialChangeId} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
