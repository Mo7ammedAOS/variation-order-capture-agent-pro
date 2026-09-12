import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertProjectAccess } from '@/services/project-access.service';
import { listDocuments, readDocumentContent } from '@/services/document.service';
import { getPricing } from '@/services/pricing.service';
import { getVariationOrderForChange } from '@/services/variation-order.service';
import { listNotices } from '@/services/notice-document.service';
import { humanise } from '@/services/dashboard.service';
import { formatDate, formatInstant, todayUtc } from '@/lib/dates';
import { uniqueName, zipStore, type ZipEntry } from '@/lib/zip';
import { isAppError, NotFoundError } from '@/lib/errors';

/**
 * The evidence pack: everything about one change, in one file.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A claim without contemporaneous records dies. Everything needed to defend
 * one was already in this system — the photographs, the instruction, the
 * notice and its delivery, who approved what and when — and the only way to
 * assemble it was to open eleven screens and download each piece by hand,
 * which meant nobody did it until the argument had already started.
 *
 * ── What is in it, and in what order ───────────────────────────────────────
 *   00 Contents.txt      the index, and the approval and notice trail, which
 *                        are RECORDS rather than files and exist nowhere else
 *   01 Evidence/         photographs, instructions, RFIs, quotations
 *   02 Notices/          the notices as served
 *   03 Drawings/         drawings, specifications, bills
 *
 * Numbered so the folders sort in the order somebody reads them, and so the
 * index is the first thing in the archive.
 *
 * ── The caps, and why they are refusals rather than truncations ────────────
 * The pack is built in memory and returned in one response. A change with two
 * hundred photographs would exhaust the container, so there are limits — and
 * when one is hit the route says so in the index rather than quietly leaving
 * files out. An evidence pack that is silently incomplete is worse than one
 * that failed, because somebody will rely on it.
 */

/** Generous for one change, and well inside what the container can hold. */
const MAX_FILES = 150;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const FOLDER: Record<string, string> = {
  site_photo: '01 Evidence',
  voice_note: '01 Evidence',
  instruction: '01 Evidence',
  rfi: '01 Evidence',
  correspondence: '01 Evidence',
  quotation: '01 Evidence',
  notice: '02 Notices',
  variation_proposal: '02 Notices',
  drawing: '03 Drawings',
  specification: '03 Drawings',
  boq: '03 Drawings',
  contract: '03 Drawings',
  programme: '03 Drawings',
  other: '01 Evidence',
};

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
        project: { select: { projectCode: true, projectName: true, clientName: true, currency: true } },
        requestedByContact: { select: { fullName: true, companyName: true, authorityVerified: true } },
        reportedBy: { select: { fullName: true } },
        currentOwner: { select: { fullName: true } },
        approvals: {
          orderBy: [{ gate: 'asc' }, { round: 'asc' }, { seat: 'asc' }],
          include: {
            assignedTo: { select: { fullName: true } },
            decidedBy: { select: { fullName: true } },
          },
        },
      },
    });
    if (!change) throw new NotFoundError('Potential Change not found');

    await assertProjectAccess(user, change.projectId);

    const [documents, notices, pricing, vo] = await Promise.all([
      listDocuments(user, { potentialChangeId: id }),
      listNotices(id),
      getPricing(user, id),
      getVariationOrderForChange(id),
    ]);

    /* ── the files ─────────────────────────────────────────────────────── */

    const entries: ZipEntry[] = [];
    const taken = new Set<string>();
    const included: string[] = [];
    const omitted: string[] = [];
    let totalBytes = 0;

    // Oldest first: an evidence pack reads as a chronology, and the newest
    // photograph is rarely the one that explains what happened.
    const ordered = [...documents].reverse();

    for (const document of ordered) {
      if (!document.driveFileId) {
        omitted.push(`${document.documentName} - registered as a link, no stored file`);
        continue;
      }
      if (entries.length >= MAX_FILES) {
        omitted.push(`${document.documentName} - the pack is limited to ${MAX_FILES} files`);
        continue;
      }

      try {
        const file = await readDocumentContent(user, document.id);
        const content = new Uint8Array(file.content);

        if (totalBytes + content.length > MAX_TOTAL_BYTES) {
          omitted.push(`${document.documentName} - the pack is limited to 200 MB`);
          continue;
        }
        totalBytes += content.length;

        const folder = FOLDER[document.documentType] ?? '01 Evidence';
        const name = uniqueName(taken, `${folder}/${document.documentName}`);
        entries.push({ name, content, modified: document.createdAt });
        included.push(
          `${name}   (${humanise(document.documentType)}, uploaded ${formatInstant(document.createdAt)}` +
            `${document.uploadedBy ? ` by ${document.uploadedBy.fullName}` : ''})`,
        );
      } catch {
        // One unreadable file must not lose the other forty. It is named in
        // the index instead, which is the honest outcome.
        omitted.push(`${document.documentName} - could not be read from storage`);
      }
    }

    /* ── the index, which is also the record of things that are not files ── */

    const lines: string[] = [];
    const say = (label: string, value: string | number | null | undefined) => {
      if (value !== null && value !== undefined && value !== '') lines.push(`${label}: ${value}`);
    };

    lines.push('EVIDENCE PACK');
    lines.push('='.repeat(60));
    say('Reference', change.pcNumber);
    say('Variation order', vo?.voNumber);
    say('Project', `${change.project.projectCode} ${change.project.projectName}`);
    say('Client', change.project.clientName);
    say('Assembled', formatDate(todayUtc()));
    lines.push('');

    lines.push('THE CHANGE');
    lines.push('-'.repeat(60));
    say('Title', change.title);
    say('Date of the event', formatDate(change.eventDate));
    say('Captured', formatInstant(change.captureDate));
    say('Location', change.location);
    say('Trade', change.trade);
    say('Instructed or raised by', change.instructedBy);
    say('How it reached us', change.instructionRoute ? humanise(change.instructionRoute) : null);
    if (change.requestedByContact) {
      say(
        'Requested by',
        `${change.requestedByContact.fullName}` +
          `${change.requestedByContact.companyName ? `, ${change.requestedByContact.companyName}` : ''}` +
          ` (authority ${change.requestedByContact.authorityVerified ? 'verified' : 'NOT verified'})`,
      );
    }
    say('Reported by', change.reportedBy?.fullName);
    say('Work status', humanise(change.workStatus));
    say('Current status', humanise(change.currentStatus));
    say('Owner', change.currentOwner?.fullName);
    lines.push('');
    lines.push('As reported:');
    lines.push(change.description);
    lines.push('');

    if (change.scopeOriginal || change.scopeRevised) {
      lines.push('SCOPE');
      lines.push('-'.repeat(60));
      lines.push('Original:');
      lines.push(change.scopeOriginal ?? 'Not stated.');
      lines.push('');
      lines.push('Revised:');
      lines.push(change.scopeRevised ?? 'Not stated.');
      lines.push('');
    }

    lines.push('THE NOTICE');
    lines.push('-'.repeat(60));
    say('Notice required', change.noticeRequired ? 'Yes' : 'No');
    say('Notice status', humanise(change.noticeStatus));
    say('Deadline', change.noticeDueDate ? formatDate(change.noticeDueDate) : null);
    say('Assessed', change.noticeAssessedAt ? formatInstant(change.noticeAssessedAt) : null);
    say('Assessment notes', change.noticeAssessmentNotes);
    if (notices.length === 0) {
      lines.push('No notice document has been drafted.');
    } else {
      for (const notice of notices) {
        lines.push('');
        say('  Reference', notice.reference);
        say('  Version', notice.version);
        say('  Status', humanise(notice.status));
        say('  Issued', notice.issuedAt ? formatInstant(notice.issuedAt) : null);
        // The delivery proof. Without a message id "sent" is a hope, and this
        // is the line somebody will point at when service is challenged.
        say('  Delivered', notice.sentAt ? formatInstant(notice.sentAt) : 'not confirmed');
        say('  Delivery reference', notice.externalMessageId);
        say('  Acknowledged', notice.acknowledgedAt ? formatInstant(notice.acknowledgedAt) : null);
      }
    }
    lines.push('');

    if (pricing.items.length > 0) {
      lines.push('THE BUILD-UP');
      lines.push('-'.repeat(60));
      for (const item of pricing.items) {
        lines.push(
          `${item.description}  |  ${item.quantity} ${item.unit} @ ${item.rate}  =  ${item.amount}` +
            `  [${item.rateSource.split('_').join(' ')}${item.boqReference ? `, bill ref ${item.boqReference}` : ''}]`,
        );
      }
      lines.push('');
      say('Net', `${change.project.currency} ${pricing.totals.net}`);
      say('Preliminaries', `${change.project.currency} ${pricing.totals.prelims}`);
      say('Overhead and profit', `${change.project.currency} ${pricing.totals.overheadProfit}`);
      say('Total', `${change.project.currency} ${pricing.totals.total}`);
      lines.push('');
    }

    lines.push('APPROVALS');
    lines.push('-'.repeat(60));
    if (change.approvals.length === 0) {
      lines.push('No approval has been sought.');
    } else {
      for (const approval of change.approvals) {
        lines.push(
          `${humanise(approval.gate)} / ${humanise(approval.seat)} (round ${approval.round}): ` +
            `${approval.decision ? humanise(approval.decision) : 'awaiting'}` +
            `${approval.decidedBy ? ` by ${approval.decidedBy.fullName}` : ''}` +
            `${approval.decidedAt ? ` on ${formatInstant(approval.decidedAt)}` : ''}`,
        );
        if (approval.comment) lines.push(`    "${approval.comment}"`);
      }
    }
    lines.push('');

    if (vo) {
      lines.push('THE CLIENT RESPONSE');
      lines.push('-'.repeat(60));
      say('Variation order', vo.voNumber);
      say('Status', humanise(vo.status));
      say('Submitted', vo.submittedAt ? formatInstant(vo.submittedAt) : null);
      say('Submitted value', vo.submittedValue ? vo.submittedValue.toString() : null);
      say('Client response', humanise(vo.clientResponse));
      say('Responded', vo.clientResponseAt ? formatInstant(vo.clientResponseAt) : null);
      say('Approved value', vo.approvedValue ? vo.approvedValue.toString() : null);
      say('Client reference', vo.clientReference);
      say('Notes', vo.clientResponseNotes);
      lines.push('');
    }

    lines.push('FILES IN THIS PACK');
    lines.push('-'.repeat(60));
    if (included.length === 0) {
      lines.push('None. Nothing has been attached to this change.');
    } else {
      for (const entry of included) lines.push(entry);
    }

    if (omitted.length > 0) {
      lines.push('');
      lines.push('NOT INCLUDED');
      lines.push('-'.repeat(60));
      lines.push('These are named so the pack is never silently incomplete:');
      for (const entry of omitted) lines.push(entry);
    }

    // Prepended, so the index is the first entry in the archive.
    entries.unshift({
      name: '00 Contents.txt',
      content: new TextEncoder().encode(`﻿${lines.join('\r\n')}\r\n`),
      modified: new Date(),
    });

    const archive = zipStore(entries);
    const stem = (vo?.voNumber ?? change.pcNumber).replace(/[^A-Za-z0-9-]+/g, '-');

    return new NextResponse(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${stem}-evidence-pack.zip"`,
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
