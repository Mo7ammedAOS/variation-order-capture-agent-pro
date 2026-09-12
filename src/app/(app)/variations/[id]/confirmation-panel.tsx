'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, FileSignature, Send, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import {
  confirmationReceivedAction,
  draftConfirmationAction,
  issueConfirmationAction,
  type ConfirmationActionState,
} from './actions';

/**
 * The verbal-instruction warning, and the letter that answers it.
 *
 * ── Why this is red and near the top ───────────────────────────────────────
 * Under UAE Civil Code Art. 887 a lump-sum contractor generally cannot recover
 * for extra work without the employer's written agreement to the work and its
 * price. A verbally instructed change is therefore worth close to nothing
 * until somebody writes it down, and the person who can fix that is whoever
 * opens this screen in the first days — not the QS who finds it at final
 * account.
 *
 * ── Why it stays visible until ACKNOWLEDGED ────────────────────────────────
 * Sending the letter is our act. The article asks for the employer's
 * agreement, so the panel only turns green when a reply has been recorded. A
 * screen that went green on "sent" would tell somebody the position was safe
 * when it is merely documented.
 */

function Pending({ children, icon: Icon }: { children: React.ReactNode; icon: typeof Send }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Icon aria-hidden className="size-4" />
      {pending ? 'Working…' : children}
    </Button>
  );
}

export interface ConfirmationPanelProps {
  potentialChangeId: string;
  stage: 'none' | 'drafted' | 'sent' | 'confirmed';
  letter: {
    id: string;
    reference: string;
    documentId: string | null;
    acknowledgementReference: string | null;
  } | null;
  canAct: boolean;
}

export function ConfirmationPanel({
  potentialChangeId,
  stage,
  letter,
  canAct,
}: ConfirmationPanelProps) {
  const [recording, setRecording] = useState(false);
  const [draftState, draftAction] = useActionState<ConfirmationActionState, FormData>(
    draftConfirmationAction,
    {},
  );
  const [issueState, issueAction] = useActionState<ConfirmationActionState, FormData>(
    issueConfirmationAction,
    {},
  );
  const [receivedState, receivedAction] = useActionState<ConfirmationActionState, FormData>(
    confirmationReceivedAction,
    {},
  );

  const state =
    draftState.error || draftState.ok
      ? draftState
      : issueState.error || issueState.ok
        ? issueState
        : receivedState;

  const confirmed = stage === 'confirmed';

  return (
    <Card
      className={
        confirmed
          ? 'border-risk-green/40 bg-risk-green-bg/40'
          : 'border-risk-red/50 bg-risk-red-bg/40'
      }
    >
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {confirmed ? (
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-risk-green" />
          ) : (
            <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-risk-red" />
          )}
          <div className="min-w-0">
            <p className={`font-semibold ${confirmed ? 'text-risk-green' : 'text-risk-red'}`}>
              {confirmed
                ? 'Confirmed in writing'
                : 'Nobody has confirmed this instruction in writing'}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {confirmed ? (
                <>
                  The client has confirmed the instruction in writing
                  {letter?.acknowledgementReference
                    ? ` under reference ${letter.acknowledgementReference}`
                    : ''}
                  . This change now rests on a written record.
                </>
              ) : (
                <>
                  This change was instructed verbally. On a lump-sum contract in
                  the UAE, extra work generally cannot be recovered without the
                  client&apos;s agreement <strong>in writing</strong> to the work
                  and to its price. Until somebody writes it down, this one is
                  hard to get paid for however clearly it was instructed.
                </>
              )}
            </p>
          </div>
        </div>

        {!confirmed && canAct ? (
          <div className="flex flex-wrap items-center gap-2 ps-8">
            {stage === 'none' ? (
              <form action={draftAction}>
                <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                <Pending icon={FileSignature}>Write the confirmation letter</Pending>
              </form>
            ) : null}

            {stage === 'drafted' && letter ? (
              <>
                {letter.documentId ? null : (
                  <form action={issueAction}>
                    <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                    <input type="hidden" name="letterId" value={letter.id} />
                    <Pending icon={Send}>Send {letter.reference}</Pending>
                  </form>
                )}
                <span className="text-xs text-muted-foreground">
                  Read the draft below before it goes.
                </span>
              </>
            ) : null}

            {stage === 'sent' && letter ? (
              recording ? (
                <form action={receivedAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                  <input type="hidden" name="letterId" value={letter.id} />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ackRef" className="text-xs">
                      Their reference, if they gave one
                    </Label>
                    <Input id="ackRef" name="reference" placeholder="e.g. SI-114" className="h-9" />
                  </div>
                  <Pending icon={CheckCircle2}>They confirmed it</Pending>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRecording(false)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <Button type="button" size="sm" onClick={() => setRecording(true)}>
                    <CheckCircle2 aria-hidden className="size-4" />
                    Record their written confirmation
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {letter.reference} has gone. This stays red until they reply.
                  </span>
                </>
              )
            ) : null}

            {letter?.documentId ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/documents/${letter.documentId}/content`} target="_blank" rel="noopener">
                  Open {letter.reference}
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {state.error ? (
          <p role="alert" className="flex items-center gap-2 ps-8 text-sm text-risk-red">
            <AlertCircle aria-hidden className="size-4" />
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p className="flex items-center gap-2 ps-8 text-sm text-risk-green">
            <CheckCircle2 aria-hidden className="size-4" />
            {state.ok}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
