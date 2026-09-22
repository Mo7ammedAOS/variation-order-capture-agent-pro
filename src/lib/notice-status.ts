/**
 * What state the initial notice is actually in, in words a person uses.
 *
 * The data behind this sits in three places — the change's `noticeStatus`, the
 * notice row's own status, and the delivery status of the message carrying it —
 * and no single one of them answers "where is my notice". Read alone, each of
 * them lies by omission: a notice that is `issued` reads as done, when the
 * email carrying it may have bounced an hour ago.
 *
 * The rule that must not be loosened: nothing here says Delivered on the
 * strength of our own outbound request. Only the courier's report back, which
 * is what moves the notice to `sent`, may do that.
 */

export type NoticeDisplayState =
  | 'not_applicable'
  | 'draft'
  | 'pending_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'acknowledgement_pending'
  | 'acknowledged';

export const NOTICE_DISPLAY_LABELS: Record<NoticeDisplayState, string> = {
  not_applicable: 'Not applicable',
  draft: 'Draft',
  pending_delivery: 'Pending delivery',
  delivered: 'Delivered',
  delivery_failed: 'Delivery failed',
  acknowledgement_pending: 'Acknowledgement pending',
  acknowledged: 'Acknowledged',
};

export interface NoticeDisplayStatus {
  state: NoticeDisplayState;
  label: string;
  /** Green means done, amber means waiting, red means somebody must act. */
  tone: 'green' | 'amber' | 'red' | 'neutral';
  /** The fact underneath the headline, when the headline hides one. */
  detail: string | null;
}

export function noticeDisplayStatus(input: {
  /** The change's own answer to "does this need a notice". */
  assessment: string;
  notice: { status: string; acknowledgedAt: Date | string | null } | null;
  /** Delivery status of the message currently carrying it, if any. */
  delivery: string | null;
}): NoticeDisplayStatus {
  const label = (state: NoticeDisplayState) => NOTICE_DISPLAY_LABELS[state];

  if (input.assessment === 'not_required') {
    return { state: 'not_applicable', label: label('not_applicable'), tone: 'neutral', detail: null };
  }

  if (!input.notice) {
    // Assessed as required, nothing written yet. Still the PM's move.
    return { state: 'draft', label: label('draft'), tone: 'amber', detail: 'Not drafted yet' };
  }

  if (input.notice.status === 'acknowledged' || input.notice.acknowledgedAt) {
    return { state: 'acknowledged', label: label('acknowledged'), tone: 'green', detail: null };
  }

  if (input.notice.status === 'sent') {
    // Delivered is a fact and acknowledgement is the open question, so the
    // question is the headline and the fact is kept underneath it.
    return {
      state: 'acknowledgement_pending',
      label: label('acknowledgement_pending'),
      tone: 'amber',
      detail: label('delivered'),
    };
  }

  if (input.notice.status === 'issued') {
    if (input.delivery === 'failed') {
      return {
        state: 'delivery_failed',
        label: label('delivery_failed'),
        tone: 'red',
        detail: 'Nothing reached the client. Retry it.',
      };
    }
    return {
      state: 'pending_delivery',
      label: label('pending_delivery'),
      tone: 'amber',
      detail: 'Sent from here, not yet confirmed by the courier',
    };
  }

  if (input.notice.status === 'superseded') {
    return { state: 'draft', label: label('draft'), tone: 'amber', detail: 'Redrafting' };
  }

  return { state: 'draft', label: label('draft'), tone: 'amber', detail: null };
}
