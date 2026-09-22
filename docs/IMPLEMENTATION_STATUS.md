# Implementation Status

**Live at https://vo.osmanflow.com.** Last updated 23 September 2026, build
`4b68c76`.

## Gates

```text
npm run lint        PASS
npm run typecheck   PASS
npm test            PASS — 733 unit tests, 48 files
npm run build       PASS
migrations          35 applied, including 20260922100000_pm_notice_decision
deployment          LIVE — valid certificate, HSTS, project scoping verified
```

## What changed on 23 September 2026 — the dashboard

Twenty-six cards, two gauges, a funnel and four charts became **four figures
and one action table**. Every figure was true and the screen still failed:
twenty-six numbers of equal size ask the reader to decide which matter, which
is the job the dashboard existed to do.

- Four KPI cards: pending change value, approved-not-invoiced, work started
  without approval, overdue client decisions. Each with a count under the money.
- One **Needs Action Today** table in place of sixteen attention cards. Every
  row carries the next action, the owner, the value and the date. Filters and
  sort live in the URL.
- A six-stage customer-facing pipeline, and a project table sorted by
  unapproved work first.
- Everything removed is on **`/reports`** (Commercial Reports), computed by the
  same services. Nothing was recalculated, so the two screens cannot disagree.
- The dashboard **adapts by capability, never by job title**. A site engineer
  gets no money cards, and `/reports` refuses him on the server.
- "Badly held up" and "Held Up" both became **Blocked changes**, with a Next
  action column.

Metric definitions are centralised and pure in `src/lib/dashboard-metrics.ts`,
proved by 48 tests with no database. `getOverview` is untouched, so
`/api/dashboard/overview` answers exactly as before.

## What changed on 22 September 2026

The PM reviews a change and decides the notice on one screen, and **QS pricing
starts at that moment** instead of waiting for a gate. The notice runs on its
own track beside the commercial chain.

- The two-seat gate on the notice is **gone**. The PM drafts, reads and sends it.
- The **managing director holds no approval seat**. The PM is the only internal
  approver of the final priced variation. The MD still gets late-work escalations.
- **Approving the variation is sending it**: raise, render, file, queue, submit,
  in one act.
- `pm_scope_review` and `notice_required` are **retired**. Nothing enters them;
  rows that stopped there still read and still have a way forward.
- Eleven internal statuses now show as **seven** in the interface.

Nothing was deleted. Every enum value, capability and historical approval
stands, and a change an MD approved goes on showing that.

Five commits: `ffc6835` the decision and parallel pricing · `d46352e` preview
then send · `dce6522` the MD out of the seats · `d631c1b` approval sends the VO ·
`d1ece7e` seven statuses and the notice tiles.

## Not built

| | |
|---|---|
| WhatsApp media | No download step in the capture lane. Photos and voice notes do not arrive |
| Arabic PDFs | No Arabic font embedded in the PDF writer |
| Escalation levels | `escalation.service.ts` is a stub. Reminders and chasing are real |
| Employer forms / Aconex | None |
| Programme link | Days are recorded; affected activities are not |
| Weekly report lane | Mapped in n8n, not built |
| Outbound WhatsApp | Lane active, no gateway configured. Email unaffected |

## Fields with no screen

Retention 5% · payment terms 30 days · retention release 50% · defects liability
365 days · VAT 5% · logo, brand colours, default language · template names ·
approval, reminder and escalation rule JSON. A developer has to change these.

## Next

1. **Walk `TEST-PLAN.md` on production.** Nothing since 12 September has been
   used by a person on the live system.
2. **The WhatsApp media lane.** It gates more of the product than its size
   suggests, and it idles a transcription vendor that is already billed.
3. **UAE hosting**, if a government or developer client is in scope.
