'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, BellRing, CheckCircle2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { PROJECT_ROLE_LABELS } from '@/lib/rbac';
import { assignMemberAction, type MemberFormState } from './actions';

/**
 * Adding someone to a project, and saying whether they should be told about it.
 *
 * Those are two separate questions and the form keeps them separate. A director
 * may need telling about a change on a project they never open; a site engineer
 * needs full access and does not need a message every time a colleague files
 * something. Fold them together and you get either a silent system or one
 * everyone mutes.
 */

/** Client and consultant viewers are excluded: they are people outside the company. */
const ASSIGNABLE_ROLES = Object.entries(PROJECT_ROLE_LABELS).filter(
  ([role]) => role !== 'client_viewer' && role !== 'consultant_viewer',
);

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      <UserPlus aria-hidden className="size-4" />
      {pending ? 'Adding…' : 'Add to project'}
    </Button>
  );
}

export function AddMemberForm({
  projectId,
  people,
}: {
  projectId: string;
  people: { id: string; fullName: string; email: string }[];
}) {
  const [state, formAction] = useActionState<MemberFormState, FormData>(assignMemberAction, {});

  if (people.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Everyone in the company is already on this project. Invite more people from
            Settings → Users.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add someone to this project</CardTitle>
        <p className="text-sm text-muted-foreground">
          The project role decides what they can do here. Their company role is separate
          and does not change.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="userId">Person</Label>
              <Select id="userId" name="userId" required defaultValue="">
                <option value="" disabled>
                  Choose someone
                </option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="projectRole">Project role</Label>
              <Select id="projectRole" name="projectRole" required defaultValue="site_engineer">
                {ASSIGNABLE_ROLES.map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-secondary/50 p-4">
            <Input
              type="checkbox"
              name="notifyOnChange"
              className="mt-0.5 size-4 w-4 shrink-0 rounded"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <BellRing aria-hidden className="size-3.5" />
                Tell them when a change is raised here
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Separate from access. Someone can watch a project without being able to
                edit it, and work on one without being messaged about it.
              </span>
            </span>
          </label>

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

          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
