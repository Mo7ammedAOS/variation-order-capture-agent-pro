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
}

/** Below this, a suggestion is held for human review rather than surfaced. */
export const CONFIDENCE_REVIEW_THRESHOLD = 0.6;
