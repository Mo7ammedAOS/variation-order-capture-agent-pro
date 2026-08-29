/**
 * ai-processing.worker.ts
 *
 * Runs agent extraction over newly captured evidence.
 *
 * STATUS: stub. Not implemented.
 * Job engine is UNDECIDED — see docs/decisions/0001-background-job-engine.md.
 * Do not add a queue dependency until that ADR is ACCEPTED.
 *
 * This worker owns COMMERCIAL LOGIC and therefore lives here, not in n8n.
 * CLAUDE.md: "Do not place core reminder logic only inside n8n."
 *
 * The pattern is always:
 *   worker decides   ->   app records the decision + audit event
 *                    ->   app asks n8n to deliver externally
 *                    ->   n8n reports delivery result back to the app
 *
 * An external delivery failure must never change business truth.
 */

export {};
