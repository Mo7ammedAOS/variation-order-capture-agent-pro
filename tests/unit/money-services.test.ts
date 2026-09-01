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
  potentialChange: { findUnique: async () => null },
  companySettings: { findFirst: async () => state.company },
  projectMember: { findFirst: async () => ({ userId: 'fin-1' }) },
  task: {
    create: async (args: Record<string, unknown>) => {
      state.tasksCreated.push(args);
      return { id: 'task-1' };
    },
  },
  $queryRaw: async () => [{ vo_sequence: 1, invoice_sequence: 1 }],
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const { recordClientResponse } = await import('@/services/variation-order.service');
const { draftApplication } = await import('@/services/invoice.service');
const { recordPayment } = await import('@/services/payment.service');

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
        { id: 'a', status: 'issued', grossThisPeriod: decimal('48000.00'), cumulativePercent: decimal('40') },
        { id: 'b', status: 'cancelled', grossThisPeriod: decimal('30000.00'), cumulativePercent: decimal('65') },
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
        { id: 'a', status: 'issued', grossThisPeriod: decimal('48000.00'), cumulativePercent: decimal('40') },
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
