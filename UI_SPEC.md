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

Every surface is a pane of glass floating over a **photograph of a real
finished fit-out** — the same room, shot in daylight and at night.

```text
Ground   /public/backgrounds/app-light.jpg   the office, day
         /public/backgrounds/app-dark.jpg    the same office, night
Glass    --glass          ordinary panel
         --glass-strong   chrome with content scrolling under it
         --glass-soft     a recess inside a panel, not a second pane
```

The room is a completed corporate office fit-out: glass partitions, oak desks,
acoustic rafts, polished concrete. The night plate was generated *from* the day
plate as a reference, so it is genuinely the same room — same desks, same
partitions, same planting, same rafts — lit only by its own linear lighting
with a night sky beyond the facade. Switching theme walks that office from
afternoon to evening. A dark
mode built by inverting colours looks like the light mode with the lights off;
this looks like a different time of day.

### Opaque panels, thin scrim

The pairing is the whole trick, and it is the opposite of the obvious move.

The instinct is to turn the scrim up until text is safe — which fogs the room
everywhere, including the empty space between panels where there is no text to
protect. Instead the **scrim is thin** (0.42 → 0.14) so the room reads in the
gaps, and the **panels stay opaque enough to read on** (0.78 light / 0.64 dark)
so the room stops at their edge. You see the room *around* the glass, not through it.

Those numbers are measured, not chosen. Sampling the light plate gives a 5th
percentile luminance of 0.044 — the shadowed floor under the desks. A panel
landing there at 0.78 holds secondary text at 5.82:1, and the night plate's
95th percentile — a lit ceiling raft — gives 5.67:1 at 0.64. Panel opacity was
lowered from 0.86/0.72 on request; the headroom above absorbed it, which is
why no other token had to move. **These values belong to this
photograph; re-measure if the plate is ever replaced.**

Three details carry the material: a 1px **specular highlight** along the top of
every panel, a **grain layer** over the ground, and the scrim between them.

`backdrop-filter` is the expensive part — see *Blur budget* below.

## Palette

```text
Brand      #C0FF00             lime — a FILL colour, never text on light
Ground      photographic        the same office, day / night
Text        near-black slate    inverted on the night plate
```

Two colour vocabularies, and confusing them is the one unforgivable mistake.

**BRAND (lime).** Where you are and what you can press: the active nav item,
the primary button, the capture FAB, focus rings, gauges and chart bars. It
carries no commercial meaning. It is the only gradient fill in the product,
which is what makes the primary action findable on a screen of glass.

**RISK (the RAG scale).** Green, amber, red, and **only** for risk. A red chip
means a contractual deadline is at stake. Chips carry an **icon as well as a
colour** for the ~8% of men with a colour vision deficiency — on a site product
that is a lot of the actual users.

### Lime has two consequences, and both are handled

**1. Lime is a fill, never a text colour on light.** `#C0FF00` is oklch
lightness **0.923** — as text on a light panel it measures **1.04:1**. Not
"poor": invisible. So the token is split:

| token | use | light | dark |
|---|---|---|---|
| `--brand`, `--brand-gradient` | fills, always with dark ink on top | `#C0FF00` family | same |
| `--primary` | every PC number, project code and link | deep olive-lime, **4.78:1** | `#C0FF00`, **11.75:1** |
| `--ring` | focus | mid lime | bright lime |

`text-primary` appears in about twenty places. If you ever set a text colour to
`var(--brand)` it will disappear in light mode.

**2. The risk scale moved out of lime's way.** Lime sits at hue **126** —
between the old warning gold (90) and low-risk green (152), so the brand pill
and the "Served" chip read as cousins. Warning has gone back to a **true amber**
(hue 70) and low risk to a **deep teal-green** (hue 175), leaving gaps of 56°
and 49°. This is the one gift of dropping orange: orange had occupied the amber
slot, which is why warning was pushed to gold in the first place.

Every risk colour is solved to clear **4.5:1 on the worst panel** — light red
4.54, amber 4.52, green 4.54.

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

```text
┌─ top bar ─────────────────────────────────────────────┐   floating pill
┌ rail ┐  ┌─ stage ───────────────────────────────────┐     the page lives
│ icons│  │  the page                                 │     inside one pane
└──────┘  └───────────────────────────────────────────┘
           ┌─ projects ─┐                                  floating pill
```

Four floating surfaces over a photograph of a finished fit-out, with real gaps
between them so the room shows through. **Nothing is welded to an edge of the
window** — that gap is the whole difference between "glass panels in a room"
and "a website with a background image".

| Breakpoint | Navigation |
|---|---|
| `< md` | Sticky glass top bar + floating bottom bar (4 items) |
| `≥ md` | 68px floating **icon rail** + floating project switcher |

**The rail is icons only.** A 256px labelled column was a quarter of a laptop
screen spent on nine words that never change, in a product whose real content
is a register with more columns than fit. The cost — an icon nav is slower to
learn — is paid three ways: every item keeps its `aria-label`, every item shows
a CSS tooltip on hover, and the page it opens states its own name in a heading.

**The bottom bar is navigation, not a filter.** Each pill opens that project's
page. It deliberately does *not* scope the rest of the app: a switcher that
silently filtered every screen would be new application state with its own
persistence, its own effect on every query, and its own way of lying to
somebody who forgot which job was selected when they read a total. The
registers here are deliberately cross-project — a director's overdue figure
means nothing if it quietly excludes eleven of their jobs. Pills show the
project **code**, because that is what people say out loud and type into
search. Scoped through `scopeProjectsToUser`, capped at twelve.

### What was removed

The labelled sidebar, the company-name block, the sidebar search box, the
user-name-and-role block, the labelled sign-out button, the sign-in marketing
panel, and the dashboard's greeting (the top bar already says it — twice on one
screen makes the second look like a bug). Their jobs moved: navigation to the
rail, search into the top bar where it is now the widest control on screen,
identity to the avatar, sign-out to the foot of the rail.

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

**The page-title scale is a class, `.page-title`, not a pasted value.** It was
an arbitrary `text-[1.6rem] font-extrabold leading-tight tracking-[-0.035em]`
duplicated across twelve files — a string that agreed with itself twelve times
and would stop agreeing the first time anyone adjusted one.

**Filters live in the URL.** A filtered register is a link. "Look at these four
overdue ones" is far more useful to send than a screenshot.

**The detail page leads with the four questions** the product exists to answer:
who owns it, what is next, when is the deadline, what are we waiting for. The
description is below them.

**Duplicates are suggestions.** Similarity score shown, no merge button, no
action attached. AI suggests; humans approve.

**The UI never computes a commercial number.** Every figure comes from a service
that has been tested. If a number is wrong, it is wrong in one place.

**The register's table header does not stick.** It was written as
`sticky top-0` and could never have worked: the wrapper sets `overflow-x: auto`,
which per spec forces `overflow-y` to `auto` as well, so the wrapper is a scroll
container in both axes — and with no height constraint it never scrolls
vertically, leaving `sticky` nothing to resolve against. The page scrolls, the
container does not. Making it genuinely stick means either a fixed-height
scroll region or abandoning horizontal scroll; both are larger decisions than a
header and neither is worth making silently.

**Focus rings are `outline` with `outline-offset`, never `ring-offset`.**
`ring-offset` paints a solid band in the offset colour, and these controls sit
on translucent glass over a photograph, so that band was an opaque rectangle
matching nothing behind it. An outline offset leaves the gap transparent.

**Tabular figures** on every number that appears in a column, so digits align.

**44px minimum touch target** under `(pointer: coarse)`. Gloves, sunlight, one
hand.

## Contrast on glass

**Glass makes contrast a function of the photograph.** This is the trap in the
whole style and it has to be designed against, not assumed away.

Measured through a light-theme panel over three regions of the plate:

| | secondary text before | after |
|---|---|---|
| bright region of the plate | 4.57:1 | 5.15:1 |
| mid region | 4.25:1 | 4.89:1 |
| darker region | **3.92:1 — fails AA** | 4.59:1 |

Two changes fixed it: light `--glass` went from `0.62` to `0.72` (which lifts
the floor *and* flattens the variance, so a label's contrast no longer depends
on where its panel landed), and `--muted-foreground` was re-solved against the
**worst case** rather than against an imaginary white background.

**The rule for anything added later:** a colour on glass is checked against the
darkest region of the plate, never against `#fff`. Hint text in this product is
12px, so the threshold is 4.5:1, not 3:1.

## The glass material

A panel is not "a translucent rectangle". Three features carry it, and they are
all at the EDGE rather than across the face:

```text
--glass-sheen   diagonal light wash          light only  (see below)
--glass-rim     bright inset top-left,       both themes
                soft dark inset bottom-right
--glass-specular  1px highlight along the top  both themes
```

**Dark mode has no face sheen, and that is measured rather than taste.** A
white wash across a dark panel lifts the corner it peaks in — which is exactly
where a card's title sits. At 13% the corner reaches `rgb(68,71,77)` and
secondary text falls to 3.8:1; at 18% it is 3.2:1 and the risk red drops to
2.7:1. There is no opacity at which a face sheen on this ground is both visible
and safe. Dark therefore gets its glassiness from the rim, the specular line
and a heavier blur — 1px features that never sit under text, so they cost
nothing in contrast. That is also closer to how dark glass behaves in life: you
see the polished edge catch light, not the face.

## Why the chips are opaque

Chip backgrounds are **solid**, not a tint of the panel — and that single change
is what bought the transparency everywhere else.

While they were translucent, a chip's contrast was a function of whatever panel
it happened to sit on, so the risk red was the one value pinning every surface
in the product at its opacity. Giving chips their own opaque ground decouples
them: red measures 5.21:1 on its own background no matter how see-through the
card beneath becomes.

| surface | light | dark |
|---|---|---|
| `--glass-stage` | 0.58 | **0.26** |
| `--glass` (card) | **0.68** | **0.44** |
| `--glass-strong` (tile) | **0.78** | **0.58** |

Dark gained far more than light, and that asymmetry is inherent: light mode
puts *dark* text on a *light* translucent panel over the *darkest* pixel of the
day plate, which is the hardest combination in the product. Dark mode puts
light text on a dark panel and has room to spare.

**Verified through the whole stack** — plate → scrim → stage → card → tile —
not against a flat colour. Worst cases: light card 5.65:1 muted, dark card
5.67:1; light tile 6.08:1, dark tile 6.06:1.

## The select picker

The open list of a native `<select>` is drawn by the operating system. `option`
cannot be styled and `accent-color` does not reach it — which is why a product
with a lime accent was showing a macOS-blue highlight, and why "just style the
dropdown" always fails.

`appearance: base-select` hands the picker back to CSS, and it is used here as
a **progressive enhancement**:

| | |
|---|---|
| Chrome/Edge 135+ | glass panel, lime selection, animated chevron |
| Safari, Firefox | exactly the native picker that shipped before |

The element stays a real `<select>`. That was the deciding factor over
replacing all 24 of them with a scripted listbox: it keeps form semantics, its
`name` in `FormData`, keyboard behaviour, `onChange` on the five controlled
ones — and the native full-height wheel on a phone, which works in gloves and
which nothing hand-written would beat.

Zero call sites changed.

## Stage vs cards

```text
.panel-stage   0.58 light / 0.38 dark    the container — look THROUGH it
.panel         0.78 light / 0.64 dark    a card ON it
.panel-flat    0.88 light / 0.80 dark    a grid tile, no blur
```

**The container is far more transparent than the cards, and the hierarchy is
the point.** The stage is a sheet you look through at the room; the cards are
the solid things sitting on it. A stage as opaque as its cards is just a slab
covering the photograph.

It is affordable because of what the stage actually carries — a page title, a
few section headings and one line of muted text — which measures 4.75:1 dark
and 4.68:1 light over the worst pixel of each plate. Cards stacked on top come
out *safer* than before, not riskier: a card at 0.64 over a 0.38 stage measures
6.17:1.

**Panel opacity is at its floor.** Both themes were pushed until the RISK
colours became the binding constraint — light red 4.54:1, dark red 4.55:1. Any
further transparency breaks a red chip, and a red chip is the load-bearing
element of this product. If more transparency is ever wanted, it has to come
from the stage or the scrim, not from the cards.

## Blur budget

`backdrop-filter` makes the compositor re-sample everything behind an element.
The overview renders eighteen stat tiles plus three readings plus four charts —
twenty-five sampled regions on one scrolling page, which is exactly what the
note on `.panel` warns against, committed by the page that warns about it.

**Grid items are flat (`.panel-flat`); surfaces and chrome are glass.** The
escape is that the ground is a *soft-focus* photograph: there is almost no
high-frequency detail for a blur to remove, so at tile size a slightly more
opaque flat surface is visually near-identical and costs nothing. Over a
detailed photograph this trade would not hold.

Set it with `<Card blur={false}>`.

## Loading and 404

Every page in `(app)` is `force-dynamic` against hosted Postgres, and there was
no `loading.tsx` anywhere — so Next had no boundary to suspend at and the
browser sat on the *previous* page, nothing moving, until the query returned.
`(app)/loading.tsx` is a skeleton in the shape of the overview; adding the file
is the whole fix.

It uses no looping animation. The product has exactly one, on a breached notice
deadline, and spending a second on a spinner would devalue the only one that
costs money when it is missed.

`not-found.tsx` is deliberately vague about *why* a page is missing. The same
page answers "you typed it wrong", "the record was closed" and "you cannot see
that project" — and `notFound()` is what a permission check throws when it
refuses to confirm a record exists. Naming the reason would leak the record's
existence to somebody not allowed to know it. Note that for a signed-out
visitor, middleware redirects unknown paths to `/signin` before this page is
reached; it serves the in-app `notFound()` cases.

## Arabic / RTL

Structure only in Phase 1, not a translation.

- `dir` on `<html>`, driven by locale.
- **Transforms too, not just spacing.** The sidebar's hover nudge was
  `translate-x`, which is physical — in Arabic the one piece of motion in the
  nav ran backwards, pushing each item away from its own label. It now carries
  an `rtl:` counterpart.
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

**Navigation highlights optimistically.** Every nav item used to decide it was
active by comparing its href to `usePathname()` — a value that changes when the
new page has *rendered*, not when you tapped. With every page `force-dynamic`
against hosted Postgres, that left several hundred milliseconds where the thing
you pressed looked untouched and the thing you were leaving was still lit.
People tap twice.

`nav-progress.tsx` holds the intended destination the moment it is pressed, and
the rail, the phone bar, the More sheet and the project switcher all highlight
against `pending ?? pathname`. Measured: the tapped item is lit and the top bar
is running at **ms 0**, while `location.pathname` is still the previous page.

The progress bar deliberately reports **no progress** — it eases to 90% and
waits. Nothing here can measure a server render, and a bar claiming 40% of a
request it cannot see is a lie everyone has learned to read as decoration.

**Motion** is feedback, not decoration: a 200ms rise-and-scale on route change, a 150ms
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
