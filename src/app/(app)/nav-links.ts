/**
 * The menu, as data — and deliberately NOT in `nav.tsx`.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * `nav.tsx` is a client module. A server component may import from one, but
 * what it receives in a production build is a client-reference PROXY, not the
 * value: React needs a serialisable handle it can send to the browser, and a
 * plain array is not a component it knows how to proxy. So the server layout
 * imported `NAV_LINKS`, got an object with no `.map`, and every single page in
 * the application answered with a 500. It builds cleanly, typechecks cleanly,
 * and works in `next dev`. It fails only in a production build, which is to
 * say only in front of the people who use it.
 *
 * Plain data crossing the server/client boundary therefore lives in its own
 * module with no `'use client'` at the top, imported by both sides. The rule
 * to keep: a `'use client'` file exports COMPONENTS. Anything else a server
 * component needs to read belongs somewhere like this.
 *
 * ── What the order means ──────────────────────────────────────────────────
 * Ordered by how a working day starts: what needs me, then what is at risk,
 * then everything else. Directors and PMs open this on a laptop; site
 * engineers open it on a phone in a corridor.
 *
 * The first four belong to everybody — Osman's call, 2026-09-05. A site
 * engineer needs what is owed by him, what he reported, and what is stuck.
 * Everything below that is somebody's job and nobody else's, and a menu full
 * of doors that open onto a polite refusal teaches people that half the app is
 * not for them, after which they stop reading the half that is.
 *
 * Hiding is NOT the enforcement. Every gated page refuses on the server as
 * well. This decides what is worth showing and nothing about what is allowed.
 */
export interface NavLink {
  href: string;
  label: string;
  /** Null means everybody. Otherwise the capability that reveals it. */
  capability: string | null;
}

export const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview', capability: null },
  { href: '/my-tasks', label: 'My Tasks', capability: null },
  { href: '/variations', label: 'Variations', capability: null },
  { href: '/bottlenecks', label: 'Held Up', capability: null },
  // The triage queue for messages the system could not place. It is the
  // administrator's desk, not a shared inbox: it holds other people's
  // half-understood reports, and the answer to most of them is a question
  // somebody has to ask by hand.
  { href: '/inbox', label: 'Capture Inbox', capability: 'capture.triage' },
  { href: '/projects', label: 'Projects', capability: 'project.update' },
  { href: '/settings/company', label: 'Company', capability: 'companySettings.manage' },
  { href: '/settings/users', label: 'Users', capability: 'user.manage' },
  { href: '/settings/permissions', label: 'Permissions', capability: 'user.manage' },
];
