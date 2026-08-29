import { getEnv } from '@/lib/env';
import type { AiProvider } from '@/integrations/claude/provider';
import { mockAiProvider } from '@/integrations/claude/mock-provider';

export * from '@/integrations/claude/provider';

export function getAiProvider(): AiProvider {
  if (getEnv().AI_PROVIDER === 'claude') {
    // Phase 2. The envelope, the confidence gate and the audit events are all
    // already in place, so this is one adapter and not a redesign.
    throw new Error('The Claude AI provider is not implemented until Phase 2');
  }
  return mockAiProvider;
}
