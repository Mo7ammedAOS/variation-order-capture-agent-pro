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
  /**
   * The phone bar's label.
   *
   * It used to be derived as `label.split(' ')[0]`, which turned "My Tasks"
   * into "My" and "Held Up" into "Held" — the first of those means nothing at
   * all. Deriving a label from another label is a guess that is wrong as soon
   * as a name starts with a small word, so each one is now stated.
   */
  short: string;
  /** Null means everybody. Otherwise the capability that reveals it. */
  capability: string | null;
}

export const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview', short: 'Overview', capability: null },
  { href: '/my-tasks', label: 'My Tasks', short: 'Tasks', capability: null },
  { href: '/variations', label: 'Variations', short: 'Changes', capability: null },
  { href: '/bottlenecks', label: 'Held Up', short: 'Held Up', capability: null },
  // The Capture Inbox is deliberately NOT here. Osman's call, 2026-09-13: the
  // screen listed every message that arrived and read as noise beside the work
  // it was supposed to support. The route still exists at `/inbox` and still
  // files a parked message, so nothing captured is lost and nothing was
  // deleted — it simply is not in the navigation. Put this line back to
  // restore it.
  //
  // WHAT THIS COSTS, stated because it is not obvious: a message the system
  // could not place is now visible on no screen anybody opens. The cases are
  // an unknown sender, a number shared by two people, a sender on no active
  // project, somebody naming a job they are not assigned to, and a question
  // that went unanswered. Each one is a variation report that exists in the
  // database and that nobody will see.
  { href: '/projects', label: 'Projects', short: 'Projects', capability: 'project.update' },
  { href: '/settings/company', label: 'Company', short: 'Company', capability: 'companySettings.manage' },
  { href: '/settings/users', label: 'Users', short: 'Users', capability: 'user.manage' },
  { href: '/settings/permissions', label: 'Permissions', short: 'Access', capability: 'user.manage' },
];
