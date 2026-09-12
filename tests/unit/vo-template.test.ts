import { describe, expect, it } from 'vitest';
import { renderVariationOrder, type VoFacts } from '@/lib/vo-template';

/**
 * The client-ready variation order.
 *
 * The tests that matter here are about what the document must NOT do: claim
 * time inside a cost figure, present a site note as a considered scope
 * statement, or hide which rates were invented.
 */

const base: VoFacts = {
  companyName: 'ABC Fit-Out LLC',
  projectCode: 'DXB-001',
  projectName: 'DIFC Gate Avenue Office Fit-Out',
  contractNumber: 'C-2026-114',
  clientName: 'Gate Avenue Developments',
  recipientName: 'Mr Khalid',
  recipientCompany: 'Gate Avenue Developments',
  clauseReference: '13.3',

  voNumber: 'VO-DXB-001-0007',
  pcNumber: 'PC-DXB-001-0012',
  title: 'Reception marble wall',
  description: 'Consultant asked for marble instead of the painted finish.',
  scopeOriginal: 'Painted gypsum wall to reception, as bill item 4.12.',
  scopeRevised: 'Book-matched marble cladding to the same wall.',

  eventDate: new Date('2026-08-14T00:00:00Z'),
  documentDate: new Date('2026-09-12T00:00:00Z'),
  location: 'Reception, Level 2',
  trade: 'Joinery',
  instructedBy: 'Eng. Samir, supervision consultant',
  instructionSource: 'Site instruction',

  lineItems: [
    {
      description: 'Marble cladding, supply and fix',
      quantity: '48.000',
      unit: 'm2',
      rate: '420.00',
      amount: '20160.00',
      rateSource: 'star_rate',
      boqReference: null,
    },
    {
      description: 'Remove painted finish',
      quantity: '48.000',
      unit: 'm2',
      rate: '15.00',
      amount: '720.00',
      rateSource: 'contract_boq',
      boqReference: '4.12',
    },
  ],
  net: '20880.00',
  prelims: '1044.00',
  prelimsPercent: '5',
  overheadProfit: '2192.40',
  overheadProfitPercent: '10',
  total: '24116.40',
  currency: 'AED',

  timeImpactDaysClaimed: null,
  timeImpactBasis: null,
};

describe('the subject line', () => {
  it('names the VO, the project and the change, in that order', () => {
    expect(renderVariationOrder(base).subject).toBe(
      'Variation order VO-DXB-001-0007 - DXB-001 DIFC Gate Avenue Office Fit-Out - Reception marble wall',
    );
  });
});

describe('scope', () => {
  it('sets the two scopes against each other when both are stated', () => {
    const { body } = renderVariationOrder(base);
    expect(body).toContain('ORIGINAL SCOPE');
    expect(body).toContain('Painted gypsum wall to reception, as bill item 4.12.');
    expect(body).toContain('REVISED SCOPE');
    expect(body).toContain('Book-matched marble cladding to the same wall.');
  });

  it('falls back to the report, and SAYS it is the report', () => {
    // A site note presented under a "Revised scope" heading would be the
    // document claiming more care than was taken.
    const { body } = renderVariationOrder({ ...base, scopeRevised: null, scopeOriginal: null });
    expect(body).toContain('THE CHANGE, AS REPORTED');
    expect(body).toContain('Consultant asked for marble instead of the painted finish.');
    expect(body).not.toContain('REVISED SCOPE');
  });

  it('still states the original as unstated when only the revised is filled in', () => {
    const { body } = renderVariationOrder({ ...base, scopeOriginal: null });
    expect(body).toContain('ORIGINAL SCOPE');
    expect(body).toContain('Not stated.');
  });
});

describe('the build-up', () => {
  it('shows the basis of every rate', () => {
    const { body } = renderVariationOrder(base);
    expect(body).toContain('basis: star rate');
    expect(body).toContain('basis: contract boq, bill ref 4.12');
  });

  it('formats money with thousands separators and two decimals', () => {
    const { body } = renderVariationOrder(base);
    expect(body).toContain('AED 20,160.00');
    expect(body).toContain('AED 24,116.40');
  });

  it('names the percentages when they are known', () => {
    const { body } = renderVariationOrder(base);
    expect(body).toContain('Preliminaries at 5%');
    expect(body).toContain('Overhead and profit at 10%');
  });

  it('says so rather than printing an empty table when nothing is priced', () => {
    const { body } = renderVariationOrder({ ...base, lineItems: [] });
    expect(body).toContain('No line items have been priced.');
  });
});

describe('time', () => {
  it('says nothing about time when no days are claimed', () => {
    expect(renderVariationOrder(base).body).not.toContain('EFFECT ON TIME');
  });

  it('states time as a separate claim, outside the figure', () => {
    const { body } = renderVariationOrder({
      ...base,
      timeImpactDaysClaimed: 6,
      timeImpactBasis: 'Marble lead time from the approved supplier.',
    });
    expect(body).toContain('EFFECT ON TIME');
    expect(body).toContain('6 days');
    expect(body).toContain('Marble lead time from the approved supplier.');
    // The sentence that stops an assessor rejecting cost and time together.
    expect(body).toContain('claimed separately from the cost above');
  });

  it('uses the singular for one day', () => {
    const { body } = renderVariationOrder({ ...base, timeImpactDaysClaimed: 1 });
    expect(body).toContain('by 1 day.');
  });
});

describe('house style', () => {
  it('uses no em dashes or smart quotes, which mangle in old mail clients', () => {
    const { body, subject } = renderVariationOrder(base);
    for (const text of [body, subject]) {
      expect(text).not.toMatch(/[–—‘’“”]/);
    }
  });

  it('cites the contract clause when the project has one', () => {
    expect(renderVariationOrder(base).body).toContain('pursuant to clause 13.3 of the Contract');
  });

  it('still reads correctly with no clause reference', () => {
    const { body } = renderVariationOrder({ ...base, clauseReference: null });
    expect(body).toContain('submitted pursuant to the Contract');
    expect(body).not.toContain('clause null');
  });

  it('addresses Sirs when no recipient is named', () => {
    expect(renderVariationOrder({ ...base, recipientName: null }).body).toContain('Dear Sirs,');
  });
});
