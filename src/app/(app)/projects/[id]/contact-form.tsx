'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { createContactAction, type ContactFormState } from './actions';

/**
 * A contact, and — the part that matters — what they are actually allowed to
 * instruct.
 *
 * Authority is recorded per person rather than inferred from their job title,
 * because a "client representative" who cannot approve cost is completely
 * ordinary, and the whole point of this record is to answer "was the person who
 * told us to do it entitled to?" months later, when the answer is contested.
 *
 * Every box is off by default. An unverified contact who can do nothing is a
 * true record; one who can approve cost because a form guessed is not.
 */

const CONTACT_TYPES = [
  ['client', 'Client'],
  ['client_representative', 'Client representative'],
  ['consultant', 'Consultant'],
  ['architect', 'Architect'],
  ['interior_designer', 'Interior designer'],
  ['engineer', 'Engineer'],
  ['mep_consultant', 'MEP consultant'],
  ['landlord', 'Landlord'],
  ['authority', 'Authority'],
  ['main_contractor', 'Main contractor'],
  ['subcontractor', 'Subcontractor'],
  ['supplier', 'Supplier'],
  ['internal', 'Internal'],
  ['other', 'Other'],
] as const;

const AUTHORITIES = [
  ['canRequestChange', 'Can request a change', 'Asking for something different.'],
  ['canIssueTechnicalInstruction', 'Can issue a technical instruction', 'A formal TI or SI.'],
  ['canInstructWork', 'Can instruct work to start', 'Telling the site to proceed.'],
  ['canApproveCost', 'Can approve cost', 'Binding the client to money.'],
  ['canApproveTime', 'Can approve an extension of time', 'Binding the client to programme.'],
  ['canSignFinalVo', 'Can sign the final variation order', 'The signature that closes it.'],
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      <UserPlus aria-hidden className="size-4" />
      {pending ? 'Saving…' : 'Add contact'}
    </Button>
  );
}

export function AddContactForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<ContactFormState, FormData>(
    createContactAction,
    {},
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add a contact</CardTitle>
        <p className="text-sm text-muted-foreground">
          Everyone on the other side of this project, and what each of them can actually
          bind the client to.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" name="fullName" required placeholder="Fatima Al Marri" />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="contactType">Type</Label>
              <Select id="contactType" name="contactType" defaultValue="client_representative">
                {CONTACT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="companyName">Company</Label>
              <Input id="companyName" name="companyName" placeholder="Meridian Capital" />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="jobTitle">Job title</Label>
              <Input id="jobTitle" name="jobTitle" placeholder="Project Director" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="name@client.ae" />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                placeholder="+971 50 000 0000"
              />
              <p className="text-xs text-muted-foreground">
                The number their WhatsApp messages arrive from.
              </p>
            </div>
          </div>

          <fieldset className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
            <legend className="px-1 text-sm font-semibold">What can they authorise?</legend>
            <p className="-mt-1 text-sm text-muted-foreground">
              Leave anything you are unsure of switched off. An unverified contact who can
              do nothing is a true record; one who can approve cost because a form assumed
              it is not.
            </p>

            <label className="flex cursor-pointer items-start gap-3">
              <Input
                type="checkbox"
                name="authorityVerified"
                className="mt-0.5 size-4 w-4 shrink-0 rounded"
              />
              <span className="text-sm font-semibold">
                Authority verified in writing
                <span className="ms-1.5 font-normal text-muted-foreground">
                  someone has seen it confirmed, not assumed it
                </span>
              </span>
            </label>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {AUTHORITIES.map(([name, label, hint]) => (
                <label key={name} className="flex cursor-pointer items-start gap-3">
                  <Input
                    type="checkbox"
                    name={name}
                    className="mt-0.5 size-4 w-4 shrink-0 rounded"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Where their authority is recorded — a letter, a contract clause, a meeting minute."
            />
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

          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
