/**
 * Reading a project out of what somebody wrote.
 *
 * A site engineer does not write "project_code=DXB-001". He writes "the client
 * at Marina Heights wants the reception wall moved", or "DXB001 - extra
 * sockets", or he names the client and nothing else. This module is the part
 * that understands that, and it is deliberately dumb, pure and testable: no
 * model, no network, no database. A model may be wrong in interesting ways; a
 * project attribution has to be wrong in boring ways or not at all.
 *
 * ── What it will and will not do ───────────────────────────────────────────
 * It reports EVERY project the text could be naming, and it never picks one.
 * Picking is the caller's job, and the caller only picks when the answer is
 * unique AND the person who wrote it has confirmed. This is not timidity: a
 * Potential Change filed against the wrong job looks handled, so nobody ever
 * checks it again, and the entitlement dies quietly. A question costs a minute.
 *
 * ── Why matching is on code and client, not project name ───────────────────
 * Project names are mostly generic words. "Dubai Office Fit-Out" reduced to its
 * distinctive parts is nothing at all, and a matcher that fired on OFFICE would
 * fire on every message ever sent. Codes are unique by construction, and a
 * client name carries at least one word nobody else on the job uses. A project
 * name is used only when it has a word that survives the generic filter.
 */

export interface MatchableProject {
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
}

export type MatchBasis = 'code' | 'client' | 'name';

export interface ProjectMatch {
  projectId: string;
  /** What in the text gave it away. Shown to the person we ask to confirm. */
  matchedOn: MatchBasis;
  matchedText: string;
}

/**
 * Words that identify nobody.
 *
 * Legal forms, the emirates, and the vocabulary every construction company in
 * the country shares. Stripping them is what stops "Al Futtaim Contracting LLC"
 * from matching a message that merely contains the word "contracting".
 */
const GENERIC_TOKENS = new Set([
  // Legal forms
  'LLC', 'FZE', 'FZC', 'FZCO', 'DMCC', 'WLL', 'PJSC', 'PSC', 'LLP', 'LTD', 'INC',
  'LIMITED', 'EST', 'ESTABLISHMENT', 'SARL', 'PLC',
  // Corporate filler
  'CO', 'COMPANY', 'GROUP', 'HOLDING', 'HOLDINGS', 'TRADING', 'ENTERPRISE',
  'ENTERPRISES', 'INTERNATIONAL', 'GENERAL', 'SERVICES', 'SOLUTIONS', 'PARTNERS',
  // The trade's own vocabulary
  'PROJECT', 'PROJECTS', 'CONTRACTING', 'CONTRACTORS', 'CONTRACTOR', 'CONSTRUCTION',
  'DEVELOPMENT', 'DEVELOPMENTS', 'PROPERTIES', 'PROPERTY', 'REAL', 'ESTATE',
  'INVESTMENT', 'INVESTMENTS', 'ENGINEERING', 'INTERIORS', 'INTERIOR', 'FITOUT',
  'FIT', 'OUT', 'WORKS', 'BUILDING', 'OFFICE', 'OFFICES', 'RETAIL', 'RESIDENTIAL',
  'COMMERCIAL', 'REFURBISHMENT', 'RENOVATION',
  // Geography, which narrows nothing here
  'UAE', 'EMIRATES', 'DUBAI', 'ABU', 'DHABI', 'SHARJAH', 'AJMAN', 'FUJAIRAH',
  // Grammar
  'THE', 'AND', 'OF', 'FOR', 'AT',
]);

/** Below this length a token is an initial or a preposition, not a name. */
const MIN_TOKEN_LENGTH = 3;

/** Uppercase, with every run of punctuation reduced to one space. */
function normalise(text: string): string {
  return ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
}

function distinctiveTokens(name: string): string[] {
  return normalise(name)
    .trim()
    .split(' ')
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !GENERIC_TOKENS.has(token));
}

/**
 * A project code, however it was typed.
 *
 * Exported because answering "which project?" needs exactly the same tolerance
 * as reading a project out of a report. Somebody replying `dxb004` to a list
 * that said `DXB-004` has answered the question, and a matcher strict enough to
 * miss that turns a settled conversation into a parked message.
 *
 * `DXB-001` has to be found in "DXB001", "dxb 001" and "DXB - 001", because all
 * three get typed on a phone. The separator is allowed to be anything up to
 * three characters wide, and the ends are anchored so `DXB-001` does not match
 * inside `DXB-0012`.
 */
export function codePattern(projectCode: string): RegExp {
  const runs = projectCode.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (runs.length === 0) return /(?!)/;
  const body = runs.map(runPattern).join('[^A-Z0-9]{0,3}');
  return new RegExp(`(?<![A-Z0-9])${body}(?![A-Z0-9])`);
}

/**
 * One run of a code, with the leading zeros made optional.
 *
 * `DXB-002` gets written `dxb2` far more often than `DXB-002`, because the
 * zeros are padding a database chose and not something anybody says out loud.
 * A purely numeric run therefore matches on its VALUE: `002` is found in "2",
 * "02", "002" and "0002" alike.
 *
 * It stays unambiguous. `DXB-001` still does not match inside `DXB-0012` —
 * the trailing boundary in `codePattern` rejects every way the engine can
 * split those digits. And where two projects genuinely collapse to the same
 * value, both match, the answer stops being unique, and the caller asks
 * instead of choosing. Ambiguity resolves to a question, never to a guess.
 */
function runPattern(run: string): string {
  if (!/^[0-9]+$/.test(run)) return escapeRegExp(run);
  const value = run.replace(/^0+/, '');
  return value === '' ? '0+' : `0*${value}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when every distinctive word of `name` appears in the text as a word. */
function namePresent(normalisedText: string, name: string): boolean {
  const tokens = distinctiveTokens(name);
  if (tokens.length === 0) return false;
  return tokens.every((token) => normalisedText.includes(` ${token} `));
}

/** How long the leading word of a client name must be to stand on its own. */
const LEAD_TOKEN_LENGTH = 4;

/**
 * True when the text names this client.
 *
 * Looser than `namePresent`, because nobody writes out a client's registered
 * name. "Miral Asset Management" is written "Miral"; "Aldar Properties PJSC"
 * is written "Aldar". The leading distinctive word is the identifying one — it
 * is how the company is spoken about — so it stands alone provided it is long
 * enough not to be an abbreviation.
 *
 * Being looser is affordable here and nowhere else: a client match only ever
 * produces a QUESTION, quoted with the reason it was asked ("you named the
 * client, Miral Asset Management"). Being wrong costs the reporter a "no". The
 * strict rule stays on project names, which are made of ordinary words and
 * would fire on half the inbox.
 */
function clientPresent(normalisedText: string, clientName: string): boolean {
  const tokens = distinctiveTokens(clientName);
  if (tokens.length === 0) return false;
  if (tokens.every((token) => normalisedText.includes(` ${token} `))) return true;

  const lead = tokens[0];
  return (
    lead !== undefined &&
    lead.length >= LEAD_TOKEN_LENGTH &&
    normalisedText.includes(` ${lead} `)
  );
}

/**
 * Every project the text could be naming, strongest signal first.
 *
 * A project appears at most once: a message that quotes both the code and the
 * client is one match on the code, not two, because the caller counts matches
 * to decide whether the answer is unique.
 */
export function matchProjectsInText(
  text: string,
  projects: MatchableProject[],
): ProjectMatch[] {
  if (!text.trim()) return [];

  const upper = text.toUpperCase();
  const normalised = normalise(text);
  const matches = new Map<string, ProjectMatch>();

  // Codes first, and never overwritten: a code is an identifier, a name is a
  // resemblance.
  for (const project of projects) {
    if (codePattern(project.projectCode).test(upper)) {
      matches.set(project.id, {
        projectId: project.id,
        matchedOn: 'code',
        matchedText: project.projectCode,
      });
    }
  }

  for (const project of projects) {
    if (matches.has(project.id)) continue;
    if (clientPresent(normalised, project.clientName)) {
      matches.set(project.id, {
        projectId: project.id,
        matchedOn: 'client',
        matchedText: project.clientName,
      });
    }
  }

  for (const project of projects) {
    if (matches.has(project.id)) continue;
    if (namePresent(normalised, project.projectName)) {
      matches.set(project.id, {
        projectId: project.id,
        matchedOn: 'name',
        matchedText: project.projectName,
      });
    }
  }

  // Last, and only for what is still unmatched: a single word that belongs to
  // exactly one of HIS projects. See `uniqueTokenOwners`.
  const owners = uniqueTokenOwners(projects);
  for (const [token, projectId] of owners) {
    if (matches.has(projectId)) continue;
    if (!normalised.includes(` ${token} `)) continue;
    const project = projects.find((p) => p.id === projectId);
    if (!project) continue;
    matches.set(projectId, {
      projectId,
      matchedOn: 'name',
      matchedText: project.projectName,
    });
  }

  const order: Record<MatchBasis, number> = { code: 0, client: 1, name: 2 };
  return [...matches.values()].sort((a, b) => order[a.matchedOn] - order[b.matchedOn]);
}

/** A word has to be this long to identify a project on its own. */
const UNIQUE_TOKEN_LENGTH = 4;

/**
 * Words that belong to exactly one project in the set, and so name it alone.
 *
 * "Dubai Mall Level 3 Fit-Out" is called "Dubai Mall", or "the mall", or "dxb
 * mall". The strict rule above needs EVERY distinctive word of the project
 * name to be present, so it reads none of those — and a matcher that cannot
 * read the name people actually use is a matcher that asks "which project?"
 * to a man who just told you.
 *
 * Loosening it safely turns on one idea: **distinctiveness is relative to his
 * own project list, not to the language.** MALL is a common word, but if only
 * one of the four jobs he is on has MALL in its name, then MALL identifies it
 * exactly. If two do, the word owns nothing, it is dropped here, and the
 * caller is left with an ambiguity it will resolve by asking — which is the
 * correct outcome, because at that point the message really is ambiguous.
 *
 * Both the project name and the client name feed this, because "the Emaar
 * one" and "the mall one" are the same kind of shorthand.
 */
function uniqueTokenOwners(projects: MatchableProject[]): Map<string, string> {
  const seen = new Map<string, string[]>();

  for (const project of projects) {
    const tokens = new Set([
      ...distinctiveTokens(project.projectName),
      ...distinctiveTokens(project.clientName),
    ]);
    for (const token of tokens) {
      if (token.length < UNIQUE_TOKEN_LENGTH) continue;
      const holders = seen.get(token) ?? [];
      if (!holders.includes(project.id)) holders.push(project.id);
      seen.set(token, holders);
    }
  }

  const owners = new Map<string, string>();
  for (const [token, holders] of seen) {
    // Shared by two projects is shared by none. A word that cannot separate
    // them must not be allowed to pick one.
    if (holders.length === 1 && holders[0]) owners.set(token, holders[0]);
  }
  return owners;
}

/** How the match is described back to the person, in the confirmation. */
export function describeMatch(match: ProjectMatch): string {
  switch (match.matchedOn) {
    case 'code':
      return `you wrote ${match.matchedText}`;
    case 'client':
      return `you named the client, ${match.matchedText}`;
    case 'name':
      return `you named the project, ${match.matchedText}`;
  }
}
