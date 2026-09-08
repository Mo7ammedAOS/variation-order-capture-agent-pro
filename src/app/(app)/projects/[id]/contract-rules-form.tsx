'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { saveContractRules, type ContractRulesState } from './actions';

/**
 * The contract rules editor.
 *
 * Every field here has a downstream consequence that is easy to miss from the
 * field name alone, so each one says what it drives. `noticePeriodDays` in
 * particular is the difference between a served notice and lost entitlement,
 * and it is the field most likely to be left at the default by someone who
 * assumed the default was researched. It was not: 28 is a placeholder.
 */

export interface ContractRulesFormValues {
  contractType: string;
  contractClauseReference: string;
  noticePeriodDays: number;
  detailedClaimPeriodDays: number;
  noticeDeliveryMethod: string;
  noticeRecipientName: string;
  noticeRecipientEmail: string;
  noticeRecipientCompany: string;
  noticeTemplateName: string;
  variationProposalTemplateName: string;
  eotAssessmentRequired: boolean;
  approvalThresholdPm: string;
  approvalThresholdCm: string;
  approvalThresholdCommercialDirector: string;
  approvalThresholdManagingDirector: string;
  highRiskVoValue: string;
  voResponseDays: number;
  clientFollowUpEnabled: boolean;
  clientFollowUpDays: number;
  qsPricingDueDays: number;
  pmScopeReviewDueDays: number;
  internalApprovalDueDays: number;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save contract rules'}
    </Button>
  );
}

function Field({
  name,
  label,
  hint,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DaysField({
  name,
  label,
  hint,
  value,
  max = 90,
}: {
  name: string;
  label: string;
  hint?: string;
  value: number;
  max?: number;
}) {
  return (
    <Field name={name} label={label} hint={hint}>
      <Input id={name} name={name} type="number" inputMode="numeric" min={1} max={max} defaultValue={value} />
    </Field>
  );
}

function MoneyField({
  name,
  label,
  hint,
  value,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
}) {
  return (
    <Field name={name} label={label} hint={hint ?? 'Blank means no threshold.'}>
      <Input
        id={name}
        name={name}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        defaultValue={value}
        placeholder="No threshold"
      />
    </Field>
  );
}

function TextField({
  name,
  label,
  hint,
  value,
  type = 'text',
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <Field name={name} label={label} hint={hint}>
      <Input id={name} name={name} type={type} defaultValue={value} placeholder={placeholder} />
    </Field>
  );
}

export function ContractRulesForm({
  projectId,
  values,
}: {
  projectId: string;
  values: ContractRulesFormValues;
}) {
  const [state, formAction] = useActionState<ContractRulesState, FormData>(saveContractRules, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notice</CardTitle>
          <p className="text-sm text-muted-foreground">
            The notice period turns the date something happened into your
            deadline. Changing it here only affects changes reported from now
            on. Deadlines already worked out stay as they are.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="contractType"
            label="Contract type"
            value={values.contractType}
            placeholder="FIDIC Red Book 1999"
          />
          <TextField
            name="contractClauseReference"
            label="Clause reference"
            value={values.contractClauseReference}
            hint="The clause in the contract that the notice is sent under."
            placeholder="20.1"
          />
          <DaysField
            name="noticePeriodDays"
            label="Notice period (days)"
            value={values.noticePeriodDays}
            max={365}
            hint="How many days you get to send a notice, counted from the day it happened. Every day counts, including weekends. Check the contract, do not guess."
          />
          <DaysField
            name="detailedClaimPeriodDays"
            label="Detailed claim period (days)"
            value={values.detailedClaimPeriodDays}
            max={365}
            hint="How many days you get to send the full priced claim after the notice."
          />
          <TextField
            name="noticeDeliveryMethod"
            label="Delivery method"
            value={values.noticeDeliveryMethod}
            hint="The way your contract says a notice must be sent."
            placeholder="Email and registered post"
          />
          <TextField
            name="noticeRecipientName"
            label="Recipient name"
            value={values.noticeRecipientName}
          />
          <TextField
            name="noticeRecipientEmail"
            label="Recipient email"
            type="email"
            value={values.noticeRecipientEmail}
          />
          <TextField
            name="noticeRecipientCompany"
            label="Recipient company"
            value={values.noticeRecipientCompany}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Approval thresholds</CardTitle>
          <p className="text-sm text-muted-foreground">
            How much a change must be worth before this person has to approve
            it. Leave it empty if they never need to. Do not put zero, because
            zero means they approve everything.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <MoneyField name="approvalThresholdPm" label="Project Manager" value={values.approvalThresholdPm} />
          <MoneyField name="approvalThresholdCm" label="Commercial Manager" value={values.approvalThresholdCm} />
          <MoneyField
            name="approvalThresholdCommercialDirector"
            label="Commercial Director"
            value={values.approvalThresholdCommercialDirector}
          />
          <MoneyField
            name="approvalThresholdManagingDirector"
            label="Managing Director"
            value={values.approvalThresholdManagingDirector}
          />
          <MoneyField
            name="highRiskVoValue"
            label="High risk value"
            value={values.highRiskVoValue}
            hint="Any change worth more than this is marked high risk, whatever stage it is at."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Turnaround targets</CardTitle>
          <p className="text-sm text-muted-foreground">
            These are your own targets, not contract deadlines. They decide when
            tasks are due and when something counts as stuck.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DaysField name="pmScopeReviewDueDays" label="PM scope review (days)" value={values.pmScopeReviewDueDays} />
          <DaysField name="qsPricingDueDays" label="QS pricing (days)" value={values.qsPricingDueDays} />
          <DaysField
            name="internalApprovalDueDays"
            label="Internal approval (days)"
            value={values.internalApprovalDueDays}
          />
          <div className="flex items-start gap-3 sm:col-span-2">
            <input
              id="eotAssessmentRequired"
              name="eotAssessmentRequired"
              type="checkbox"
              defaultChecked={values.eotAssessmentRequired}
              className="mt-1 size-4 rounded border-input"
            />
            <Label htmlFor="eotAssessmentRequired" className="font-normal">
              Extension of time assessment required
              <span className="block text-xs text-muted-foreground">
                Whether every change must be assessed for time as well as cost.
              </span>
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Chasing the client</CardTitle>
          <p className="text-sm text-muted-foreground">
            This is the only thing the system sends to people outside your
            company. How often you chase a client is your decision, set for each
            project. You can also turn chasing off.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-3 sm:col-span-2">
            <input
              id="clientFollowUpEnabled"
              name="clientFollowUpEnabled"
              type="checkbox"
              defaultChecked={values.clientFollowUpEnabled}
              className="mt-1 size-4 rounded border-input"
            />
            <Label htmlFor="clientFollowUpEnabled" className="font-normal">
              Chase the client automatically
              <span className="block text-xs text-muted-foreground">
                Off means nothing is ever sent to the client from here. Your team is still
                reminded, and the variation still counts as overdue on the dashboard.
              </span>
            </Label>
          </div>
          <DaysField
            name="voResponseDays"
            label="Client response period (days)"
            value={values.voResponseDays}
            max={365}
            hint="How long the client has to reply. Nobody is chased until this time is up."
          />
          <DaysField
            name="clientFollowUpDays"
            label="Chase every (days)"
            value={values.clientFollowUpDays}
            hint="Once the client is late, how many days to wait between reminders. Put 7 for once a week."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Templates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField name="noticeTemplateName" label="Notice template" value={values.noticeTemplateName} />
          <TextField
            name="variationProposalTemplateName"
            label="Variation proposal template"
            value={values.variationProposalTemplateName}
          />
        </CardContent>
      </Card>

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      {state.ok ? (
        // Deliberately not green: globals.css reserves the RAG scale for risk, so
        // a green tick here would compete with a green risk chip meaning
        // something entirely different.
        <p className="flex items-center gap-2 rounded-md border border-border bg-accent p-3 text-sm">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          Contract rules saved.
        </p>
      ) : null}

      <div className="flex justify-end">
        <SaveButton />
      </div>
    </form>
  );
}
