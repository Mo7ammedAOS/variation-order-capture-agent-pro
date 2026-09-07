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

## The material

Every surface is a pane of **frosted glass floating over a photographic
ground**. The ground is an image, not a colour, and it is fixed — it does not
scroll under a two-hundred-row register.

```text
Ground        /public/backgrounds/app-light.jpg    soft-focus abstract, warm
              /public/backgrounds/app-dark.jpg     the same plate, night
Sign-in       /public/backgrounds/auth-light.jpg   brushed aluminium macro
              /public/backgrounds/auth-dark.jpg    anodised metal, amber edge
Glass         --glass          ordinary panel
              --glass-strong   chrome with content scrolling under it
              --glass-soft     a recess inside a panel, not a second pane
```

**Sign-in has its own plate**, because the two screens have opposite jobs. The
dashboard is read all day and is dense with figures, so its ground has to
disappear; sign-in is one card for five seconds and is the only chance the
product gets to look like something. A macro that would be exhausting behind a
fifteen-column register is exactly right behind a password box.

It is swapped by `body:has([data-auth-screen])` in `globals.css`. The ground is
painted by `body::before`, and a custom property set on a descendant cannot
reach it — so `:has()` is what lets the body respond to what is inside it,
without a second backdrop layer downloading two images on every sign-in. A
browser without `:has()` falls back to the application plate, which degrades to
the previous design rather than to a broken one.

The **sign-in scrim darkens where the application's lightens**. Brushed
aluminium in daylight is already near-white, and whitening it further left the
white card with nothing to stand against — the whole screen read as one pale
rectangle. Dropping the ground a few percent gives the card its edge back.

Three details carry the whole material and none of them are optional: a 1px
**specular highlight** along the top of every panel (without it glass reads as
a translucent rectangle rather than a sheet catching light), a **grain layer**
over the ground (a perfectly smooth gradient betrays itself as a computer
image), and a **gradient scrim** between the two so the photograph stays
visible where the layout is empty and gets out of the way where the text is.

`backdrop-filter` is the expensive part — it forces the compositor to sample
everything behind the element. Panes are for **surfaces, not rows**: a register
is one pane containing a table, never forty panes. A `@supports not` block
falls back to solid surfaces so a browser without blur gets a plain interface
rather than an illegible one.

## Palette

```text
Brand      #FF7A1A → #FFB020   safety orange → hi-vis amber
Ground      photographic        light plate / dark plate
Text        near-black slate    inverted on the dark plate
```

Two colour vocabularies, and confusing them is the one unforgivable mistake.

**BRAND (amber).** Where you are and what you can press. It appears in exactly
three places — the active nav item, the primary button, and the capture FAB —
plus focus rings, gauges and chart bars. It carries no commercial meaning. It
is a gradient, and it is the only gradient fill in the product, which is what
makes the primary action findable on a screen of frosted panels. A fourth
decorative use dilutes all three.

**RISK (the RAG scale).** Green, amber, red, and **only** for risk. A red chip
means a contractual deadline is at stake. Using it decoratively teaches people
to ignore the one that matters. Chips carry an **icon as well as a colour**, so
they still read for the ~8% of men with a colour vision deficiency — on a site
product that is a lot of the actual users.

Because the brand is amber and the risk scale contains an amber, **the risk
amber was moved** to gold (hue ~90 rather than ~60) and desaturated. Side by
side they are plainly different: the brand is orange and glows, the warning is
flat gold. Tune either one and check it on `/variations`, the only screen where
both appear in the same row.

The same collision retired the **amber-outlined Cancel button**. Back, Cancel
and Submit are now ranked by *weight* — ghost, bordered, filled — which
survives a colour-blind reader and a monochrome print, which the amber version
never did.

## Light and dark

`next-themes`, `attribute="class"`, defaulting to **`system`**. Nobody on a site
opens Settings to pick a theme; a phone already in dark mode at seven in the
evening should get the dark plate unasked.

The toggle is **three-way** — light / system / dark. A two-way switch cannot
express "follow the device", so the moment someone touches it they are opted
out of their own phone's evening switch forever without being told.

Dark is **not an inversion**. It is a different photograph, a colder ground, and
glass that works by being *darker* than what is behind it — which is how real
smoked glass behaves, and why flipping the opacity of the light theme always
looks wrong. The brand lifts in lightness on the dark plate, because an orange
tuned for white goes muddy against charcoal.

## Layout

| Breakpoint | Navigation |
|---|---|
| `< md` | Sticky glass top bar + **floating** bottom bar (4 items) |
| `≥ md` | 256px **floating** glass rail, sticky, with its own scroll |

Both nav surfaces float — inset on all sides, with their own radius — rather
than being welded to the edge of the window. The gap is what lets the
photograph run behind them and makes the glass read as a sheet rather than as a
differently-coloured region of the page. On a notched phone the safe-area inset
is added to the bottom *offset*, not to the padding, so the bar keeps an even
gap beneath it instead of growing a chin.

**The `+ Report Change` button is the most reachable control in the app** — a
floating action button above the bottom bar on every screen. The whole product
depends on a change being filed in the minute it is noticed, not at the end of
the day when the detail has gone.

## Pages

| Route | Purpose |
|---|---|
| `/signin`, `/admin-signin` | Email + password, company branding, on the same photographic ground as the rest of the app — signing in should feel like opening a door, not crossing between two pieces of software. One error message for both failure modes. `/login` redirects to `/signin`. The theme toggle **is** here, above the card: this is the screen people see in the worst lighting they ever use the product in — a phone in direct sun on site, a laptop in a dark portacabin at six in the morning — and making somebody sign in first, at whatever brightness their OS chose, before they may turn the lights down is a small daily cruelty. It stores against the device rather than the account, which is right: the device is the thing with a screen |
| `/dashboard` | A hero stating the position in words, then three **readings**, then 17 stat cards **ordered by urgency**, then 4 charts |
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
palette to black on white.

**The photographic ground and every pane of glass are removed on paper.** A
backdrop image behind a variation register is a page of grey mush and an empty
toner cartridge, and a translucent surface prints as neither one colour nor the
other. `backdrop-filter`, the shadows and the specular edges are all switched
off, and the sticky table header goes back to `static` so it prints once at the
top of the table rather than floating over the first row.

The risk colours are the exception and deliberately survive: on this report red
means a contractual deadline has passed, and degrading that to grey removes the
one thing the reader is scanning for.

Rows, list items and sections carry `break-inside: avoid`, headings
`break-after: avoid-page`, and `<thead>` repeats on every page, so a register
running to several pages does not split a change across a fold or orphan a
heading at the foot of a page.


## Interaction

**Command palette — Cmd+K / Ctrl+K.** Search a PC number, a project, or jump to
a page. Results come from `/api/command`, which goes through `listProjects` and
`listPotentialChanges` and is therefore scoped to the caller: a Site Engineer
typing a PC number from a project they are not on gets nothing, exactly as if it
did not exist. A palette that held every project in memory would be a
cross-project leak wearing the costume of a feature.

It waits for two characters (one matches most of the register and returns noise),
debounces at 180ms, and aborts the in-flight request when you keep typing, so a
slow early response cannot land after a fast later one. Nothing is cached between
openings — the register changes all day, and a stale hit that opens a change
somebody already closed is worse than a slightly slower search.

The sidebar carries a search-shaped button printing `⌘K` beside itself, because
a shortcut nobody is told about is a shortcut for the person who built it. It
dispatches the same keystroke rather than lifting state, so the click path and
the keyboard path cannot drift apart.

**Register peek.** Clicking a row slides a read-only drawer in from the side;
clicking the PC number still navigates, because a link that does not navigate is
a small betrayal of the one thing links promise. There is also a focusable
preview button per row, so the peek is not mouse-only. Escape closes and focus
returns to the row you came from.

It fetches on open rather than being handed the whole register up front:
serialising every description and value into the page to save 200ms would be
paid on every load for a drawer most people open twice. It is deliberately
read-only, with one link to the real page — editing there would duplicate the
capability checks, the audit trail and the transition rules, and give them a
second place to drift.

**Motion** is feedback, not decoration: a 240ms rise on route change, a 150ms
rise on the palette, a 200ms slide on the drawer, a staggered 24ms cascade down
a list, and a one-shot draw on each dashboard reading. Nothing animates on a
data change.

**There is exactly one looping animation in the entire product** — `breathe`,
on a *breached* notice deadline, and nowhere else. A thing that moves forever
earns attention forever, so there may only be one, and it is spent on the
single state this product exists to prevent. It is slow (2.4s) because an
urgent flash is read once and then filtered out, while something moving quietly
at the edge of vision keeps being noticed. Add a second looping animation
anywhere and this one stops working.

`prefers-reduced-motion: reduce` turns all of it off centrally in
`globals.css`, and the entrance animations are named explicitly in that block —
otherwise `animation-fill-mode: both` would hold content at 8px and zero
opacity forever, which is worse than the animation.

## The readings

`src/components/domain/readings.tsx`. Instruments on the dashboard, above the
grid of counts, answering the three questions the company is run on.

| Reading | Shows | Source |
|---|---|---|
| `FunnelRail` | Agreed by the client → invoiced → received, with the unbilled and overdue gaps called out | `getCommercialPosition` |
| `GaugeRing` | Open changes whose notice clock is still safe | `getOverview().charts.byRisk` |
| `GaugeRing` | Days agreed of days claimed | `getCommercialPosition().time` |

Each stage of the funnel is measured against the **first** stage, not against
the one above it: the question is "what happened to what the client agreed",
and measuring each against its predecessor would make a company that has
invoiced nothing look 100% efficient at invoicing.

They are server components — CSS keyframes driven by inline custom properties,
so no JavaScript ships for a ring that draws itself once.

**There are deliberately no sparklines.** The obvious thing to put on a
dashboard like this is a trend line, and the services return a *position at a
moment*, not a series. A plausible-looking line drawn from a single data point
is a lie about the business, and on the screen where a director decides whether
to chase a client for 1.4M it is an expensive one. When a snapshot table
exists, the line belongs here. Until then it does not exist.

## Deliberately not built

From the interaction brief, with reasons rather than silence:

| Asked for | Why not, yet |
|---|---|
| Virtualised tables | The register is 20 rows and a busy project might reach a few hundred. Virtualisation at that scale costs Cmd+F, printing and text selection to solve a problem nobody has. Revisit past ~1,000 rows, which is a real threshold rather than a feeling |
| Drag-and-drop dashboards | Real cost, and it is nine cards. Per-user layout state, persistence and a migration path, so one director can move a card. Worth revisiting when there are several directors who disagree about the order |
| Voice-to-action capture | The AI provider is a mock — there is no transcription behind it. A voice button on a mock is theatre, and worse, it would look like it worked. It belongs with the real provider in Phase 2, where `MockAiProvider` already returns the right envelope for it |
| AI copilot panel | Same reason. A panel that surfaces "insights" from a fixture is a panel that lies confidently, which is the failure mode this product is least able to afford |
| Inline editing for high-volume entry | There is no data-entry persona here yet. Invoices, payments and variation orders are explicitly out of Phase 1, so the accountant this pattern serves has nothing to type into |
