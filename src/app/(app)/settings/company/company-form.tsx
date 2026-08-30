'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { saveCompanySettingsAction, type CompanyFormState } from './actions';

/**
 * The deployment's own identity, plus the two settings that move dates.
 *
 * Timezone and workweek are grouped with the amber threshold rather than with
 * the branding, because they are not presentation: a notice deadline is counted
 * from here, and getting them wrong moves a contractual date.
 */

const DAYS = [
  [0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'],
  [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'],
] as const;

const TIMEZONES = [
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait',
  'Asia/Karachi', 'Asia/Kolkata', 'Europe/London', 'UTC',
];

export interface CompanyDefaults {
  legalCompanyName: string;
  displayCompanyName: string;
  defaultCurrency: string;
  timezone: string;
  workweekStartDay: number;
  workweekEndDay: number;
  riskAmberThresholdDays: number;
  defaultEmailSenderName: string;
  defaultEmailSenderAddress: string;
  whatsappBusinessNumber: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:min-w-44">
      <Save aria-hidden className="size-4" />
      {pending ? 'Saving…' : 'Save settings'}
    </Button>
  );
}

function Field({ name, label, hint, children }: {
  name: string; label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CompanyForm({ defaults }: { defaults: CompanyDefaults }) {
  const [state, formAction] = useActionState<CompanyFormState, FormData>(
    saveCompanySettingsAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company</CardTitle>
          <p className="text-sm text-muted-foreground">
            The display name appears in the sidebar and on the sign-in page, so this
            deployment looks like your company rather than like a product.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="legalCompanyName" label="Legal name" hint="As it appears on contracts.">
              <Input id="legalCompanyName" name="legalCompanyName" required
                defaultValue={defaults.legalCompanyName} placeholder="ABC Fit-Out LLC" />
            </Field>
            <Field name="displayCompanyName" label="Display name" hint="Shown in the app.">
              <Input id="displayCompanyName" name="displayCompanyName" required
                defaultValue={defaults.displayCompanyName} placeholder="ABC Fit-Out" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="defaultCurrency" label="Default currency">
              <Select id="defaultCurrency" name="defaultCurrency" defaultValue={defaults.defaultCurrency}>
                {['AED', 'USD', 'SAR', 'QAR', 'GBP', 'EUR'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field name="whatsappBusinessNumber" label="WhatsApp business number"
              hint="The number capture messages arrive on.">
              <Input id="whatsappBusinessNumber" name="whatsappBusinessNumber" type="tel"
                inputMode="tel" defaultValue={defaults.whatsappBusinessNumber}
                placeholder="+971 4 000 0000" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dates and deadlines</CardTitle>
          <p className="text-sm text-muted-foreground">
            Not presentation. Notice deadlines are counted from here, so a wrong timezone
            moves a contractual date.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="timezone" label="Timezone">
              <Select id="timezone" name="timezone" defaultValue={defaults.timezone}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
            </Field>
            <Field name="workweekStartDay" label="Working week starts">
              <Select id="workweekStartDay" name="workweekStartDay"
                defaultValue={String(defaults.workweekStartDay)}>
                {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field name="workweekEndDay" label="ends">
              <Select id="workweekEndDay" name="workweekEndDay"
                defaultValue={String(defaults.workweekEndDay)}>
                {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>

          <Field name="riskAmberThresholdDays" label="Warn when a notice is this close"
            hint="Days remaining before a notice turns amber. Red is zero or breached, and is not configurable — a passed deadline is not a preference.">
            <Input id="riskAmberThresholdDays" name="riskAmberThresholdDays" type="number"
              min={1} max={60} required defaultValue={defaults.riskAmberThresholdDays}
              className="sm:max-w-40" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Outbound email</CardTitle>
          <p className="text-sm text-muted-foreground">
            Who notices and reports appear to come from. Used once the delivery lanes are
            connected.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="defaultEmailSenderName" label="Sender name">
            <Input id="defaultEmailSenderName" name="defaultEmailSenderName"
              defaultValue={defaults.defaultEmailSenderName} placeholder="ABC Fit-Out Commercial" />
          </Field>
          <Field name="defaultEmailSenderAddress" label="Sender address">
            <Input id="defaultEmailSenderAddress" name="defaultEmailSenderAddress" type="email"
              defaultValue={defaults.defaultEmailSenderAddress} placeholder="commercial@company.ae" />
          </Field>
        </CardContent>
      </Card>

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
  );
}
