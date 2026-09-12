import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { listPotentialChanges } from '@/services/potential-change.service';
import { getNoticeCountdown, isNoticeOverdue } from '@/services/notice.service';
import { csvFilename, toCsv } from '@/lib/csv';
import { humanise } from '@/services/dashboard.service';
import { isAppError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';

/**
 * The variation register, as a spreadsheet.
 *
 * ── Why it takes the register's own filters ────────────────────────────────
 * Filters on this product live in the URL, which is what makes a filtered
 * register a link somebody can send. The export reads the SAME parameters, so
 * "export what I am looking at" is true rather than approximately true — and a
 * QS who filtered to one project and one risk colour does not get a file with
 * every project in it.
 *
 * ── Why it goes through the service ────────────────────────────────────────
 * `listPotentialChanges` applies the project scope. Querying Prisma directly
 * here would be one line shorter and would hand a site engineer on one project
 * a CSV of every project in the company — the exact failure the access rule
 * exists to prevent, arriving through a door marked "export".
 *
 * ── Why the countdown is recomputed rather than read ───────────────────────
 * `riskLevel` on the row is a stored value, correct as of the last time
 * something touched the record. Days remaining is a function of today. A
 * spreadsheet that says "14 days left" about a deadline that passed last week
 * is worse than one with no column at all.
 */

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const params = request.nextUrl.searchParams;
  const dueWithin = params.get('dueWithin');

  const changes = await listPotentialChanges(user, {
    projectId: params.get('projectId') ?? undefined,
    status: params.get('status') ?? undefined,
    riskLevel: (params.get('risk') as 'green' | 'amber' | 'red' | null) ?? undefined,
    trade: params.get('trade') ?? undefined,
    search: params.get('q') ?? undefined,
    noticeDueWithinDays: dueWithin ? Number(dueWithin) : undefined,
  });

  const headers = [
    'PC number',
    'Project code',
    'Project',
    'Title',
    'Description',
    'Original scope',
    'Revised scope',
    'Status',
    'Event date',
    'Captured',
    'Location',
    'Trade',
    'Instructed by',
    'How it reached us',
    'Requested by',
    'Authority verified',
    'Work status',
    'Estimated value',
    'Time impact (days)',
    'Notice required',
    'Notice status',
    'Notice due',
    'Days remaining',
    'Risk',
    'Owner',
    'Waiting for',
    'Next action',
    'Next action due',
    'Blocker',
    'Tasks',
    'Documents',
    'Held up',
  ] as const;

  const today = todayUtc();

  const rows = changes.map((change) => {
    const countdown = getNoticeCountdown(change.noticeDueDate);
    /*
      A deadline stops running once the notice is drafted, sent or
      acknowledged — at that point a passed date is history, not a breach. So
      "days remaining" is only reported while the deadline is still live;
      otherwise the column says the notice was served, which is the answer the
      QS actually wants in a spreadsheet.
    */
    const live = (['not_assessed', 'required'] as string[]).includes(change.noticeStatus);
    const overdue = isNoticeOverdue(change.noticeDueDate, change.noticeStatus, today);

    return [
      change.pcNumber,
      change.project.projectCode,
      change.project.projectName,
      change.title,
      change.description,
      change.scopeOriginal,
      change.scopeRevised,
      humanise(change.currentStatus),
      change.eventDate,
      change.captureDate,
      change.location,
      change.trade,
      change.instructedBy,
      change.instructionRoute ? humanise(change.instructionRoute) : null,
      change.requestedByContact?.fullName ?? null,
      change.requestedByContact ? (change.requestedByContact.authorityVerified ? 'Yes' : 'No') : null,
      humanise(change.workStatus),
      change.estimatedValue ? change.estimatedValue.toString() : null,
      change.timeImpactDays,
      change.noticeRequired ? 'Yes' : 'No',
      humanise(change.noticeStatus),
      change.noticeDueDate,
      live ? countdown.daysRemaining : 'Served',
      live ? (overdue ? 'BREACHED' : countdown.riskLevel) : 'met',
      change.currentOwner?.fullName ?? null,
      change.waitingFor,
      change.nextAction,
      change.nextActionDueDate,
      change.blockerReason,
      change._count.tasks,
      change._count.documents,
      change._count.bottlenecks,
    ];
  });

  const body = toCsv(headers, rows);

  return new NextResponse(body, {
    headers: {
      // `charset=utf-8` as well as the BOM. Belt and braces, and neither costs
      // anything.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename('variation-register', new Date())}"`,
      // A register is live commercial data. A cached copy served to the next
      // person who asks would be wrong within the hour, and possibly wrong
      // about which projects they may see.
      'Cache-Control': 'no-store, private',
    },
  });
}
