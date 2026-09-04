/**
 * The AI boundary.
 *
 * Every agent output in this system carries the same envelope, whatever the
 * model produced it:
 *
 *   extracted_data          what the agent read out of the source
 *   confidence_score        0..1
 *   source_references       which evidence each field came from
 *   missing_information     what it could not find
 *   suggested_next_action   what a human should do next
 *
 * Free text is never an agent's only output, and an unparseable response is a
 * failure rather than a partial success — it must never be written through as
 * if it were data.
 *
 * AI suggests. Humans approve. The application validates.
 */

export interface AgentEnvelope<TData> {
  extractedData: TData;
  confidenceScore: number;
  sourceReferences: string[];
  missingInformation: string[];
  suggestedNextAction: string;
}

export interface CapturedChangeExtraction {
  changeDetected: boolean;
  suggestedTitle: string;
  changeDescription: string;
  location: string | null;
  requestedBy: string | null;
  affectedTrade: string[];
  possibleCostImpact: boolean;
  possibleTimeImpact: boolean;
  noticeAssessmentRequired: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;

  /** Reads a captured message and proposes a structured Potential Change. */
  extractPotentialChange(input: {
    text: string;
    sourceType: string;
    senderName?: string | null;
  }): Promise<AgentEnvelope<CapturedChangeExtraction>>;

  /** Transcribes a voice note. The original audio is never replaced. */
  transcribeVoiceNote(input: {
    audio: Buffer;
    mimeType: string;
  }): Promise<AgentEnvelope<{ transcript: string; language: string }>>;

  /**
   * Turns a site report into the account of it that goes in a notice.
   *
   * ── What this is, precisely ──────────────────────────────────────────────
   * A REWRITE. "clint want the celing lower in resption 300 he say monday" is
   * true, sufficient, and cannot be sent to a main contractor's commercial
   * team — a notice that reads as an unedited text message invites the reply
   * that it was not a proper notice. So the model restates the same facts in
   * the register the document is written in.
   *
   * ── What it must not become ──────────────────────────────────────────────
   * It may not add a fact. Not a date, not a drawing number, not a name, not a
   * quantity, and above all not a number — nothing that was not in the report
   * it was given. It may not assert entitlement, allege breach, quantify cost
   * or time, or characterise the change as instructed when the report does not
   * say so. Every one of those is a commercial judgement, and the system has
   * no business making one on a document served in the company's name.
   *
   * The output is a DRAFT into an editable notice that two seats then approve.
   * The reporter's original words stay on the change, untouched, for ever.
   */
  draftNoticeNarrative(input: {
    /** Exactly what the reporter wrote. The only source of fact. */
    description: string;
    title: string;
    /** Context for register and phrasing only. Never to be restated as fact. */
    trade?: string | null;
    location?: string | null;
    instructedBy?: string | null;
  }): Promise<AgentEnvelope<{ narrative: string }>>;
}

/** Below this, a suggestion is held for human review rather than surfaced. */
export const CONFIDENCE_REVIEW_THRESHOLD = 0.6;
