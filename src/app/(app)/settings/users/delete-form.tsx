'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteUserAction, type DeleteState } from './actions';

/**
 * Deleting somebody from the company.
 *
 * ── Why it asks twice ─────────────────────────────────────────────────────
 * Everything else on this row can be undone by pressing it again. This cannot.
 * The account and its sign-in are gone, and re-adding the same person makes a
 * new account, not the old one back. One stray click on a phone, in a list of
 * names that all look alike, should not be enough — so the first press only
 * asks, and the second one does it.
 *
 * ── Why it says what will happen ──────────────────────────────────────────
 * "Are you sure?" tells nobody anything. The confirmation names the person and
 * says the sign-in goes with them, because that is the part an administrator
 * does not otherwise see: an account can look dormant in this list and still be
 * a working login.
 */

function ConfirmButton({ fullName }: { fullName: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      <Trash2 aria-hidden className="size-4" />
      {pending ? 'Deleting…' : `Yes, delete ${fullName}`}
    </Button>
  );
}

export function DeleteControls({
  userId,
  fullName,
  blockedBy,
}: {
  userId: string;
  fullName: string;
  /**
   * What the record still points at. Anything here and the service will refuse,
   * so the button is not offered — the row explains instead.
   */
  blockedBy: string[];
}) {
  const [asking, setAsking] = useState(false);
  const [state, formAction] = useActionState<DeleteState, FormData>(deleteUserAction, {});

  if (blockedBy.length > 0) {
    return (
      <p className="max-w-56 text-end text-xs text-muted-foreground">
        Cannot be deleted — {blockedBy.slice(0, 2).join(' and ')} still name them.
        Deactivate instead.
      </p>
    );
  }

  if (!asking) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-risk-red"
          onClick={() => setAsking(true)}
        >
          <Trash2 aria-hidden className="size-4" />
          Delete
        </Button>
        {state.error ? (
          <p role="alert" className="flex max-w-64 items-start gap-1 text-start text-xs text-risk-red">
            <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p className="flex items-center gap-1 text-xs text-risk-green">
            <CheckCircle2 aria-hidden className="size-3" />
            {state.ok}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border border-risk-red/40 bg-risk-red/5 p-3 text-start">
      <p className="text-sm font-semibold">Delete {fullName}?</p>
      <p className="text-xs text-muted-foreground">
        This removes the account and the sign-in that goes with it. It cannot be
        undone, and adding them again later makes a new account. If you only want
        to stop them getting in, use Deactivate.
      </p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="userId" value={userId} />
        <ConfirmButton fullName={fullName} />
        <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)}>
          Keep the account
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-risk-red">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
