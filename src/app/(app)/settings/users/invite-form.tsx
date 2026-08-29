'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { SYSTEM_ROLE_LABELS } from '@/lib/rbac';
import { inviteUserAction, type InviteState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <UserPlus aria-hidden className="size-4" />
      {pending ? 'Sending…' : 'Send invitation'}
    </Button>
  );
}

export function InviteForm() {
  const [state, formAction] = useActionState<InviteState, FormData>(inviteUserAction, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Invite someone</CardTitle>
        <p className="text-sm text-muted-foreground">
          They set their own password from the emailed link. Project access is granted
          separately, on the project&apos;s Team tab.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" name="fullName" required placeholder="Ahmed Al Mansouri" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                inputMode="email"
                placeholder="ahmed@company.ae"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" placeholder="+971 50 123 4567" />
              <p className="text-xs text-muted-foreground">
                Used to match them when WhatsApp capture is connected.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="systemRole">Company role</Label>
              <Select id="systemRole" name="systemRole" defaultValue="standard_user">
                {Object.entries(SYSTEM_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Directors and admins see every project. Everyone else sees only what they
                are assigned.
              </p>
            </div>
          </div>

          {state.error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          ) : null}
          {state.ok ? (
            <p className="flex items-start gap-2 text-sm text-risk-green">
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
              {state.ok}
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
