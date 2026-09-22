/**
 * Why a project manager decided no notice was needed.
 *
 * A fixed list rather than free text: "no" is the answer that gets asked about
 * a year later, and a blank beside it cannot be told apart from nobody having
 * looked. `other` exists so the list never forces a wrong answer, and it is
 * the one that should prompt a written note.
 *
 * In `lib` rather than beside the service because the review screen is a client
 * component, and the service it posts to is server-only. One list, both sides.
 */
export const NOTICE_NOT_REQUIRED_REASONS = [
  'included_in_scope',
  'contract_does_not_require',
  'covered_by_written_instruction',
  'client_instruction_documented',
  'internal_adjustment',
  'other',
] as const;

export type NoticeNotRequiredReason = (typeof NOTICE_NOT_REQUIRED_REASONS)[number];

export const NOTICE_NOT_REQUIRED_REASON_LABELS: Record<NoticeNotRequiredReason, string> = {
  included_in_scope: 'Included in existing scope',
  contract_does_not_require: 'Contract does not require notice for this type of change',
  covered_by_written_instruction: 'Change is already covered by written instruction',
  client_instruction_documented: 'Client instruction is already documented',
  internal_adjustment: 'Internal adjustment with no client entitlement',
  other: 'Other',
};
