# UI Specification

Not a generic admin dashboard. A commercial-control dashboard that a PM, QS,
Commercial Manager and Managing Director would each recognise as theirs.

## Who is holding the device

- **Site engineer** — a phone, one hand, outdoors, thirty seconds. Files a
  change and attaches a photo.
- **QS / PM** — a laptop, a register with fifteen columns, filtering all day.
- **Director** — ten seconds on a dashboard, wants the overdue figure first.

The same screens serve all three, which is why the register is a table on
desktop and cards on a phone rather than a table that scrolls sideways.

## Palette

```text
Background   near-white          Green   low risk / complete
Text         dark navy           Amber   warning / pending
Primary      blue                Red     overdue / critical
```

Defined as tokens in `src/app/globals.css`, in `oklch`, with a dark variant.

**RAG colours are reserved for risk.** A red chip means a commercial deadline is
at risk. Using red decoratively teaches people to ignore the one that matters.
Chips carry an **icon as well as a colour**, so they still read for the ~8% of
men with a colour vision deficiency — on a site product that is a lot of users.

## Layout

| Breakpoint | Navigation |
|---|---|
| `< md` | Top bar + fixed bottom bar (5 items) |
| `≥ md` | 256px sidebar |

**The `+ Report Change` button is the most reachable control in the app** — a
floating action button above the bottom bar on every screen. The whole product
depends on a change being filed in the minute it is noticed, not at the end of
the day when the detail has gone.

## Pages

| Route | Purpose |
|---|---|
| `/login` | Email + password, company branding. One error message for both failure modes |
| `/dashboard` | 9 stat cards **ordered by urgency**, 4 charts |
| `/my-tasks` | Overdue → due today → upcoming |
| `/projects` | Table on desktop, cards on phone |
| `/projects/[id]` | 8 tabs as links, so a tab is shareable and Back works |
| `/projects/[id]/report` | The variation register report. A document, not a dashboard — printed before a progress meeting or sent to a consultant. Ordered by notice deadline rather than PC number, because sorted by number it is a filing system and sorted by deadline it is a list of what to deal with. Printing is the browser's own dialog, so "Save as PDF" gives a real PDF with selectable text and no server-side renderer to break on the VPS |
| `/variations` | The register. 15 columns, 4 filters, card view on phone |
| `/variations/[id]` | Owner / next action / deadline / waiting **first** |
| `/report-change` | Mobile-first capture, required fields only, rest behind a disclosure |
| `/bottlenecks` | What is blocked, who by, how long, value at risk |
| `/settings/users` | Invite, set company role, deactivate |

## Decisions

**Urgency ordering on the dashboard.** Overdue notices, then due-in-7-days, then
overdue tasks, then critical bottlenecks — before the totals. Someone scanning
for ten seconds should land on what is already wrong.

**Filters live in the URL.** A filtered register is a link. "Look at these four
overdue ones" is far more useful to send than a screenshot.

**The detail page leads with the four questions** the product exists to answer:
who owns it, what is next, when is the deadline, what are we waiting for. The
description is below them.

**Duplicates are suggestions.** Similarity score shown, no merge button, no
action attached. AI suggests; humans approve.

**The UI never computes a commercial number.** Every figure comes from a service
that has been tested. If a number is wrong, it is wrong in one place.

**Tabular figures** on every number that appears in a column, so digits align.

**44px minimum touch target** under `(pointer: coarse)`. Gloves, sunlight, one
hand.

## Arabic / RTL

Structure only in Phase 1, not a translation.

- `dir` on `<html>`, driven by locale.
- **Logical properties everywhere** — `ms-`/`me-`/`ps-`/`pe-`, `start`/`end`.
  Never `ml-`/`mr-`/`left`/`right`. This is the part that is expensive to
  retrofit, so it is done now.
- `users.preferred_language` and `company_settings.default_language` exist and
  are seeded.

Phase 2 adds the message catalogue and Arabic copy.

## Accessibility

Semantic landmarks, `aria-current` on active nav, `role="alert"` on form errors,
labels tied to every input, visible focus rings, icons `aria-hidden` beside real
text. Wide tables scroll inside their own container — the page body never
scrolls horizontally.


## Printing

The app chrome carries `print:hidden` — sidebar, mobile header, bottom nav and
the capture button — and `globals.css` has a `@media print` block that swaps the
palette to black on white. The screen ground is light grey with navy text, which
on a laser printer is a grey wash across every page for no benefit.

The risk colours are the exception and deliberately survive: on this report red
means a contractual deadline has passed, and degrading that to grey removes the
one thing the reader is scanning for.

Rows, list items and sections carry `break-inside: avoid`, headings
`break-after: avoid-page`, and `<thead>` repeats on every page, so a register
running to several pages does not split a change across a fold or orphan a
heading at the foot of a page.
