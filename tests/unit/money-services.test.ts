import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rules that stop agreed money going missing.
 *
 * Each of these is a way the register could look right and be wrong: a
 * variation invoiced before the client agreed it, a shortfall quietly written
 * off, an invoice marked paid because somebody ticked a box, a receipt larger
 * than the invoice absorbed without comment. All four are the kind of error
 * that is only discovered during a payment dispute, which is the worst possible
 * time to discover it.
 */

const state = {
  vo: null as Record<string, unknown> | null,
  invoice: null as Record<string, unknown> | null,
  company: { vatPercent: '5' } as Record<string, unknown> | null,
  voUpdates: [] as Record<string, unknown>[],
  invoicesCreated: [] as Record<string, unknown>[],
  invoiceUpdates: [] as Record<string, unknown>[],
  paymentsCreated: [] as Record<string, unknown>[],
  tasksCreated: [] as Record<string, unknown>[],
  creditNote: null as Record<string, unknown> | null,
  creditNotesCreated: [] as Record<string, unknown>[],
  creditNoteUpdates: [] as Record<string, unknown>[],
  access: true,
};

vi.mock('server-only', () => ({}));
vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => ({}) }));
vi.mock('@/services/project-access.service', () => ({
  assertProjectAccess: async () => {
    if (!state.access) throw new Error('Forbidden');
  },
  scopeToUser: async () => ({}),
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async () => [],
  recordTaskNotifications: async () => 0,
  recordDirectNotifications: async () => 0,
  dispatchNow: async () => undefined,
  dispatchPendingNotifications: async () => ({ queued: 0, sent: 0, failed: 0 }),
}));

const prismaMock = {
  variationOrder: {
    findUnique: async () => state.vo,
    findFirst: async () => state.vo,
    findMany: async () => (state.vo ? [state.vo] : []),
    create: async (args: Record<string, unknown>) => ({ id: 'vo-1', voNumber: 'VO-DXB-001-0001', ...args }),
    update: async (args: Record<string, unknown>) => {
      state.voUpdates.push(args);
      return { ...(state.vo ?? {}), ...(args.data as Record<string, unknown>) };
    },
  },
  invoice: {
    // Reflects payments created during this call, the way the database would.
    // Without that, `refreshInvoiceStatus` re-reads an invoice that has not
    // heard about the receipt just written and always concludes "issued".
    findUnique: async () => {
      if (!state.invoice) return null;
      const existing = (state.invoice.payments as { amount: unknown }[]) ?? [];
      const added = state.paymentsCreated.map((args) => ({
        amount: (args.data as Record<string, unknown>).amount,
      }));
      return { ...state.invoice, payments: [...existing, ...added] };
    },
    findMany: async () => (state.invoice ? [state.invoice] : []),
    create: async (args: Record<string, unknown>) => {
      state.invoicesCreated.push(args);
      return { id: 'inv-1', invoiceNumber: 'INV-DXB-001-0001', totalDue: { toString: () => '0' }, ...args };
    },
    update: async (args: Record<string, unknown>) => {
      state.invoiceUpdates.push(args);
      return { ...(state.invoice ?? {}), ...(args.data as Record<string, unknown>) };
    },
  },
  payment: {
    create: async (args: Record<string, unknown>) => {
      state.paymentsCreated.push(args);
      return { id: 'pay-1', ...args };
    },
    delete: async () => ({}),
    findUnique: async () => null,
    findMany: async () => [],
  },
  creditNote: {
    findUnique: async () => state.creditNote,
    findMany: async () => (state.creditNote ? [state.creditNote] : []),
    create: async (args: Record<string, unknown>) => {
      state.creditNotesCreated.push(args);
      return {
        id: 'cn-1',
        creditNoteNumber: 'CN-DXB-001-0001',
        totalCredited: decimal('0'),
        ...(args.data as Record<string, unknown>),
      };
    },
    update: async (args: Record<string, unknown>) => {
      state.creditNoteUpdates.push(args);
      return { ...(state.creditNote ?? {}), ...(args.data as Record<string, unknown>) };
    },
  },
  potentialChange: { findUnique: async () => null },
  companySettings: { findFirst: async () => state.company },
  projectMember: { findFirst: async () => ({ userId: 'fin-1' }) },
  task: {
    create: async (args: Record<string, unknown>) => {
      state.tasksCreated.push(args);
      return { id: 'task-1' };
    },
  },
  $queryRaw: async () => [{ vo_sequence: 1, invoice_sequence: 1, credit_note_sequence: 1 }],
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const { recordClientResponse, voSubmissionSchema } = await import(
  '@/services/variation-order.service'
);
const { draftApplication } = await import('@/services/invoice.service');
const { recordPayment } = await import('@/services/payment.service');
const { draftRetentionRelease, retentionOn } = await import('@/services/invoice.service');
const { draftCreditNote } = await import('@/services/credit-note.service');

const USER = { id: 'qs-1', fullName: 'Aisha', systemRole: 'commercial_manager' } as never;
const VO_ID = '33333333-3333-4333-8333-333333333333';
const INV_ID = '44444444-4444-4444-8444-444444444444';

function decimal(value: string) {
  return { toString: () => value };
}

function submittedVo(overrides: Record<string, unknown> = {}) {
  return {
    id: VO_ID,
    projectId: 'proj-1',
    potentialChangeId: 'pc-1',
    voNumber: 'VO-DXB-001-0001',
    status: 'submitted',
    clientResponse: 'awaiting',
    title: 'Reception marble wall',
    submittedValue: decimal('120000.00'),
    approvedValue: null,
    clientReference: null,
    timeImpactDaysClaimed: null,
    potentialChange: { id: 'pc-1', pcNumber: 'PC-DXB-001-0042', title: 'Reception marble wall' },
    project: { id: 'proj-1', projectCode: 'DXB-001', contractRules: { retentionPercent: decimal('5'), paymentTermsDays: 30 } },
    invoices: [],
    ...overrides,
  };
}

const YESTERDAY = new Date(Date.now() - 86_400_000);

beforeEach(() => {
  state.vo = submittedVo();
  state.invoice = null;
  state.company = { vatPercent: decimal('5') };
  state.voUpdates = [];
  state.invoicesCreated = [];
  state.invoiceUpdates = [];
  state.paymentsCreated = [];
  state.creditNote = null;
  state.creditNotesCreated = [];
  state.creditNoteUpdates = [];
  state.tasksCreated = [];
  state.access = true;
});

describe('what the client agreed', () => {
  it('agreeing in full means the figure we submitted, not one typed in', () => {
    // If this took a number from the form, "approved" could quietly mean any
    // amount at all, and the audit trail would agree with it.
    return recordClientResponse(USER, {
      variationOrderId: VO_ID,
      response: 'approved',
      respondedOn: YESTERDAY,
      approvedValue: '999.00',
    } as never).then(() => {
      const update = state.voUpdates.at(0)?.data as Record<string, unknown>;
      expect(update.status).toBe('approved');
      expect(String(update.approvedValue)).toContain('120000');
    });
  });

  it('keeps the shortfall when they agree less, rather than overwriting', async () => {
    await recordClientResponse(USER, {
      variationOrderId: VO_ID,
      response: 'approved_with_adjustment',
      respondedOn: YESTERDAY,
      approvedValue: '95000.00',
    } as never);

    const update = state.voUpdates.at(0)?.data as Record<string, unknown>;
    expect(update.status).toBe('part_approved');
    // The submitted figure is not among the fields being written, so 120,000
    // survives and the 25,000 stays countable.
    expect(update).not.toHaveProperty('submittedValue');
  });

  it('refuses an adjustment with no figure', async () => {
    await expect(
      recordClientResponse(USER, {
        variationOrderId: VO_ID,
        response: 'approved_with_adjustment',
        respondedOn: YESTERDAY,
      } as never),
    ).rejects.toThrow();
  });

  it('refuses a rejection with no reason', async () => {
    await expect(
      recordClientResponse(USER, {
        variationOrderId: VO_ID,
        response: 'rejected',
        respondedOn: YESTERDAY,
      } as never),
    ).rejects.toThrow();
  });

  it('queries the figure when the client agrees MORE than was submitted', async () => {
    await expect(
      recordClientResponse(USER, {
        variationOrderId: VO_ID,
        response: 'approved_with_adjustment',
        respondedOn: YESTERDAY,
        approvedValue: '150000.00',
      } as never),
    ).rejects.toThrow(/agreed MORE/);
  });

  it('puts the invoicing on somebody the moment it is agreed', async () => {
    await recordClientResponse(USER, {
      variationOrderId: VO_ID,
      response: 'approved',
      respondedOn: YESTERDAY,
    } as never);

    // This is the step that gets forgotten: the commercial team has moved on
    // and nobody in finance knows it is theirs yet.
    expect(state.tasksCreated).toHaveLength(1);
    expect(state.tasksCreated[0]?.data).toMatchObject({ assignedToUserId: 'fin-1' });
  });
});

describe('applying for money', () => {
  it('refuses to invoice a variation the client has not agreed', async () => {
    state.vo = submittedVo({ status: 'submitted' });

    await expect(
      draftApplication(USER, {
        variationOrderId: VO_ID,
        periodEnd: YESTERDAY,
        cumulativePercent: 50,
      } as never),
    ).rejects.toThrow(/has agreed/);
  });

  it('computes the whole application from one percentage', async () => {
    state.vo = submittedVo({ status: 'approved', approvedValue: decimal('120000.00') });

    await draftApplication(USER, {
      variationOrderId: VO_ID,
      periodEnd: YESTERDAY,
      cumulativePercent: 40,
    } as never);

    const created = state.invoicesCreated.at(0)?.data as Record<string, unknown>;
    expect(String(created.grossThisPeriod)).toContain('48000');
    expect(String(created.retentionAmount)).toContain('2400');
    expect(String(created.netValue)).toContain('45600');
    expect(String(created.totalDue)).toContain('47880');
    // Frozen onto the row, so the arithmetic can be reproduced later even if
    // the VO or an earlier application changes.
    expect(String(created.basisValue)).toContain('120000');
    expect(String(created.previouslyApplied)).toContain('0');
  });

  it('excludes a cancelled application from the running total', async () => {
    // Leaving it in would suppress every later application by that amount,
    // silently, and nobody would ever work out why the last one is short.
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [
        { id: 'a', status: 'issued', kind: 'application', grossThisPeriod: decimal('48000.00'), cumulativePercent: decimal('40'), creditNotes: [] },
        { id: 'b', status: 'cancelled', kind: 'application', grossThisPeriod: decimal('30000.00'), cumulativePercent: decimal('65'), creditNotes: [] },
      ],
    });

    await draftApplication(USER, {
      variationOrderId: VO_ID,
      periodEnd: YESTERDAY,
      cumulativePercent: 75,
    } as never);

    const created = state.invoicesCreated.at(0)?.data as Record<string, unknown>;
    // 75% of 120,000 = 90,000, less the 48,000 genuinely certified.
    expect(String(created.grossThisPeriod)).toContain('42000');
  });

  it('refuses to certify less than a previous application already did', async () => {
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [
        { id: 'a', status: 'issued', kind: 'application', grossThisPeriod: decimal('48000.00'), cumulativePercent: decimal('40'), creditNotes: [] },
      ],
    });

    await expect(
      draftApplication(USER, {
        variationOrderId: VO_ID,
        periodEnd: YESTERDAY,
        cumulativePercent: 30,
      } as never),
    ).rejects.toThrow(/cannot go backwards/);
  });
});

describe('money received', () => {
  function issuedInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: INV_ID,
      projectId: 'proj-1',
      invoiceNumber: 'INV-DXB-001-0001',
      status: 'issued',
      totalDue: decimal('47880.00'),
      payments: [],
      creditNotes: [],
      ...overrides,
    };
  }

  it('marks an invoice part paid, then paid, from the payments alone', async () => {
    state.invoice = issuedInvoice();
    await recordPayment(USER, {
      invoiceId: INV_ID,
      amount: '20000.00',
      receivedOn: YESTERDAY,
    } as never);
    expect((state.invoiceUpdates.at(0)?.data as Record<string, unknown>).status).toBe('part_paid');

    state.invoice = issuedInvoice({
      status: 'part_paid',
      payments: [{ amount: decimal('20000.00') }],
    });
    state.invoiceUpdates = [];
    state.paymentsCreated = [];
    await recordPayment(USER, {
      invoiceId: INV_ID,
      amount: '27880.00',
      receivedOn: YESTERDAY,
    } as never);
    expect((state.invoiceUpdates.at(0)?.data as Record<string, unknown>).status).toBe('paid');
  });

  it('refuses a receipt larger than what is outstanding', async () => {
    // Absorbing it would hide either a misallocated payment or a wrong invoice.
    state.invoice = issuedInvoice({ payments: [{ amount: decimal('40000.00') }] });

    await expect(
      recordPayment(USER, {
        invoiceId: INV_ID,
        amount: '10000.00',
        receivedOn: YESTERDAY,
      } as never),
    ).rejects.toThrow(/outstanding/);
  });

  it('refuses a payment against an application that was never issued', async () => {
    state.invoice = issuedInvoice({ status: 'draft' });

    await expect(
      recordPayment(USER, {
        invoiceId: INV_ID,
        amount: '100.00',
        receivedOn: YESTERDAY,
      } as never),
    ).rejects.toThrow(/not been issued/);
  });

  it('refuses a receipt dated in the future', async () => {
    state.invoice = issuedInvoice();

    await expect(
      recordPayment(USER, {
        invoiceId: INV_ID,
        amount: '100.00',
        receivedOn: new Date(Date.now() + 3 * 86_400_000),
      } as never),
    ).rejects.toThrow(/future/);
  });

  it('refuses anyone without the authority', async () => {
    state.invoice = issuedInvoice();
    state.access = false;

    await expect(
      recordPayment(USER, {
        invoiceId: INV_ID,
        amount: '100.00',
        receivedOn: YESTERDAY,
      } as never),
    ).rejects.toThrow();
  });
});

/**
 * Putting a wrong figure right.
 *
 * Every rule here exists because the alternative is worse than the error it
 * refuses. A credit larger than the invoice makes the client a creditor of the
 * project. A credit against a draft explains a non-event twice. A credit that
 * keeps the retention leaves the company reporting money it may no longer
 * hold.
 */
describe('credit notes', () => {
  const ISSUED = {
    id: INV_ID,
    projectId: 'proj-1',
    invoiceNumber: 'INV-DXB-001-0001',
    status: 'issued',
    grossThisPeriod: decimal('48000.00'),
    retentionPercent: decimal('5'),
    vatPercent: decimal('5'),
    totalDue: decimal('47880.00'),
    project: { projectCode: 'DXB-001' },
    creditNotes: [],
  };

  const CREDIT = {
    invoiceId: INV_ID,
    reason: 'over_certification' as const,
    narrative: 'September certified 75% against a measure later agreed at 60%.',
    grossAmount: '10000.00',
  };

  it('gives back the retention withheld on whatever is credited', async () => {
    state.invoice = { ...ISSUED };
    await draftCreditNote(USER, CREDIT);

    const created = state.creditNotesCreated.at(0)?.data as Record<string, unknown>;
    expect(String(created.grossAmount)).toContain('10000');
    expect(String(created.retentionAmount)).toContain('500');
    expect(String(created.netValue)).toContain('9500');
    expect(String(created.totalCredited)).toContain('9975');
  });

  it('refuses to credit more than the application was for', async () => {
    // Beyond this the client becomes a creditor of the project, which is a
    // position no fit-out contractor ever means to be in.
    state.invoice = { ...ISSUED };
    await expect(
      draftCreditNote(USER, { ...CREDIT, grossAmount: '60000.00' }),
    ).rejects.toThrow(/left to credit/i);
  });

  it('counts a draft credit against the limit, not only an issued one', async () => {
    // Two drafts can each be inside the limit alone and over it together. The
    // one that would tip it over has to fail now, not after somebody approved
    // it.
    state.invoice = {
      ...ISSUED,
      creditNotes: [{ status: 'draft', grossAmount: decimal('45000.00') }],
    };
    await expect(draftCreditNote(USER, CREDIT)).rejects.toThrow(/left to credit/i);
  });

  it('refuses to credit a draft application, because the client never saw it', async () => {
    state.invoice = { ...ISSUED, status: 'draft' };
    await expect(draftCreditNote(USER, CREDIT)).rejects.toThrow(/Cancel it instead/i);
  });

  it('demands an explanation', async () => {
    state.invoice = { ...ISSUED };
    await expect(
      draftCreditNote(USER, { ...CREDIT, narrative: 'oops' }),
    ).rejects.toThrow();
  });

  it('uses the rates on the invoice, not the rates in force today', async () => {
    // A retention percentage renegotiated next year must not change what was
    // withheld last year.
    state.invoice = { ...ISSUED, retentionPercent: decimal('10') };
    await draftCreditNote(USER, CREDIT);

    const created = state.creditNotesCreated.at(0)?.data as Record<string, unknown>;
    expect(String(created.retentionAmount)).toContain('1000');
  });
});

describe('retention coming back', () => {
  const APPLICATION = {
    status: 'issued',
    kind: 'application',
    retentionStage: null,
    retentionAmount: decimal('2400.00'),
    retentionReleased: decimal('0'),
    creditNotes: [],
  };

  it('counts what is held, net of releases and credits', () => {
    const held = retentionOn([
      APPLICATION,
      { ...APPLICATION, retentionAmount: decimal('1600.00') },
      {
        status: 'issued',
        kind: 'retention_release',
        retentionStage: 'practical_completion',
        retentionAmount: decimal('0'),
        retentionReleased: decimal('2000.00'),
        creditNotes: [],
      },
    ]);
    expect(held.withheld).toBe('4000.00');
    expect(held.released).toBe('2000.00');
    expect(held.held).toBe('2000.00');
  });

  it('stops holding retention that was credited back', () => {
    const held = retentionOn([
      { ...APPLICATION, creditNotes: [{ status: 'issued', retentionAmount: decimal('400.00') }] },
    ]);
    expect(held.held).toBe('2000.00');
  });

  it('ignores a draft credit, which has moved nothing', () => {
    const held = retentionOn([
      { ...APPLICATION, creditNotes: [{ status: 'draft', retentionAmount: decimal('400.00') }] },
    ]);
    expect(held.held).toBe('2400.00');
  });

  it('releases the contractual share at practical completion, not the lot', async () => {
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [APPLICATION, { ...APPLICATION, retentionAmount: decimal('1600.00') }],
    });
    (state.vo.project as Record<string, unknown>).contractRules = {
      retentionPercent: decimal('5'),
      paymentTermsDays: 30,
      retentionReleasePercentAtPc: decimal('50'),
    };

    await draftRetentionRelease(USER, {
      variationOrderId: VO_ID,
      stage: 'practical_completion',
      periodEnd: YESTERDAY,
    } as never);

    const created = state.invoicesCreated.at(0)?.data as Record<string, unknown>;
    expect(created.kind).toBe('retention_release');
    // Half of the 4,000 withheld.
    expect(String(created.retentionReleased)).toContain('2000');
    // No work value. Recording a release as turnover would count the job twice.
    expect(String(created.grossThisPeriod)).toContain('0');
  });

  it('refuses the same moiety twice', async () => {
    // Releasing at practical completion, then at practical completion again,
    // hands back the defects moiety a year early and nobody notices until the
    // end of the job.
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [
        APPLICATION,
        {
          status: 'issued',
          kind: 'retention_release',
          retentionStage: 'practical_completion',
          retentionAmount: decimal('0'),
          retentionReleased: decimal('1000.00'),
          creditNotes: [],
        },
      ],
    });

    await expect(
      draftRetentionRelease(USER, {
        variationOrderId: VO_ID,
        stage: 'practical_completion',
        periodEnd: YESTERDAY,
      } as never),
    ).rejects.toThrow(/already been released/i);
  });

  it('refuses to release more than was ever withheld', async () => {
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [APPLICATION],
    });

    await expect(
      draftRetentionRelease(USER, {
        variationOrderId: VO_ID,
        stage: 'defects_liability_end',
        periodEnd: YESTERDAY,
        amount: '9000.00',
      } as never),
    ).rejects.toThrow(/is held on this variation/i);
  });

  it('refuses when there is nothing held at all', async () => {
    state.vo = submittedVo({ status: 'approved', approvedValue: decimal('120000.00'), invoices: [] });
    await expect(
      draftRetentionRelease(USER, {
        variationOrderId: VO_ID,
        stage: 'practical_completion',
        periodEnd: YESTERDAY,
      } as never),
    ).rejects.toThrow(/no retention held/i);
  });
});

/**
 * A correction has to be usable afterwards.
 *
 * Crediting an over-certification is only half the job. If the credited work
 * still counts as applied for, it can never be billed again — the money is
 * corrected off the client's account and lost from the company's at the same
 * time, which is worse than the error.
 */
describe('what a credit changes downstream', () => {
  it('frees the credited work to be applied for again', async () => {
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [
        {
          id: 'a',
          status: 'issued',
          kind: 'application',
          grossThisPeriod: decimal('90000.00'),
          cumulativePercent: decimal('75'),
          creditNotes: [{ status: 'issued', grossAmount: decimal('18000.00') }],
        },
      ],
    });

    // 75% was certified, 18,000 of it credited back, so 72,000 stands. A fresh
    // application at 75% is now worth the 18,000 again.
    await draftApplication(USER, {
      variationOrderId: VO_ID,
      periodEnd: YESTERDAY,
      cumulativePercent: 75,
    } as never);

    const created = state.invoicesCreated.at(0)?.data as Record<string, unknown>;
    expect(String(created.previouslyApplied)).toContain('72000');
    expect(String(created.grossThisPeriod)).toContain('18000');
  });

  it('measures "cannot go backwards" in money, not in the percentage somebody typed', async () => {
    // After a credit the percentage on the paper still says 75 and the money
    // behind it does not. Blocking on the stale percentage would make a
    // corrected invoice impossible to follow up.
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [
        {
          id: 'a',
          status: 'issued',
          kind: 'application',
          grossThisPeriod: decimal('90000.00'),
          cumulativePercent: decimal('75'),
          creditNotes: [{ status: 'issued', grossAmount: decimal('30000.00') }],
        },
      ],
    });

    // 60,000 stands, which is 50%. An application at 65% is forwards.
    await expect(
      draftApplication(USER, {
        variationOrderId: VO_ID,
        periodEnd: YESTERDAY,
        cumulativePercent: 65,
      } as never),
    ).resolves.toBeTruthy();
  });

  it('ignores a draft credit, which nobody has approved', async () => {
    state.vo = submittedVo({
      status: 'approved',
      approvedValue: decimal('120000.00'),
      invoices: [
        {
          id: 'a',
          status: 'issued',
          kind: 'application',
          grossThisPeriod: decimal('48000.00'),
          cumulativePercent: decimal('40'),
          creditNotes: [{ status: 'draft', grossAmount: decimal('48000.00') }],
        },
      ],
    });

    await draftApplication(USER, {
      variationOrderId: VO_ID,
      periodEnd: YESTERDAY,
      cumulativePercent: 75,
    } as never);

    const created = state.invoicesCreated.at(0)?.data as Record<string, unknown>;
    expect(String(created.previouslyApplied)).toContain('48000');
  });

  it('refuses a receipt for more than the credited-down demand', async () => {
    // Without this a fully credited invoice still accepts its original face
    // value, and the cash sits against a demand that no longer exists.
    state.invoice = {
      id: INV_ID,
      projectId: 'proj-1',
      invoiceNumber: 'INV-DXB-001-0001',
      status: 'issued',
      totalDue: decimal('47880.00'),
      payments: [],
      creditNotes: [{ status: 'issued', totalCredited: decimal('40000.00') }],
    };

    await expect(
      recordPayment(USER, {
        invoiceId: INV_ID,
        amount: '20000.00',
        receivedOn: YESTERDAY,
      } as never),
    ).rejects.toThrow(/after credits/i);
  });
});

describe('an extension of time has to say what was delayed', () => {
  it('refuses days with no basis', async () => {
    // Days with no stated critical path are rejected by every engineer who
    // assesses one, and a rejected claim makes the next sound one harder.
    const parsed = voSubmissionSchema.safeParse({
      variationOrderId: VO_ID,
      submittedOn: YESTERDAY,
      timeImpactDaysClaimed: 21,
      timeImpactBasis: null,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts days with one', async () => {
    const parsed = voSubmissionSchema.safeParse({
      variationOrderId: VO_ID,
      submittedOn: YESTERDAY,
      timeImpactDaysClaimed: 21,
      timeImpactBasis: 'Ceiling grid could not start until the revised layout was issued.',
    });
    expect(parsed.success).toBe(true);
  });

  it('does not demand a basis when no days are claimed', async () => {
    const parsed = voSubmissionSchema.safeParse({
      variationOrderId: VO_ID,
      submittedOn: YESTERDAY,
    });
    expect(parsed.success).toBe(true);
  });
});
