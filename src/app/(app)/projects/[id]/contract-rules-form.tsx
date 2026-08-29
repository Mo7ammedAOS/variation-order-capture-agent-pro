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
            The notice period turns an event date into a contractual deadline. Changing it
            applies to changes captured from now on; deadlines already calculated on
            existing changes stay as they were.
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
            hint="The clause the notice is served under."
            placeholder="20.1"
          />
          <DaysField
            name="noticePeriodDays"
            label="Notice period (days)"
            value={values.noticePeriodDays}
            max={365}
            hint="Calendar days from the event date. Read this off the contract, not from memory."
          />
          <DaysField
            name="detailedClaimPeriodDays"
            label="Detailed claim period (days)"
            value={values.detailedClaimPeriodDays}
            max={365}
            hint="For the fully particularised claim that follows the notice."
          />
          <TextField
            name="noticeDeliveryMethod"
            label="Delivery method"
            value={values.noticeDeliveryMethod}
            hint="How the contract requires notices to be served."
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
            The value at which a change needs that person&apos;s approval. Leave one blank
            to mean there is no threshold at that level — zero would mean the opposite,
            that everything needs it.
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
            hint="Above this, a change is flagged as high risk regardless of status."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Turnaround targets</CardTitle>
          <p className="text-sm text-muted-foreground">
            Internal targets, not contractual deadlines. They set task due dates and decide
            when a change is counted as a bottleneck.
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
          <DaysField
            name="clientFollowUpDays"
            label="Client follow-up (days)"
            value={values.clientFollowUpDays}
            hint="How long to wait before chasing an unanswered submission."
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
