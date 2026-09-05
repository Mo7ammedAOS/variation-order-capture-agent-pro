'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createCompany, type SetupState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? 'Setting up…' : 'Create the company'}
    </Button>
  );
}

export function SignupForm() {
  const [state, action] = useActionState<SetupState, FormData>(createCompany, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="companyName">Company name</Label>
        <Input id="companyName" name="companyName" required placeholder="Osman Contracting" />
        <p className="text-xs text-muted-foreground">
          Shown on this screen, in notices, and at the top of every page. Changeable later.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Your email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@company.ae"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
        <p className="text-xs text-muted-foreground">
          At least 10 characters. Nobody can look it up later, including us.
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
          minLength={10}
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-risk-red-bg px-3 py-2 text-sm text-risk-red"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
