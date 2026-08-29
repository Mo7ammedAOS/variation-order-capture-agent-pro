# ADR 0001 — Background Job Engine

**Status:** PROPOSED — awaiting user confirmation. Nothing is built against this yet.
**Date:** 2026-08-29

## Context

CLAUDE.md requires a custom background-job engine for internal commercial logic, and
says explicitly: *"Choose one and document the decision."* The options it names are
BullMQ + Redis, Trigger.dev, and Inngest.

The engine must own:

```text
Notice deadline calculations
Notice deadline alerts
Task reminders
Bottleneck detection
Escalation logic
Client approval reminders
Approved-but-unbilled alerts
Payment overdue alerts
Weekly commercial report generation
Internal scheduled checks
```

Two constraints dominate:

1. **Per-client isolation.** Every deployment gets its own everything. A job engine
   that is a shared hosted service means either one shared account across clients
   (violates the deployment model) or one paid account per client (cost scales badly
   before there is revenue).
2. **Self-hosting is already in place.** There is a VPS running n8n behind Caddy.
   Adding Redis to that stack is incremental, not a new operational surface.

## Proposal

**BullMQ + Redis**, self-hosted per deployment.

## Rationale

```text
Isolation      One Redis per deployment. No shared control plane. No cross-client
               job visibility. Matches the deployment model exactly.
Cost           No per-deployment SaaS bill before the first client pays.
Ops            Redis alongside the existing Postgres and n8n on the same VPS.
Control        Deterministic, inspectable queues. No third party can see notice
               deadlines, VO values, or client names in a hosted dashboard.
Fit            Delayed jobs, repeatable cron jobs, retries with backoff, and
               priorities are all first-class. That covers every job listed above.
```

## Costs accepted

```text
No hosted dashboard. Needs Bull Board or equivalent, self-run.
Redis persistence must be configured and backed up, or delayed jobs are lost
  on restart. Notice deadlines are commercially material — this must not be skipped.
More setup than Inngest or Trigger.dev.
Jobs run in the app process or a sibling worker process; that process must be
  supervised and restarted.
```

## Alternatives

**Inngest** — best developer experience, durable steps, excellent observability.
Rejected as the default because it is a hosted control plane: client commercial
metadata would transit a third party, and per-client isolation means per-client
accounts. Reconsider if self-hosting Redis proves burdensome and a client accepts
the data-residency implication in writing.

**Trigger.dev** — self-hostable, which removes the residency objection, but it is a
heavier component than Redis and duplicates scheduling capability the stack already
has. Reconsider if long-running multi-step durable jobs become common.

## Explicitly not an option

**n8n as the job engine.** CLAUDE.md forbids it: *"Do not place core reminder logic
only inside n8n."* n8n delivers external reminders when the app instructs it to. It
does not decide when a reminder is due.

## Decision needed from the user

Confirm BullMQ + Redis, or name a different engine. Until confirmed, no job code is
written and no dependency is added.
