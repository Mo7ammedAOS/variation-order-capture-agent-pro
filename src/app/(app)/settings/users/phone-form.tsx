'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { setUserPhoneAction, type InviteState } from './actions';

/**
 * Which handset belongs to which person.
 *
 * ── Why this is not just another field on a form ──────────────────────────
 * On WhatsApp the number IS the identity. Everything arriving from a handset
 * is filed under whoever holds that number — their name on the record, in the
 * audit trail, and in the answer to "who told us about this" when it matters.
 *
 * So the panel says what will happen rather than labelling a box. An
 * administrator moving the site phone to a new engineer is not editing a
 * contact detail, they are deciding whose name goes on the next month of
 * reports.
 *
 * The number is TAKEN, not copied: the server clears it from whoever had it,
 * in the same transaction, and this reports that by name. Two people on one
 * number means every message from it is parked as ambiguous, and a handset
 * that works for nobody is worse than either of them having it.
 */

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save number'}
    </Button>
  );
}

export function PhoneControls({
  userId,
  fullName,
  phone,
}: {
  userId: string;
  fullName: string;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<InviteState, FormData>(setUserPhoneAction, {});

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Smartphone aria-hidden className="size-4" />
          {phone ?? 'Add WhatsApp number'}
        </Button>
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
    <form
      action={action}
      className="flex w-full max-w-sm flex-col gap-2 rounded-lg border border-input bg-secondary/40 p-3 text-start"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">WhatsApp number for {fullName}</p>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)}>
          <X aria-hidden className="size-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <input type="hidden" name="userId" value={userId} />
      <Label htmlFor={`phone-${userId}`} className="sr-only">
        WhatsApp number
      </Label>
      <Input
        id={`phone-${userId}`}
        name="phone"
        type="tel"
        autoComplete="off"
        defaultValue={phone ?? ''}
        placeholder="+971 50 123 4567"
        className="font-mono text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Save />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Leave it
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-risk-red">
          <AlertCircle aria-hidden className="size-3.5" />
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="flex items-center gap-1.5 text-xs text-risk-green">
          <CheckCircle2 aria-hidden className="size-3.5" />
          {state.ok}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Every WhatsApp report from this handset is filed under this person&apos;s name. Saving it
        here removes it from anybody else who had it. Leave it empty to take the number away.
      </p>
    </form>
  );
}
