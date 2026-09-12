import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertProjectAccess } from '@/services/project-access.service';
import { getPricing } from '@/services/pricing.service';
import { getVariationOrderForChange } from '@/services/variation-order.service';
import { renderVariationOrder, type VoFacts } from '@/lib/vo-template';
import { noticeLetterPdf } from '@/lib/notice-template';
import { renderDocumentPdf } from '@/lib/pdf';
import { humanise } from '@/services/dashboard.service';
import { isAppError, NotFoundError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';

/**
 * The client-ready variation order, as a PDF.
 *
 * ── Why this is generated on request, not filed at issue ───────────────────
 * A notice is filed to Drive the moment it is issued, because a notice is
 * evidence of service — the artefact IS the proof, and it must be frozen. This
 * document is different: it is a statement of the current priced position, and
 * a QS will produce it several times as the build-up changes and the client
 * asks questions. Freezing the first one and serving it forever would hand
 * somebody a figure that is no longer true.
 *
 * When a version needs to be permanent, that is what submission does: the VO
 * record carries `submittedValue` and `submittedAt`, and the pricing behind an
 * approved change cannot be edited.
 *
 * ── Access ─────────────────────────────────────────────────────────────────
 * `assertProjectAccess` before a single fact is read. This route composes a
 * document out of the client's name, the contract number, the full build-up
 * and the total, which is close to the most commercially sensitive page the
 * system can produce.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const user = await requireUser();

    const change = await prisma.potentialChange.findUnique({
      where: { id },
      include: {
        project: { include: { contractRules: true } },
      },
    });
    if (!change) throw new NotFoundError('Potential Change not found');

    await assertProjectAccess(user, change.projectId);

    const [company, pricing, vo] = await Promise.all([
      prisma.companySettings.findFirst({ where: { singleton: true } }),
      getPricing(user, id),
      getVariationOrderForChange(id),
    ]);

    const rules = change.project.contractRules;

    const facts: VoFacts = {
      companyName:
        company?.legalCompanyName ?? company?.displayCompanyName ?? 'The Contractor',
      projectCode: change.project.projectCode,
      projectName: change.project.projectName,
      contractNumber: change.project.contractNumber,
      clientName: change.project.clientName,
      recipientName: rules?.noticeRecipientName ?? null,
      recipientCompany: rules?.noticeRecipientCompany ?? change.project.clientName,
      clauseReference: rules?.contractClauseReference ?? null,

      /*
        Falls back to the PC number when no VO has been raised yet. A QS wants
        this document BEFORE submission — to check it, to attach it to an
        internal approval — and refusing to produce one until a VO number
        exists would make the useful case the impossible one.
      */
      voNumber: vo?.voNumber ?? `${change.pcNumber} (not yet raised)`,
      pcNumber: change.pcNumber,
      title: change.title,
      description: change.description,
      scopeOriginal: change.scopeOriginal,
      scopeRevised: change.scopeRevised,

      eventDate: change.eventDate,
      documentDate: todayUtc(),
      location: change.location,
      trade: change.trade,
      instructedBy: change.instructedBy,
      instructionSource: change.instructionRoute ? humanise(change.instructionRoute) : null,

      lineItems: pricing.items.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit: item.unit,
        rate: item.rate.toString(),
        amount: item.amount.toString(),
        rateSource: item.rateSource,
        boqReference: item.boqReference,
      })),
      net: pricing.totals.net,
      prelims: pricing.totals.prelims,
      prelimsPercent: change.prelimsPercent ? change.prelimsPercent.toString() : null,
      overheadProfit: pricing.totals.overheadProfit,
      overheadProfitPercent: change.overheadProfitPercent
        ? change.overheadProfitPercent.toString()
        : null,
      total: pricing.totals.total,
      currency: change.project.currency,

      timeImpactDaysClaimed: vo?.timeImpactDaysClaimed ?? change.timeImpactDays,
      timeImpactBasis: vo?.timeImpactBasis ?? null,
    };

    const { body } = renderVariationOrder(facts);

    const pdf = renderDocumentPdf(
      noticeLetterPdf(body, {
        companyName: facts.companyName,
        documentType: 'VARIATION ORDER',
        footer: `${facts.voNumber}   |   ${facts.projectCode}`,
      }),
    );

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // `inline`, so it opens in the browser's viewer. A QS checks it before
        // sending it, and forcing a download to do that is a wasted step.
        'Content-Disposition': `inline; filename="${facts.voNumber.split(' ')[0]}.pdf"`,
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
