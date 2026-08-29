import type {
  AgentEnvelope,
  AiProvider,
  CapturedChangeExtraction,
} from '@/integrations/claude/provider';

/**
 * The Phase 1 AI provider. Makes no network call and costs nothing.
 *
 * It is a keyword matcher wearing the real envelope, which is the point: the
 * whole pipeline — extraction, confidence handling, the human review gate, the
 * audit event — is exercised end to end before a single paid call is made.
 * Connecting the real Claude adapter in Phase 2 changes this file only.
 */

const TRADE_KEYWORDS: Record<string, string[]> = {
  Finishes: ['paint', 'marble', 'stone', 'tile', 'flooring', 'skirting', 'wallpaper'],
  Joinery: ['joinery', 'cabinet', 'millwork', 'door', 'wardrobe', 'counter'],
  MEP: ['mep', 'hvac', 'duct', 'chiller', 'plumbing', 'drainage'],
  Electrical: ['power', 'socket', 'lighting', 'light', 'cable', 'db board'],
  Fire: ['fire', 'sprinkler', 'alarm', 'civil defence', 'smoke'],
  Ceiling: ['ceiling', 'bulkhead', 'gypsum', 'soffit'],
  Civil: ['block', 'partition', 'screed', 'concrete', 'wall'],
};

const COST_MARKERS = ['additional', 'extra', 'change', 'replace', 'upgrade', 'revise', 'new'];
const TIME_MARKERS = ['delay', 'hold', 'stopped', 'access', 'waiting', 'postpone', 'restrict'];

export const mockAiProvider: AiProvider = {
  name: 'mock',
  model: 'mock-extractor-v1',

  async extractPotentialChange(input): Promise<AgentEnvelope<CapturedChangeExtraction>> {
    const text = input.text.toLowerCase();

    const affectedTrade = Object.entries(TRADE_KEYWORDS)
      .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
      .map(([trade]) => trade);

    const possibleCostImpact = COST_MARKERS.some((marker) => text.includes(marker));
    const possibleTimeImpact = TIME_MARKERS.some((marker) => text.includes(marker));
    const changeDetected = possibleCostImpact || possibleTimeImpact || affectedTrade.length > 0;

    const missingInformation: string[] = [];
    if (!input.senderName) missingInformation.push('Who requested the change');
    if (!text.match(/level|floor|room|reception|area|zone/)) {
      missingInformation.push('Location on site');
    }
    if (!text.match(/drawing|dwg|rev|sk-|rfi/)) missingInformation.push('Revised drawing reference');
    if (!text.match(/started|commenced|ongoing|not started/)) {
      missingInformation.push('Whether work has started');
    }

    // Confidence falls with each thing it could not find, so a thin message
    // lands below the review threshold rather than presenting as certain.
    const confidenceScore = changeDetected
      ? Math.max(0.35, 0.9 - missingInformation.length * 0.12)
      : 0.2;

    const firstSentence = input.text.split(/[.!?\n]/)[0]?.trim() ?? input.text.trim();

    return {
      extractedData: {
        changeDetected,
        suggestedTitle: firstSentence.slice(0, 120) || 'Possible change reported',
        changeDescription: input.text.trim(),
        location: null,
        requestedBy: input.senderName ?? null,
        affectedTrade,
        possibleCostImpact,
        possibleTimeImpact,
        noticeAssessmentRequired: changeDetected,
      },
      confidenceScore,
      sourceReferences: [`${input.sourceType}:original-message`],
      missingInformation,
      suggestedNextAction: changeDetected
        ? 'Raise a Potential Change and assess whether a notice is required'
        : 'Review manually — no clear change detected',
    };
  },

  async transcribeVoiceNote(input) {
    return {
      extractedData: {
        transcript: `[mock transcript of ${input.mimeType}, ${input.audio.byteLength} bytes]`,
        language: 'en',
      },
      confidenceScore: 0.5,
      sourceReferences: ['voice-note:original-audio'],
      missingInformation: ['Real transcription requires the Phase 2 provider'],
      suggestedNextAction: 'Review the transcript against the original audio',
    };
  },
};
