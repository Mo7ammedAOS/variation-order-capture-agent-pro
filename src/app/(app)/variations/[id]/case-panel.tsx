'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Archive, CheckCircle2, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { cancelChangeAction, deleteChangeAction, type EditState } from './actions';

/**
 * Ending a claim, or bringing one back.
 *
 * Kept apart from the status dropdown on purpose. Cancelling is not "one more
 * status": it is the company deciding to stop pursuing money it may be owed,
 * and it should not sit in a list beside "QS pricing" where it can be picked
 * by accident.
 *
 * There is no delete, and the panel says so. This is a record whose entire
 * value is that it cannot be quietly removed.
 */
function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function CasePanel({
  potentialChangeId,
  cancelled,
  canCancel,
  canDelete,
}: {
  potentialChangeId: string;
  cancelled: boolean;
  canCancel: boolean;
  /** Held by the administrator and the director, and nobody on the project. */
  canDelete: boolean;
}) {
  const [state, action] = useActionState<EditState, FormData>(cancelChangeAction, {});
  const [open, setOpen] = useState(false);

  return (
    <Card tone={cancelled ? 'notice' : 'plain'}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {cancelled ? (
            <Undo2 aria-hidden className="size-4" />
          ) : (
            <Archive aria-hidden className="size-4" />
          )}
          {cancelled ? 'This change is cancelled' : 'No longer a claim?'}
        </CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {cancelled
            ? 'It stays on the file with the reason and who decided, and it can be brought back with its original capture date.'
            : 'Cancelling stops the work and the reminders. The record, its evidence and its dates stay, because they are what prove the claim existed at all.'}
        </p>
      </CardHeader>

      <CardContent>
        {!canCancel ? null : open ? (
          <form action={action} className="flex flex-col gap-2.5">
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <input type="hidden" name="mode" value={cancelled ? 'reinstate' : 'cancel'} />

            <Label htmlFor="cancel-reason">
              {cancelled ? 'Why is it a claim again?' : 'Why is this no longer a claim?'}
            </Label>
            <Textarea
              id="cancel-reason"
              name="reason"
              rows={2}
              required
              placeholder={
                cancelled
                  ? 'What has changed since it was cancelled.'
                  : 'For example: duplicate of PC-DXB-001-0004, or the client withdrew the instruction in writing on 12 Sep.'
              }
            />
            <p className="text-xs text-muted-foreground">
              Somebody will read this in a year, and they were not there.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Submit
                label={cancelled ? 'Reinstate it' : 'Cancel this change'}
                busy={cancelled ? 'Reinstating…' : 'Cancelling…'}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Keep it as it is
              </button>
            </div>

            {state.error ? (
              <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {state.error}
              </p>
            ) : null}
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                {cancelled ? (
                  <>
                    <Undo2 aria-hidden className="size-4" />
                    Reinstate this change
                  </>
                ) : (
                  <>
                    <Archive aria-hidden className="size-4" />
                    Cancel this change
                  </>
                )}
              </Button>
            </div>
            {state.ok ? (
              <p className="flex items-start gap-2 text-sm text-risk-green">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
                {state.ok}
              </p>
            ) : null}
          </div>
        )}

        {canDelete ? <DeleteControl potentialChangeId={potentialChangeId} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * The permanent one, and it looks like it.
 *
 * ── Why it is here and not in a menu ──────────────────────────────────────
 * Osman's call, 2026-09-05. Hiding a destructive action behind a menu does not
 * make it safer; it makes it undiscoverable, so the person who needs it hunts,
 * gives up, and leaves the junk record in the register. Red and in the open is
 * the honest arrangement: easy to find, impossible to mistake for anything
 * else.
 *
 * ── The one tap in between ────────────────────────────────────────────────
 * Not a modal, not typing the PC number back. One tap that replaces the button
 * with what is about to happen and two choices. It costs a second, it is the
 * difference between a fat thumb on a phone and a destroyed claim, and it is
 * the last cheap moment — after this there is no undo anywhere in the system.
 */
function DeleteControl({ potentialChangeId }: { potentialChangeId: string }) {
  const [state, action] = useActionState<EditState, FormData>(deleteChangeAction, {});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-4 border-t border-border pt-3">
      {confirming ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
          <p className="text-sm font-semibold text-risk-red">
            Delete permanently? This cannot be undone.
          </p>
          <p className="text-xs text-muted-foreground">
            The change, its tasks, its pricing and any unissued notice go. Photographs and
            documents stay in the project library, and the deletion is recorded against your name.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <DeleteSubmit />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              No, keep it
            </button>
          </div>
          {state.error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden className="size-4" />
            Delete permanently
          </Button>
          <p className="text-xs text-muted-foreground">
            For a record that should never have existed — a test, or the same change filed twice.
            A real claim gets cancelled, not deleted.
          </p>
        </div>
      )}
    </div>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      <Trash2 aria-hidden className="size-4" />
      {pending ? 'Deleting…' : 'Yes, delete it'}
    </Button>
  );
}
