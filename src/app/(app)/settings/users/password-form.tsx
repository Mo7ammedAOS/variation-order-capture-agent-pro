'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, KeyRound, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { resetPasswordAction, sendResetLinkAction, type PasswordState } from './actions';

/**
 * Getting somebody back into their account.
 *
 * Two ways, in the order they should be preferred. A link means the
 * administrator never learns the password, so there is nothing to be
 * overheard in a site office or written on a whiteboard. Typing one is for
 * the man on site whose email he cannot reach, which on a fit-out job is
 * most of them.
 *
 * There is deliberately no third option to READ the current password. It is
 * stored as a one-way hash and the plaintext exists nowhere — which is a
 * property worth keeping, not a gap: a system that can show a password is one
 * where a single compromised admin account exposes everybody at once.
 */

function generatePassword(): string {
  // Ambiguous characters left out — this gets read aloud and typed on a phone
  // with wet hands. No O/0, no I/l/1.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const values = new Uint32Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (n) => alphabet[n % alphabet.length]).join('');
}

function Pending({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Working…' : children}
    </Button>
  );
}

function LinkButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      <Mail aria-hidden className="size-4" />
      {pending ? 'Sending…' : 'Email a reset link'}
    </Button>
  );
}

export function PasswordControls({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [setState, setAction] = useActionState<PasswordState, FormData>(resetPasswordAction, {});
  const [linkState, linkAction] = useActionState<PasswordState, FormData>(sendResetLinkAction, {});

  const state = setState.error || setState.ok ? setState : linkState;

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <KeyRound aria-hidden className="size-4" />
          Password
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
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border border-input bg-secondary/40 p-3 text-start">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Password for {fullName}</p>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)}>
          <X aria-hidden className="size-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <form action={linkAction}>
        <input type="hidden" name="userId" value={userId} />
        <LinkButton />
      </form>

      <p className="text-xs text-muted-foreground">
        Or set one yourself, for somebody you cannot reach by email:
      </p>

      <form action={setAction} className="flex flex-col gap-2">
        <input type="hidden" name="userId" value={userId} />
        <Label htmlFor={`pw-${userId}`} className="sr-only">
          New password
        </Label>
        <Input
          id={`pw-${userId}`}
          name="password"
          // `text`, not `password`. He has to read it out to the person, and a
          // row of dots he cannot check is how the wrong password gets typed
          // twice and nobody knows which one is on the account.
          type="text"
          autoComplete="off"
          spellCheck={false}
          minLength={12}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 12 characters"
          className="font-mono text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Pending>Set password</Pending>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPassword(generatePassword())}
          >
            Generate
          </Button>
        </div>
      </form>

      {state.error ? (
        <p className="flex items-center gap-1.5 text-xs text-risk-red">
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
        Every reset is recorded against your name. The password itself is never
        stored anywhere it can be read back.
      </p>
    </div>
  );
}
