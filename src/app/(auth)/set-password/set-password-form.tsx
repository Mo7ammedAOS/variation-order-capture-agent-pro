'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createSupabaseBrowserClient } from '@/lib/auth/browser';
import { requestNewLink, type ResendState } from './actions';

/**
 * Where an invitation actually lands.
 *
 * Every account in this system is created by somebody else, so every person
 * arrives for the first time through a link in an email rather than through a
 * sign-up form. This screen is that arrival. It has to be a client component
 * because a recovery token is delivered in the URL fragment, which browsers
 * never send to a server.
 *
 * Four shapes of link exist in the wild and this accepts all of them, because
 * which one arrives depends on Supabase project settings and email templates
 * that are not in this repository:
 *
 *   #access_token=…&refresh_token=…   implicit flow, the common case
 *   ?code=…                           PKCE flow
 *   ?token_hash=…&type=recovery       templates using {{ .TokenHash }}
 *   #error=…&error_code=otp_expired   a dead link, which is routine
 *
 * The password is set through `updateUser`, which requires a live session —
 * that is the whole reason the token has to be exchanged first. Afterwards the
 * session is deliberately DISCARDED and the person signs in normally. It costs
 * one extra step and buys two things: proof the new password works, and the
 * full account check in the sign-in path, which a recovery session would
 * otherwise walk straight past.
 */

const MIN_PASSWORD = 10;

type Phase =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'dead'; message: string }
  | { kind: 'done' };

function ResendSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Sending…' : 'Email me a new link'}
    </Button>
  );
}

export function SetPasswordForm() {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resend, resendAction] = useActionState<ResendState, FormData>(requestNewLink, {});

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function establish() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);

      // The link is dead. Supabase says so in the fragment, and its own wording
      // ("Email link is invalid or has expired") is more accurate than anything
      // this screen could guess, so it is passed through.
      const failed = hash.get('error') ?? query.get('error');
      if (failed) {
        const described = hash.get('error_description') ?? query.get('error_description');
        setPhase({
          kind: 'dead',
          message: described ? described.replace(/\+/g, ' ') : 'That link is no longer valid.',
        });
        return;
      }

      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const code = query.get('code');
      const tokenHash = query.get('token_hash');

      // The token is removed from the address bar as soon as it is read. It is
      // a live credential until it is spent, and leaving it there puts it in
      // browser history, in a screenshot, and in whatever the person pastes
      // when they ask for help.
      const clean = () =>
        window.history.replaceState(null, '', window.location.pathname);

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        clean();
        if (sessionError) {
          setPhase({ kind: 'dead', message: sessionError.message });
          return;
        }
      } else if (code) {
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(code);
        clean();
        if (codeError) {
          setPhase({ kind: 'dead', message: codeError.message });
          return;
        }
      } else if (tokenHash) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });
        clean();
        if (otpError) {
          setPhase({ kind: 'dead', message: otpError.message });
          return;
        }
      }

      // No token in the URL is not necessarily a mistake: somebody may have
      // reloaded this page after the exchange already happened, in which case
      // the session is sitting in a cookie and the form should simply work.
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setPhase({
          kind: 'dead',
          message: 'This page needs the link from your email. Open the email and click it.',
        });
        return;
      }

      setEmail(data.user.email ?? null);
      setPhase({ kind: 'ready' });
    }

    void establish();
  }, []);

  async function save(formData: FormData) {
    setError(null);
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setSaving(false);
      setError(updateError.message);
      return;
    }

    // Discard the recovery session on purpose — see the note at the top.
    await supabase.auth.signOut();
    setSaving(false);
    setPhase({ kind: 'done' });
  }

  if (phase.kind === 'checking') {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Checking your link…
      </p>
    );
  }

  if (phase.kind === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 rounded-xl bg-risk-green-bg px-3.5 py-2.5 text-sm leading-snug text-risk-green">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          Password set. Sign in with it now.
        </p>
        <Button asChild size="lg" className="w-full">
          <a href="/login?reason=password_set">Go to sign in</a>
        </Button>
      </div>
    );
  }

  if (phase.kind === 'dead') {
    return (
      <div className="flex flex-col gap-4">
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-risk-amber-bg px-3.5 py-2.5 text-sm leading-snug text-risk-amber"
        >
          <MailWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
          {phase.message}
        </p>
        <p className="text-sm text-muted-foreground">
          These links expire, and some mail apps open them for you before you do, which uses
          them up. Ask for another and use it straight away.
        </p>

        {resend.sent ? (
          <p className="flex items-start gap-2 rounded-xl bg-risk-green-bg px-3.5 py-2.5 text-sm leading-snug text-risk-green">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
            If that address has an account, a new link is on its way to it.
          </p>
        ) : (
          <form action={resendAction} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="resend-email">Your email</Label>
              <Input
                id="resend-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="you@company.ae"
              />
            </div>
            {resend.error ? (
              <p
                role="alert"
                className="flex items-start gap-2 text-sm text-risk-red"
              >
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {resend.error}
              </p>
            ) : null}
            <ResendSubmit />
          </form>
        )}
      </div>
    );
  }

  return (
    <form action={save} className="flex flex-col gap-4">
      {email ? (
        <p className="text-sm text-muted-foreground">
          Setting the password for <span className="font-semibold text-foreground">{email}</span>
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD} characters. Nobody can look it up later, including us.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Type it again</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-risk-red-bg px-3 py-2 text-sm text-risk-red"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Set password and continue'}
      </Button>
    </form>
  );
}
