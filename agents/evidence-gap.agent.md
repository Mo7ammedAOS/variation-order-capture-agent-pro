# Evidence Gap

> **Status:** stub — not yet specified.
> Every section below is mandatory before this agent is built.
> Do not implement against an unspecified section; ask instead.

## Agent Name

Evidence Gap

## Purpose

Identify what evidence is missing before a change can be noticed, priced or submitted: instruction, drawing, photo, labour record, specification.

## Trigger / Called By

_Not yet specified. Name the `/workflows/*.md` SOP and the service that invokes it._

## Model

_Not yet specified. Set through the AI-provider abstraction in `/src/integrations/claude/`,
never a hardcoded model string at the call site._

## Inputs

_Not yet specified._

## Output Schema

_Not yet specified._

Every agent in this system returns structured JSON carrying, at minimum:

```text
extracted_data          what the agent read out of the source
confidence_score        0.0 - 1.0
source_references       which evidence each field came from
missing_information     what the agent could not find
suggested_next_action   what a human should do next
```

Free text is never an agent's only output.

## Confidence Handling

_Not yet specified. State the threshold below which the output is held for human
review rather than surfaced as a suggestion, and who reviews it._

## What This Agent May Decide

_Not yet specified. This list is always short._

## What This Agent Must Never Decide

_Not yet specified. Inherits the global prohibitions in CLAUDE.md without exception:
legal entitlement, VO approval, final QS pricing, automatic notice sending, Contract Sum,
invoice value, payment status, deletion of evidence or audit logs, permission overrides,
and any access to another client deployment._

## Human Approval Gate

_Not yet specified. Name the role that approves, and what they see before approving._

## Prompt Location

`/agents/prompts/evidence-gap.prompt.md` — not yet written.

Prompts are version-controlled files, never inline string literals in application code.

## Evidence Handling

_Not yet specified. AI output must never overwrite or replace the original source
evidence. State where the original is stored and how the output links back to it._

## Failure Behaviour

_Not yet specified. State what happens on a model error, a timeout, a refusal, or
unparseable output. An AI failure must never change business truth._

## Audit Events

_Not yet specified. At minimum: AI suggestion generated, AI suggestion edited,
AI suggestion accepted, AI suggestion rejected._

## Edge Cases

_Not yet specified. Consider at least: Arabic input, mixed Arabic/English, poor
photographs, forwarded messages, multiple changes in one message, and a message
that turns out to contain no change at all._

## Definition of Done

_Not yet specified. Must satisfy the global Definition of Done in CLAUDE.md._
