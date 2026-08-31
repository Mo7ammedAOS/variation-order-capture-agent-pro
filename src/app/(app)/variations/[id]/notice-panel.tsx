'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  acknowledgeNoticeAction,
  saveNoticeDraftAction,
  type NoticeState,
} from './actions';

/**
 * The notice, at whatever stage it has reached.
 *
 * ── The text is always visible, editable or not ────────────────────────────
 * A director approving this is approving a page of words, so the words are on
 * the page. Once approved they go read-only and say so — an approval sitting
 * under text that was changed afterwards is worse than no approval at all.
 *
 * ── "Queued" is not "sent" ─────────────────────────────────────────────────
 * The panel says queued until the courier reports back with a message id, and
 * then says served and shows the id. That distinction is the whole product:
 * asking for a notice to go out is not evidence that it went.
 */

export interface NoticeView {
  id: string;
  reference: string;
  version: number;
  status: 'draft' | 'issued' | 'sent' | 'acknowledged' | 'superseded';
  subject: string;
  body: string;
  recipientName: string | null;
  recipientEmail: string | null;
  draftedByName: string | null;
  issuedByName: string | null;
  issuedAt: string | null;
  sentAt: string | null;
  externalMessageId: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  documentId: string | null;
  deliveryStatus: string | null;
  deliveryFailureReason: string | null;
  /** Whether the signed-in person may edit the wording. */
  canDraft: boolean;
  /** Whether they may record the client's acknowledgement. */
  canAcknowledge: boolean;
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

function StatusChip({ notice }: { notice: NoticeView }) {
  if (notice.status === 'acknowledged') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-green-bg px-2 py-0.5 text-xs font-semibold text-risk-green">
        <CheckCircle2 aria-hidden className="size-3" />
        Acknowledged
      </span>
    );
  }
  if (notice.status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-green-bg px-2 py-0.5 text-xs font-semibold text-risk-green">
        <Send aria-hidden className="size-3" />
        Served
      </span>
    );
  }
  if (notice.status === 'issued') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-amber-bg px-2 py-0.5 text-xs font-semibold text-risk-amber">
        <Clock aria-hidden className="size-3" />
        {notice.deliveryStatus === 'failed' ? 'Send failed' : 'Queued, not yet served'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
      <FileText aria-hidden className="size-3" />
      Draft
    </span>
  );
}

export function NoticePanel({
  potentialChangeId,
  notice,
}: {
  potentialChangeId: string;
  notice: NoticeView;
}) {
  const [draftState, saveDraft] = useActionState<NoticeState, FormData>(
    saveNoticeDraftAction,
    {},
  );
  const [ackState, acknowledge] = useActionState<NoticeState, FormData>(
    acknowledgeNoticeAction,
    {},
  );
  const [acknowledging, setAcknowledging] = useState(false);

  const editable = notice.status === 'draft' && notice.canDraft;

  return (
    <Card tone={notice.status === 'draft' ? 'work' : 'plain'}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Notice {notice.reference}</CardTitle>
          <StatusChip notice={notice} />
          {notice.version > 1 ? (
            <span className="text-xs text-muted-foreground">
              Version {notice.version}, after an earlier rejection
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {notice.status === 'draft'
            ? notice.recipientEmail
              ? `Goes to ${notice.recipientName ?? notice.recipientEmail} once both seats approve it.`
              : 'No notice recipient is set on this project. Set one in the project contract rules, or it will be approved with nowhere to go.'
            : notice.status === 'issued'
              ? notice.deliveryStatus === 'failed'
                ? `The send failed: ${notice.deliveryFailureReason ?? 'no reason given'}. It stays queued.`
                : `Approved by ${notice.issuedByName ?? 'two seats'}${notice.issuedAt ? ` on ${notice.issuedAt}` : ''}, waiting for the courier to confirm.`
              : notice.status === 'sent'
                ? `Served${notice.sentAt ? ` on ${notice.sentAt}` : ''} to ${notice.recipientEmail ?? 'the client'}.`
                : `Acknowledged${notice.acknowledgedAt ? ` on ${notice.acknowledgedAt}` : ''}, recorded by ${notice.acknowledgedByName ?? 'a colleague'}.`}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {editable ? (
          <form action={saveDraft} className="flex flex-col gap-3">
            <input type="hidden" name="noticeId" value={notice.id} />
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recipientName">Addressed to</Label>
                <Input
                  id="recipientName"
                  name="recipientName"
                  defaultValue={notice.recipientName ?? ''}
                  placeholder="The consultant or employer's representative"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recipientEmail">Their email</Label>
                <Input
                  id="recipientEmail"
                  name="recipientEmail"
                  type="email"
                  defaultValue={notice.recipientEmail ?? ''}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" defaultValue={notice.subject} required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="body">The notice</Label>
              <Textarea
                id="body"
                name="body"
                rows={18}
                defaultValue={notice.body}
                required
                className="font-mono text-xs leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                Written for you from the change and the contract rules. Read it before it goes
                to the approvers. It states a position in the company&apos;s name.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SaveButton label="Save the draft" />
              {draftState.error ? (
                <p role="alert" className="flex items-center gap-2 text-sm text-risk-red">
                  <AlertCircle aria-hidden className="size-4" />
                  {draftState.error}
                </p>
              ) : null}
              {draftState.ok ? (
                <p className="flex items-center gap-2 text-sm text-risk-green">
                  <CheckCircle2 aria-hidden className="size-4" />
                  {draftState.ok}
                </p>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{notice.subject}</p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 font-mono text-xs leading-relaxed">
              {notice.body}
            </pre>
            {notice.status !== 'draft' ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock aria-hidden className="size-3" />
                Fixed at approval. This is the wording that was approved.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drafted by {notice.draftedByName ?? 'the system'}. You do not hold the authority
                to edit it.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {notice.documentId ? (
            <a
              href={`/api/documents/${notice.documentId}/content`}
              className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
            >
              <FileText aria-hidden className="size-3.5" />
              Open the filed PDF
            </a>
          ) : notice.status !== 'draft' ? (
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle aria-hidden className="size-3.5" />
              No copy is filed in the project folder yet.
            </span>
          ) : null}

          {notice.externalMessageId ? (
            <span>Proof of service: {notice.externalMessageId}</span>
          ) : null}
        </div>

        {notice.canAcknowledge &&
        (notice.status === 'sent' || notice.status === 'issued') ? (
          acknowledging ? (
            <form action={acknowledge} className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
              <input type="hidden" name="noticeId" value={notice.id} />
              <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="acknowledgedOn">Date they acknowledged it</Label>
                  <Input id="acknowledgedOn" name="acknowledgedOn" type="date" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reference">Their reference, if any</Label>
                  <Input id="reference" name="reference" placeholder="Letter or email reference" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SaveButton label="Record it" />
                <button
                  type="button"
                  onClick={() => setAcknowledging(false)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Cancel
                </button>
                {ackState.error ? (
                  <p role="alert" className="flex items-center gap-2 text-sm text-risk-red">
                    <AlertCircle aria-hidden className="size-4" />
                    {ackState.error}
                  </p>
                ) : null}
              </div>
            </form>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setAcknowledging(true)}>
                Record the client&apos;s acknowledgement
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Only when you have actually seen it. A reply is not an acknowledgement.
              </p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
