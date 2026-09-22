import 'server-only';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { assertProjectAccess } from '@/services/project-access.service';
import { getPricing } from '@/services/pricing.service';
import { humanise } from '@/services/dashboard.service';
import { renderVariationOrder, type VoFacts } from '@/lib/vo-template';
import { noticeLetterPdf } from '@/lib/notice-template';
import { renderDocumentPdf } from '@/lib/pdf';

/**
 * The client-ready variation order, as bytes.
 *
 * One builder, two callers: the QS opening it on screen to check it, and the
 * approval that files and sends it. They were about to become two, and two
 * renderers of the same document is how the copy in the file stops matching
 * the copy the client is holding — which is the one difference in this system
 * nobody can argue their way out of.
 *
 * Generated on request rather than frozen at issue, because a VO is a live
 * priced position: a QS produces it several times as the build-up changes.
 * What makes a version permanent is submission, which freezes `submittedValue`
 * and locks the pricing behind it.
 */
export async function buildVariationOrderPdf(
  user: AuthenticatedUser,
  potentialChangeId: string,
): Promise<{ pdf: Buffer; reference: string; facts: VoFacts }> {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    include: { project: { include: { contractRules: true } } },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  await assertProjectAccess(user, change.projectId);

  const [company, pricing, vo] = await Promise.all([
    prisma.companySettings.findFirst({ where: { singleton: true } }),
    getPricing(user, potentialChangeId),
    // Read directly rather than through the variation-order service: that
    // service now calls this builder, and a module cycle that happens to work
    // because function declarations hoist is not something to rely on.
    prisma.variationOrder.findUnique({
      where: { potentialChangeId },
      select: { voNumber: true, timeImpactDaysClaimed: true, timeImpactBasis: true },
    }),
  ]);

  const rules = change.project.contractRules;

  const facts: VoFacts = {
    companyName: company?.legalCompanyName ?? company?.displayCompanyName ?? 'The Contractor',
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
      internal approval — and refusing to produce one until a VO number exists
      would make the useful case the impossible one.
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

  return { pdf, reference: facts.voNumber.split(' ')[0] ?? change.pcNumber, facts };
}
