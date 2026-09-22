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
import { noticeDisplayStatus } from '@/lib/notice-status';
import {
  acknowledgeNoticeAction,
  retryNoticeAction,
  saveNoticeDraftAction,
  sendNoticeAction,
  type NoticeState,
} from './actions';

/**
 * The notice, at whatever stage it has reached.
 *
 * ── Reading comes before sending ───────────────────────────────────────────
 * A draft opens as a PREVIEW, not as a form. The person about to serve it sees
 * the recipient, the subject, the words, the attachments and the deadline laid
 * out as the client will meet them, and edits only if they choose to. An
 * eighteen-row textarea as the first thing on the screen invites scrolling
 * past it to the button underneath.
 *
 * ── "Pending delivery" is not "delivered" ──────────────────────────────────
 * The panel says pending until the courier reports back with a message id, and
 * then shows the id. That distinction is the whole product: asking for a notice
 * to go out is not evidence that it went.
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
  /** The change's own answer to whether a notice was needed at all. */
  assessment: string;
  /** The contractual deadline this notice is being served against. */
  deadline: string | null;
  /** How it goes out, from the project's contract rules. */
  deliveryMethod: string;
  /** Evidence on the change, which travels with the notice. */
  attachments: { id: string; name: string }[];
  /** Whether the signed-in person may edit the wording. */
  canDraft: boolean;
  /** Whether they may record the client's acknowledgement. */
  canAcknowledge: boolean;
}

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      <Send aria-hidden className="size-3.5" />
      {pending ? 'Sending…' : 'Send initial notice'}
    </Button>
  );
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
  const reading = noticeDisplayStatus({
    assessment: notice.assessment,
    notice: { status: notice.status, acknowledgedAt: notice.acknowledgedAt },
    delivery: notice.deliveryStatus,
  });

  const tone =
    reading.tone === 'green'
      ? 'bg-risk-green-bg text-risk-green'
      : reading.tone === 'red'
        ? 'bg-risk-red-bg text-risk-red'
        : reading.tone === 'amber'
          ? 'bg-risk-amber-bg text-risk-amber'
          : 'bg-secondary text-muted-foreground';

  const Icon =
    reading.state === 'acknowledged'
      ? CheckCircle2
      : reading.state === 'delivery_failed'
        ? AlertCircle
        : reading.state === 'acknowledgement_pending'
          ? Send
          : reading.state === 'pending_delivery'
            ? Clock
            : FileText;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      <Icon aria-hidden className="size-3" />
      {reading.label}
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
  const [sendState, send] = useActionState<NoticeState, FormData>(sendNoticeAction, {});
  const [retryState, retry] = useActionState<NoticeState, FormData>(retryNoticeAction, {});
  const [acknowledging, setAcknowledging] = useState(false);
  const [editing, setEditing] = useState(false);

  const mayEdit = notice.status === 'draft' && notice.canDraft;
  // The draft opens as something to read. Editing is a choice, not the state
  // the screen starts in.
  const editable = mayEdit && editing;
  const failed = notice.status === 'issued' && notice.deliveryStatus === 'failed';

  return (
    <Card tone={notice.status === 'draft' ? 'work' : 'plain'}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {notice.status === 'draft' ? 'Review initial notice' : `Notice ${notice.reference}`}
          </CardTitle>
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
              ? `Nothing has gone yet. Read it, change anything you want to change, then send it to ${notice.recipientName ?? notice.recipientEmail}.`
              : 'No notice recipient is set on this project. Add one below, or set one in the project contract rules — it cannot be sent with nowhere to go.'
            : notice.status === 'issued'
              ? failed
                ? `The send failed: ${notice.deliveryFailureReason ?? 'no reason given'}. The notice stands; only its delivery failed. Pricing carries on.`
                : `Sent by ${notice.issuedByName ?? 'the project manager'}${notice.issuedAt ? ` on ${notice.issuedAt}` : ''}, waiting for the courier to confirm.`
              : notice.status === 'sent'
                ? `Delivered${notice.sentAt ? ` on ${notice.sentAt}` : ''} to ${notice.recipientEmail ?? 'the client'}. They have not acknowledged it yet.`
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
                Written for you from the change and the contract rules. Read
                it before you send it for approval. It speaks for your
                company.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SaveButton label="Save draft" />
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Cancel
              </button>
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
          <div className="flex flex-col gap-3">
            {/* The envelope, before the letter. Somebody about to serve this
                needs to see where it is going and what it is answering as
                plainly as they see the words. */}
            {notice.status === 'draft' ? (
              <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-secondary/50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Recipient
                  </dt>
                  <dd className="break-words">
                    {notice.recipientEmail
                      ? `${notice.recipientName ? `${notice.recipientName} — ` : ''}${notice.recipientEmail}`
                      : 'Not set'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Delivery method
                  </dt>
                  <dd>{notice.deliveryMethod}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Change reference
                  </dt>
                  <dd className="tabular">{notice.reference}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Notice deadline
                  </dt>
                  <dd className="tabular">{notice.deadline ?? 'Not set'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Attachments
                  </dt>
                  <dd>
                    {notice.attachments.length === 0
                      ? 'None'
                      : notice.attachments.map((file) => file.name).join(', ')}
                  </dd>
                </div>
              </dl>
            ) : null}

            <p className="text-sm font-semibold">{notice.subject}</p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 font-mono text-xs leading-relaxed">
              {notice.body}
            </pre>

            {notice.status !== 'draft' ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock aria-hidden className="size-3" />
                Fixed when it was sent. This is the wording the client has.
              </p>
            ) : mayEdit ? (
              <form action={send} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="noticeId" value={notice.id} />
                <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                <SendButton disabled={!notice.recipientEmail} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Edit notice
                </Button>
                {sendState.error ? (
                  <p role="alert" className="flex items-center gap-2 text-sm text-risk-red">
                    <AlertCircle aria-hidden className="size-4" />
                    {sendState.error}
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drafted by {notice.draftedByName ?? 'the system'}. You do not hold the authority
                to edit or send it.
              </p>
            )}
          </div>
        )}

        {/* Delivery failed. The notice stands, the carrying of it did not. */}
        {failed && notice.canDraft ? (
          <form
            action={retry}
            className="flex flex-wrap items-center gap-3 rounded-xl bg-risk-red-bg p-4"
          >
            <input type="hidden" name="noticeId" value={notice.id} />
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <p className="w-full text-sm font-medium text-risk-red">
              Initial notice delivery failed. Nothing reached the client.
            </p>
            <SaveButton label="Retry delivery" />
            {retryState.error ? (
              <p role="alert" className="text-sm text-risk-red">
                {retryState.error}
              </p>
            ) : null}
            {retryState.ok ? <p className="text-sm">{retryState.ok}</p> : null}
          </form>
        ) : null}

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
                Only tick this if you have actually seen their
                acknowledgement. Any old reply does not count.
              </p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
