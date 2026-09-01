import { getEnv } from '@/lib/env';
import type { AiProvider } from '@/integrations/claude/provider';
import type { AgentEnvelope, CapturedChangeExtraction } from '@/integrations/claude/provider';
import { mockAiProvider } from '@/integrations/claude/mock-provider';
import { claudeAiProvider } from '@/integrations/claude/claude-provider';

export * from '@/integrations/claude/provider';

export function getAiProvider(): AiProvider {
  if (getEnv().AI_PROVIDER === 'claude') return claudeAiProvider;
  return mockAiProvider;
}

/**
 * The real provider, with the deterministic one behind it.
 *
 * ── Why extraction is allowed to fail ──────────────────────────────────────
 * A captured message becoming a Potential Change must not depend on a third
 * party being up. Anthropic having a bad afternoon, an expired key, a rate
 * limit, a safety classifier declining a message about a fire door — none of
 * those may lose a site engineer's report, because the report is the thing
 * this product exists to not lose.
 *
 * So a failure falls back to the keyword extractor. The change is created
 * either way, with the same PC number, the same notice deadline and the same
 * owner. What differs is the quality of the title and the missing-information
 * list, and the fallback records WHICH reader produced it — a suggestion
 * attributed to a model that never ran would be a lie in the audit trail.
 */
export async function extractWithFallback(input: {
  text: string;
  sourceType: string;
  senderName?: string | null;
}): Promise<{ envelope: AgentEnvelope<CapturedChangeExtraction>; provider: string; degraded: boolean }> {
  const provider = getAiProvider();

  try {
    return { envelope: await provider.extractPotentialChange(input), provider: provider.name, degraded: false };
  } catch (error) {
    if (provider.name === 'mock') throw error;

    // Logged rather than swallowed. A silent fallback would mean the AI could
    // be down for a week with nothing to show it, and every extraction
    // quietly worse than the one before.
    console.error('[claude] extraction failed, falling back to the keyword reader:', error);

    const envelope = await mockAiProvider.extractPotentialChange(input);
    return {
      envelope: {
        ...envelope,
        missingInformation: [
          ...envelope.missingInformation,
          'Read by the fallback keyword extractor, not by Claude. Check the title.',
        ],
      },
      provider: `${mockAiProvider.name} (fallback)`,
      degraded: true,
    };
  }
}
