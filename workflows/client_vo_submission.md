# Client VO Submission

> **Status:** specified and built, 2026-09-01.

## Workflow Name

Client VO Submission

## Business Objective

Turn a change the company has agreed internally into a priced variation put to
the client, and record what they said back. Without this step a change that two
directors approved is worth nothing: the client has never been asked.

## Trigger

A Potential Change reaches `variation_approved` — both seats on the
`final_variation` gate approved the price. A person then raises the VO.

Not automatic. Raising it is a commercial act with a date on it, and a system
that raised VOs by itself would put figures to clients on days nobody chose.

## Inputs

| From | What |
|---|---|
| The change | title, description, `submittedValue` (frozen at pricing), `timeImpactDays` |
| The person | the date it was actually sent, our reference, days claimed |
| The client, later | their answer, the date of it, the figure they agreed, their reference |

## User Roles

Quantity Surveyor, Commercial Manager, Contract Administrator, Project Manager.
Directors by system role.

## Permissions Required

`variationOrder.manage`.

## Custom App Services Used

`src/services/variation-order.service.ts` — `raiseVariationOrder`,
`recordSubmission`, `recordClientResponse`, `withdrawVariationOrder`.

## n8n Workflow Used

None yet. Sending the VO is done outside the system and the date recorded here.
When lane D carries it, the same rule as the notice applies: a delivery result
is the only thing that may say it was sent.

## AI Use

None. `vo-description-drafting.agent.md` may one day draft the covering
description; it may never set, adjust or interpret a figure.

## Human Approval Gates

The `final_variation` gate, upstream. Two seats, before the VO can exist at
all. There is no second gate here: submitting what two directors already
approved is administration, not a new decision.

## Step-by-Step Logic

1. Refuse unless the change is `variation_approved`.
2. Increment `projects.vo_sequence` atomically; format `VO-{CODE}-{0000}`.
3. Copy `submittedValue` from the change ONCE. Never recompute it from the
   line items, which anyone may still edit.
4. On submission: set `submitted`, store the date the person gives, start the
   client response clock from THAT date, not from today.
5. On the client's answer:
   - **Agreed in full** → `approved`, `approvedValue` = the submitted figure.
     Deliberately not a number from the form: otherwise "approved" could
     quietly mean any amount.
   - **Agreed lower** → `part_approved`, `approvedValue` = their figure, and
     the difference stays visible as conceded.
   - **Agreed higher** → refused. Check the figure or resubmit, so the paper
     trail matches.
   - **Rejected** → `rejected`, reason required.
6. On agreement, raise an invoicing task on the finance seat.

## Database Changes

`variation_orders` row. `projects.vo_sequence` incremented. A `tasks` row and
its notifications on agreement.

## Notifications

`task_assigned` to the finance seat when the client agrees. Nothing goes to the
client from here.

## Error Handling

Every refusal is a 4xx with a sentence a person can act on. Nothing external is
called, so there is no external failure that could change business truth.

## Retry Logic

None needed. `raiseVariationOrder` is idempotent through the unique index on
`potential_change_id`: a double click produces one VO.

## Audit Events

`variation_order / created`, `/ submitted`, `/ approved`, `/ rejected`,
`/ updated` on withdrawal. The approval event records submitted, approved and
the shortfall together, so the concession is legible years later.

## Edge Cases

- **Two clicks on Raise** — one VO. Unique index.
- **A VO with no value** — refused at submission. Price it first.
- **Withdrawing something already invoiced** — refused. Cancel the applications
  or raise a credit; withdrawing would orphan real money.
- **A response dated in the future** — refused.

## Definition of Done

One VO per approved change, its number stable, its submitted figure frozen, the
client's answer recorded with a date and a reference, and any shortfall
countable across the project.
