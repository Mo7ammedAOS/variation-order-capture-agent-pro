# Agents — the "A" in WAT

Agents are the AI reasoning layer. This directory holds their **specifications and
prompts**. Their implementations live under `/src/integrations/claude/` behind the
AI-provider abstraction.

```text
W — Workflows   /workflows/     documented SOPs, the source of truth for behaviour
A — Agents      /agents/        AI reasoning: extraction, drafting, summarising
T — Tools       /src/           deterministic services and integrations
```

## The rule that governs every file here

> **AI suggests.
> Humans approve.
> Custom application validates.
> n8n delivers integration actions.**

## AI may

```text
Read WhatsApp messages          Identify possible variations
Read emails                     Identify missing evidence
Transcribe voice notes          Suggest project assignment
Read PDFs                       Suggest affected trade
Read screenshots                Suggest possible cost/time risk
Read scanned documents          Suggest duplicate Potential Changes
Read drawings                   Draft Notice of Potential Claim
Extract drawing numbers         Draft Variation Proposal description
Extract document revisions      Draft client follow-up
Extract project references      Summarise bottlenecks
                                Prepare weekly risk reports
```

## AI must not

```text
Decide legal entitlement                Change Contract Sum automatically
Approve a VO                            Change invoice value automatically
Approve final QS pricing                Change payment status automatically
Send a contractual notice automatically Delete source evidence
Treat WhatsApp as final client          Delete audit logs
  approval automatically                Override permission rules
                                        Access another client deployment
```

This list is not negotiable per-agent. Every agent spec inherits it.

## Output contract

Every agent returns structured JSON. Never free text alone.

```json
{
  "extracted_data":        {},
  "confidence_score":      0.0,
  "source_references":     [],
  "missing_information":   [],
  "suggested_next_action": ""
}
```

Low confidence is a routing signal, not a failure. Below an agent's stated threshold
the output is held for human review instead of being surfaced as a suggestion.

## Evidence is immutable

AI output never overwrites the original source. The WhatsApp message, the email, the
photograph and the voice note are all preserved exactly as received. Agent output is
an *additional* record that links back to them.

## The agents

| Agent | Does |
|---|---|
| [capture-extraction](capture-extraction.agent.md) | Structured Potential Change out of a captured message |
| [voice-transcription](voice-transcription.agent.md) | Voice note to text, English and Arabic |
| [document-extraction](document-extraction.agent.md) | PDFs, screenshots, scans, drawings |
| [project-identification](project-identification.agent.md) | Which project does this belong to |
| [duplicate-detection](duplicate-detection.agent.md) | Has this change already been raised |
| [evidence-gap](evidence-gap.agent.md) | What proof is missing |
| [impact-assessment](impact-assessment.agent.md) | Possible cost impact, time impact, trades |
| [notice-drafting](notice-drafting.agent.md) | Draft Notice of Potential Claim |
| [vo-description-drafting](vo-description-drafting.agent.md) | Draft Variation Proposal scope |
| [client-followup-drafting](client-followup-drafting.agent.md) | Draft an approval chaser |
| [bottleneck-summary](bottleneck-summary.agent.md) | Narrative over computed bottlenecks |
| [weekly-risk-report](weekly-risk-report.agent.md) | Narrative sections of the weekly report |

All twelve are stubs. Every section reads "Not yet specified" — that is a stop sign.

## Prompts

`/agents/prompts/<slug>.prompt.md`, one per agent, version-controlled.

Prompts are **files, not string literals**. A prompt inline in a `.ts` file cannot be
reviewed, diffed, or rolled back, and this system drafts contractual notices.

## The line agents must not cross

An agent may say *"this looks like a variation, cost impact likely, confidence 0.86"*.

An agent may never say *"this is a variation worth AED 40,000, approved"*.

Anything that touches entitlement, value, approval, or status is a human decision that
the application validates and records. See CLAUDE.md.
