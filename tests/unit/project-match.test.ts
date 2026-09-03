import { describe, expect, it } from 'vitest';
import { matchProjectsInText, type MatchableProject } from '@/lib/project-match';

/**
 * Reading the project out of the message.
 *
 * The two failures that matter are opposite and unequal. Missing a match costs
 * a question. Inventing one files a change against the wrong job, where it
 * looks handled and nobody looks again. So the tests below spend most of their
 * time proving the matcher stays quiet.
 */

const PROJECTS: MatchableProject[] = [
  { id: 'a', projectCode: 'DXB-001', projectName: 'Dubai Office Fit-Out', clientName: 'Emaar Properties' },
  { id: 'b', projectCode: 'DXB-002', projectName: 'Marina Heights Lobby', clientName: 'Al Futtaim Contracting LLC' },
  { id: 'c', projectCode: 'AUH-014', projectName: 'Corniche Retail Fit-Out', clientName: 'Aldar Properties PJSC' },
];

const ids = (text: string) => matchProjectsInText(text, PROJECTS).map((m) => m.projectId);

describe('finding a project code', () => {
  it('finds it written exactly', () => {
    expect(ids('DXB-001 reception wall moved')).toEqual(['a']);
  });

  it('finds it however it was typed on a phone', () => {
    expect(ids('dxb001 extra sockets')).toEqual(['a']);
    expect(ids('dxb 001 extra sockets')).toEqual(['a']);
    expect(ids('DXB - 001 extra sockets')).toEqual(['a']);
  });

  it('does not match a longer code that merely starts the same', () => {
    // DXB-0012 is a different job. Prefix matching would file against the wrong
    // one and look right doing it.
    expect(ids('DXB-0012 needs a riser')).toEqual([]);
  });

  it('does not find a code split across unrelated words', () => {
    expect(ids('DXB is where we are, and there are 001 of them')).toEqual([]);
  });
});

describe('finding a client', () => {
  it('matches on the client name', () => {
    expect(ids('Emaar want the marble changed')).toEqual(['a']);
  });

  it('ignores the legal form and the filler around it', () => {
    // "Al Futtaim Contracting LLC" is matched by "Al Futtaim" alone.
    expect(ids('Al Futtaim asked for another door')).toEqual(['b']);
  });

  it('does NOT match on a word every firm on the job shares', () => {
    // The danger case: "contracting" and "properties" identify nobody, and a
    // matcher that fired on them would fire on nearly every message sent.
    expect(ids('the contracting team want this priced')).toEqual([]);
    expect(ids('properties have asked for a revision')).toEqual([]);
    expect(ids('the client wants the wall moved')).toEqual([]);
  });

  it('does not match a client on a partial word', () => {
    expect(ids('Emaarat is not our client')).toEqual([]);
  });

  it('matches the leading word alone, because that is how clients are spoken about', () => {
    const projects: MatchableProject[] = [
      { id: 'x', projectCode: 'AUH-020', projectName: 'Yas Mall Unit 12', clientName: 'Miral Asset Management' },
    ];
    // Nobody writes "Miral Asset Management" in a WhatsApp.
    expect(matchProjectsInText('Miral asked for another door', projects).map((m) => m.projectId))
      .toEqual(['x']);
  });

  it('does not let a short leading word stand alone', () => {
    const projects: MatchableProject[] = [
      { id: 'y', projectCode: 'DXB-050', projectName: 'Downtown Unit 4', clientName: 'NBD Bank Holdings' },
    ];
    // NBD on its own is an abbreviation, and abbreviations collide.
    expect(matchProjectsInText('the NBD line item is wrong', projects)).toEqual([]);
    // Written in full it is unmistakable.
    expect(matchProjectsInText('NBD Bank want it repriced', projects).map((m) => m.projectId))
      .toEqual(['y']);
  });
});

describe('when it cannot be sure', () => {
  it('returns every project the text could mean, and picks none', () => {
    const both = ids('Emaar and Aldar both want the same detail');
    expect(both).toHaveLength(2);
    expect(both).toContain('a');
    expect(both).toContain('c');
  });

  it('returns nothing for a message that names no project', () => {
    expect(ids('client wants the reception wall moved 400mm, please advise')).toEqual([]);
  });

  it('returns nothing for an empty message', () => {
    expect(ids('   ')).toEqual([]);
  });
});

describe('ranking and de-duplication', () => {
  it('counts a project once even when the code and the client are both named', () => {
    const matches = matchProjectsInText('DXB-001 for Emaar Properties', PROJECTS);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedOn).toBe('code');
  });

  it('puts the code match ahead of a name match', () => {
    const matches = matchProjectsInText('AUH-014 and something at Marina Heights', PROJECTS);
    expect(matches[0]?.matchedOn).toBe('code');
    expect(matches[0]?.projectId).toBe('c');
  });

  it('matches a project name when it has a word of its own', () => {
    expect(ids('the Marina Heights lobby ceiling is wrong')).toEqual(['b']);
  });

  it('does not match a project name made only of generic words', () => {
    // "Dubai Office Fit-Out" survives the generic filter as nothing at all.
    expect(ids('the office fit out is behind')).toEqual([]);
  });
});

describe('the code as it actually gets typed', () => {
  // A site engineer writes what he says out loud. The zeros are padding a
  // database chose, not part of the name of the job.
  const PROJECTS = [
    { id: 'p1', projectCode: 'DXB-002', projectName: 'Dubai Mall Level 3 Fit-Out', clientName: 'Emaar Malls' },
    { id: 'p2', projectCode: 'AUH-014', projectName: 'Yas Marina Clubhouse', clientName: 'Miral Asset Management' },
  ];

  it('reads the zeros as optional', () => {
    for (const written of ['dxb2', 'DXB 2', 'dxb-2', 'dxb02', 'dxb002', 'DXB-002', 'dxb0002']) {
      expect(matchProjectsInText(`${written} wall moved`, PROJECTS)[0]?.projectId).toBe('p1');
    }
  });

  it('does not let a shorter code swallow a longer one', () => {
    // DXB-002 must not be found inside DXB-0021. The boundary has to survive
    // every way the engine can split those digits.
    expect(matchProjectsInText('DXB-0021 wall moved', PROJECTS)).toHaveLength(0);
  });

  it('reads a word that belongs to only one of his jobs', () => {
    // "Dubai Mall Level 3 Fit-Out" is called the mall. Requiring every
    // distinctive word of the registered name is how a matcher fails to read
    // the name people actually use.
    expect(matchProjectsInText('the mall job, wall moved', PROJECTS)[0]?.projectId).toBe('p1');
    expect(matchProjectsInText('dxb mall', PROJECTS)[0]?.projectId).toBe('p1');
    expect(matchProjectsInText('dubai mall', PROJECTS)[0]?.projectId).toBe('p1');
    expect(matchProjectsInText('at the clubhouse', PROJECTS)[0]?.projectId).toBe('p2');
  });

  it('will not identify a job on a three letter word', () => {
    // "YAS" names it to a person and is still too short to be safe here: at
    // three characters the odds of an unrelated message containing it stop
    // being negligible, and the generic list cannot enumerate every short
    // word in the trade. Four characters is the floor.
    expect(matchProjectsInText('at yas', PROJECTS)).toHaveLength(0);
  });

  it('drops a word two of his jobs share', () => {
    // MARINA owns nothing here, so it picks nothing. The ambiguity survives
    // to the caller, which resolves it by asking — the correct outcome,
    // because at that point the message really is ambiguous.
    const shared = [
      { id: 'p1', projectCode: 'DXB-002', projectName: 'Marina Heights Lobby', clientName: 'Emaar' },
      { id: 'p2', projectCode: 'DXB-003', projectName: 'Marina Walk Retail', clientName: 'Nakheel' },
    ];
    expect(matchProjectsInText('the marina one', shared)).toHaveLength(0);
  });

  it('still prefers a code over a resemblance', () => {
    const matches = matchProjectsInText('AUH-014 near the mall', PROJECTS);
    expect(matches[0]?.matchedOn).toBe('code');
    expect(matches[0]?.projectId).toBe('p2');
  });
});
