'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CalendarClock, ClipboardCheck, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { RiskChip } from '@/components/domain/risk-chip';
import { NOTICE_NOT_REQUIRED_REASON_LABELS } from '@/lib/notice-reasons';
import { submitNoticeAssessment, type AssessmentState } from './actions';

/**
 * The project manager's review, on one screen.
 *
 * Everything needed to answer the question is above the buttons: what happened,
 * who said so, when, whether work has started, what evidence there is, and how
 * many days are left to serve. The decision used to sit in a panel of its own
 * with the facts scattered up the page, which meant the honest way to make it
 * was to scroll, read, scroll back, and hope nothing had been missed.
 *
 * Choosing an answer never sends anything. "Yes" drafts a notice for this same
 * person to read and send deliberately; a button press is not service.
 */

type Choice = 'required' | 'not_required' | 'needs_more_information';

export interface ReviewFacts {
  potentialChangeId: string;
  reference: string;
  projectName: string;
  location: string | null;
  whatChanged: string;
  originalMessage: string | null;
  reportedBy: string | null;
  eventDate: string;
  workStarted: string;
  evidence: { id: string; name: string }[];
  noticePeriodDays: number;
  noticeDeadline: string;
  countdownLabel: string;
  riskLevel: 'green' | 'amber' | 'red';
  isOverdue: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-border/60 py-2 last:border-0 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Confirm({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : label}
    </Button>
  );
}

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'required', label: 'Yes — Send initial notice' },
  { value: 'not_required', label: 'No — Notice not required' },
  { value: 'needs_more_information', label: 'Need more information' },
];

export function ReviewPanel({ facts }: { facts: ReviewFacts }) {
  const [state, formAction] = useActionState<AssessmentState, FormData>(
    submitNoticeAssessment,
    {},
  );
  const [choice, setChoice] = useState<Choice | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck aria-hidden className="size-4" />
          Review change
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your name is saved against this decision. Nobody else can make it for you.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <dl className="flex flex-col">
          <Row label="Reference">
            <span className="tabular font-medium">{facts.reference}</span>
          </Row>
          <Row label="Project">{facts.projectName}</Row>
          <Row label="Location">{facts.location ?? '—'}</Row>
          <Row label="What changed">{facts.whatChanged}</Row>
          {facts.originalMessage ? (
            <Row label="Original message">
              {/* Word for word. What the reporter actually wrote is what goes
                  into a notice, so it is shown here unedited rather than as
                  anybody's summary of it. */}
              <span className="block whitespace-pre-wrap text-muted-foreground">
                {facts.originalMessage}
              </span>
            </Row>
          ) : null}
          <Row label="Instruction date">
            <span className="tabular">{facts.eventDate}</span>
          </Row>
          <Row label="Reported by">{facts.reportedBy ?? '—'}</Row>
          <Row label="Work started">{facts.workStarted}</Row>
          <Row label="Evidence">
            {facts.evidence.length === 0 ? (
              <span className="text-muted-foreground">Nothing attached</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {facts.evidence.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`/api/documents/${file.id}/content`}
                      className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                    >
                      <Paperclip aria-hidden className="size-3.5 shrink-0" />
                      <span className="break-all">{file.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        </dl>

        <section className="rounded-xl bg-secondary/50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
            <CalendarClock aria-hidden className="size-4" />
            Initial notice
          </h3>

          <dl className="mt-2 flex flex-col">
            <Row label="Project notice period">
              {/* Never a hardcoded 28. Whatever this project's contract says. */}
              <span className="tabular">{facts.noticePeriodDays} days</span>
            </Row>
            <Row label="Notice deadline">
              <span className="tabular">{facts.noticeDeadline}</span>
            </Row>
            <Row label="Days remaining">
              <RiskChip
                level={facts.riskLevel}
                label={facts.countdownLabel}
                breached={facts.isOverdue}
              />
            </Row>
          </dl>

          <p className="mt-4 text-sm font-medium">Should an initial notice be sent?</p>

          <div className="mt-2 flex flex-wrap gap-2">
            {CHOICES.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={choice === option.value ? 'default' : 'outline'}
                onClick={() => setChoice(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {choice ? (
            <form action={formAction} className="mt-4 flex flex-col gap-3">
              <input
                type="hidden"
                name="potentialChangeId"
                value={facts.potentialChangeId}
              />
              <input type="hidden" name="outcome" value={choice} />

              {choice === 'required' ? (
                <p className="text-sm text-muted-foreground">
                  The notice will be drafted for you to read. Nothing reaches the client
                  until you send it. Pricing starts now, in parallel.
                </p>
              ) : null}

              {choice === 'not_required' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reason">Why is no notice required?</Label>
                  <Select id="reason" name="reason" required defaultValue="">
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {Object.entries(NOTICE_NOT_REQUIRED_REASON_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              {choice === 'needs_more_information' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="missingInformation">What is missing?</Label>
                    <Input
                      id="missingInformation"
                      name="missingInformation"
                      required
                      placeholder="Which drawing revision the consultant was pointing at"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="allowPricingToContinue"
                      className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span>
                      Let the QS start pricing anyway. The change stays on your list and
                      still shows what is missing.
                    </span>
                  </label>
                </>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notes">
                  {choice === 'not_required' ? 'Anything to add (optional)' : 'Reasoning (optional)'}
                </Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="Clause relied on, or anything the next person should know"
                />
              </div>

              {state.error ? (
                <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {state.error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Confirm
                  label={
                    choice === 'required'
                      ? 'Draft the notice'
                      : choice === 'not_required'
                        ? 'Record: no notice required'
                        : 'Record what is missing'
                  }
                />
                <button
                  type="button"
                  onClick={() => setChoice(null)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Change answer
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
