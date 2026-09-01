import 'server-only';
import type { DocumentType, Prisma, SourceType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';
import {
  getStorageProvider,
  PC_FOLDER_TREE,
  NOTICE_PARENT_FOLDER,
  PC_PARENT_FOLDER,
  PROJECT_FOLDER_TREE,
} from '@/integrations/storage';
import { getEnv } from '@/lib/env';

/**
 * Documents and evidence.
 *
 * Bytes live in the storage provider. This table is the index AND the access
 * boundary — files are served through an authenticated proxy, never a Drive
 * link, because a `webViewLink` in the HTML routes around every access rule in
 * the system.
 *
 * Evidence is immutable. The app trashes, never purges, and never overwrites.
 */

// Must stay <= serverActions.bodySizeLimit in next.config.ts. A fit-out
// drawing set is routinely tens of megabytes; 25 MB rejected real drawings.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

/**
 * CAD files, allowed by EXTENSION rather than type.
 *
 * Browsers report `.dwg` as `application/octet-stream`, or as nothing at all —
 * there is no reliable MIME type for it. Trusting octet-stream on its own would
 * accept literally any file, so the extension has to carry it. The bytes are
 * never executed, only stored and served back as a download.
 */
const ALLOWED_EXTENSIONS = ['.dwg', '.dxf', '.rvt', '.ifc', '.dwf'];

function assertAcceptableFile(mimeType: string, sizeBytes: number, fileName = '') {
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }

  const lower = fileName.toLowerCase();
  const allowed =
    ALLOWED_MIME_TYPES.has(mimeType) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));

  if (!allowed) {
    throw new ValidationError(
      `${fileName || 'That file'} is a type we do not accept (${mimeType || 'unknown'})`,
    );
  }
}

/**
 * Returns the project's storage folder, creating the tree on first use.
 *
 * ── Network calls do NOT happen inside a database transaction ──────────────
 * They used to. Creating the nine-folder tree in Drive takes about nine
 * seconds and Prisma's interactive transaction timeout is five, so the
 * transaction expired before the UPDATE that stores the folder id ran. The
 * folders appeared in Drive, the id was never saved, and the next upload built
 * the whole tree again — duplicating it, which is the precise outcome the lock
 * was there to prevent.
 *
 * So the slow work happens outside, and the database is touched twice, briefly:
 * once to read, once to claim. The claim is a conditional UPDATE — whoever
 * writes first wins, and a loser adopts the winner's id rather than overwriting
 * it, so the store and the index can never disagree about which folder is the
 * project's.
 *
 * A genuine simultaneous first upload can still create two trees in Drive,
 * because `ensureFolder` is a lookup followed by a create and Drive permits
 * duplicate names. Only one id is ever recorded, and the database is the index,
 * so the orphan is untidy rather than harmful.
 */
export async function ensureProjectFolders(projectId: string): Promise<string> {
  const env = getEnv();
  const storage = getStorageProvider();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, projectName: true, driveFolderId: true },
  });
  if (!project) throw new NotFoundError('Project not found');
  if (project.driveFolderId) return project.driveFolderId;

  const root = env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
  const projectFolderId = await storage.ensureFolder(
    `${project.projectCode} — ${project.projectName}`,
    root,
  );
  for (const child of PROJECT_FOLDER_TREE) {
    await storage.ensureFolder(child, projectFolderId);
  }

  const claimed = await prisma.project.updateMany({
    where: { id: projectId, driveFolderId: null },
    data: { driveFolderId: projectFolderId },
  });
  if (claimed.count === 1) return projectFolderId;

  // Someone else claimed it while we were talking to Drive. Theirs is the one
  // the rest of the system will use, so use it here too.
  const winner = await prisma.project.findUnique({
    where: { id: projectId },
    select: { driveFolderId: true },
  });
  return winner?.driveFolderId ?? projectFolderId;
}

/**
 * The `07 Potential Changes/PC-.../Evidence` folder for one change.
 *
 * Same shape as above and for the same reason: Drive calls outside any
 * transaction, then one conditional claim.
 */
export async function ensurePotentialChangeFolders(potentialChangeId: string): Promise<{
  folderId: string;
  evidenceFolderId: string;
}> {
  const storage = getStorageProvider();

  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: {
      id: true, projectId: true, pcNumber: true, driveFolderId: true, eventDate: true,
      project: { select: { projectCode: true } },
    },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  const projectFolderId = await ensureProjectFolders(change.projectId);

  let folderId = change.driveFolderId;
  if (!folderId) {
    // Osman's structure: month, then a folder per DAY that had a variation.
    //
    //   07 Potential Changes/
    //     August/
    //       DXB-001-01092026/     <- everything raised that day
    //
    // Both created on demand and never in advance. A year of empty month
    // folders on a job with three variations is noise, and noise is what makes
    // people stop opening the folder at all.
    //
    // The day is the EVENT date, not today. A change reported on Monday about
    // something that happened on Friday belongs in Friday's folder — that is
    // the date the notice clock runs from, and the date anyone will look under.
    const changesFolder = await storage.ensureFolder(PC_PARENT_FOLDER, projectFolderId);
    const monthFolder = await storage.ensureFolder(
      monthFolderName(change.eventDate),
      changesFolder,
    );
    const dayFolder = await storage.ensureFolder(
      dayFolderName(change.project.projectCode, change.eventDate),
      monthFolder,
    );
    folderId = await storage.ensureFolder(change.pcNumber, dayFolder);
    for (const child of PC_FOLDER_TREE) {
      await storage.ensureFolder(child, folderId);
    }

    const claimed = await prisma.potentialChange.updateMany({
      where: { id: potentialChangeId, driveFolderId: null },
      data: { driveFolderId: folderId },
    });
    if (claimed.count !== 1) {
      const winner = await prisma.potentialChange.findUnique({
        where: { id: potentialChangeId },
        select: { driveFolderId: true },
      });
      folderId = winner?.driveFolderId ?? folderId;
    }
  }

  const evidenceFolderId = await storage.ensureFolder('Evidence', folderId);
  return { folderId, evidenceFolderId };
}

/**
 * The `08 Notices` folder, and a notice PDF filed into it.
 *
 * A notice does NOT go in the change's Evidence folder. Evidence is what we
 * were sent; a notice is what we served, and the two are read for opposite
 * reasons. Anyone assembling a claim opens `08 Notices` and expects to find
 * every notice on the job in one place, in reference order, without opening
 * forty change folders.
 *
 * Drive work happens outside any transaction, for the reason spelled out on
 * `ensureProjectFolders`.
 */
export async function storeNoticeDocument(input: {
  projectId: string;
  potentialChangeId: string;
  reference: string;
  content: Buffer;
  uploadedByUserId: string | null;
}) {
  const storage = getStorageProvider();
  const projectFolderId = await ensureProjectFolders(input.projectId);
  const noticesFolderId = await storage.ensureFolder(NOTICE_PARENT_FOLDER, projectFolderId);

  const fileName = `${input.reference}.pdf`;
  const stored = await storage.upload({
    folderId: noticesFolderId,
    name: fileName,
    mimeType: 'application/pdf',
    content: input.content,
  });

  return prisma.projectDocument.create({
    data: {
      projectId: input.projectId,
      potentialChangeId: input.potentialChangeId,
      documentType: 'notice',
      documentName: fileName,
      documentNumber: input.reference,
      issueDate: new Date(),
      driveFileId: stored.fileId,
      storagePath: stored.storagePath,
      sourceUrl: stored.sourceUrl,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      uploadedByUserId: input.uploadedByUserId,
      // The app produced this file, not a person and not an inbox.
      sourceChannel: 'other',
    },
  });
}

/**
 * A photo, a drawing or a PDF that arrived attached to a captured message.
 *
 * The bytes come in base64 because n8n downloads the attachment and forwards
 * it — the inbox it came from needs credentials we deliberately do not hold, so
 * a URL alone is usually not fetchable later. When only a URL is given the row
 * is still created, pointing at it, because knowing a file existed is worth
 * more than nothing.
 */
export interface CaptureAttachment {
  externalId: string;
  fileName: string;
  mimeType: string;
  contentBase64?: string | undefined;
  url?: string | undefined;
}

export interface StoredEvidence {
  stored: number;
  skipped: { fileName: string; reason: string }[];
}

/**
 * Files the attachments on a captured message as evidence for its change.
 *
 * ── There is no signed-in user here ────────────────────────────────────────
 * The capture path has already resolved authority: the sender was matched to a
 * real user, and the project was chosen from that user's own memberships or
 * confirmed by them. So this takes the project explicitly and performs no
 * access check, exactly as `storeNoticeDocument` does. It must never be reached
 * from a route that has a user, because it would be an access check missing.
 *
 * ── It cannot throw ────────────────────────────────────────────────────────
 * A rejected file, a Drive outage, a corrupt base64 blob — none of these may
 * lose the change. The change is the commercial record and the notice clock is
 * already running on it; the photo is supporting material. So every failure is
 * caught per file, counted, and reported back to the caller for the audit trail
 * rather than thrown. A site engineer whose photo did not stick still has his
 * variation on the register.
 */
export async function storeCaptureEvidence(input: {
  projectId: string;
  potentialChangeId: string;
  uploadedByUserId: string | null;
  channel: SourceType;
  attachments: CaptureAttachment[];
}): Promise<StoredEvidence> {
  const result: StoredEvidence = { stored: 0, skipped: [] };
  if (input.attachments.length === 0) return result;

  let evidenceFolderId: string | null = null;
  try {
    evidenceFolderId = (await ensurePotentialChangeFolders(input.potentialChangeId))
      .evidenceFolderId;
  } catch (error) {
    // No folder means no bytes can be stored. The URL-only rows below still
    // get written, so the change records that attachments came with it.
    evidenceFolderId = null;
    result.skipped.push({
      fileName: '(evidence folder)',
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const storage = getStorageProvider();

  for (const attachment of input.attachments) {
    const fileName = attachment.fileName?.trim() || `${attachment.externalId}`;

    try {
      if (!attachment.contentBase64) {
        if (!attachment.url) {
          result.skipped.push({ fileName, reason: 'No bytes and no link' });
          continue;
        }
        await prisma.projectDocument.create({
          data: {
            projectId: input.projectId,
            potentialChangeId: input.potentialChangeId,
            documentType: inferDocumentType(attachment.mimeType, fileName),
            documentName: fileName,
            sourceUrl: attachment.url,
            mimeType: attachment.mimeType,
            uploadedByUserId: input.uploadedByUserId,
            sourceChannel: input.channel,
          },
        });
        result.stored++;
        continue;
      }

      const content = Buffer.from(attachment.contentBase64, 'base64');
      if (content.byteLength === 0) {
        result.skipped.push({ fileName, reason: 'Attachment was empty' });
        continue;
      }
      assertAcceptableFile(attachment.mimeType, content.byteLength, fileName);

      if (!evidenceFolderId) {
        result.skipped.push({ fileName, reason: 'Evidence folder unavailable' });
        continue;
      }

      const stored = await storage.upload({
        folderId: evidenceFolderId,
        name: fileName,
        mimeType: attachment.mimeType,
        content,
      });

      await prisma.projectDocument.create({
        data: {
          projectId: input.projectId,
          potentialChangeId: input.potentialChangeId,
          documentType: inferDocumentType(attachment.mimeType, fileName),
          documentName: fileName,
          driveFileId: stored.fileId,
          storagePath: stored.storagePath,
          sourceUrl: stored.sourceUrl,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          uploadedByUserId: input.uploadedByUserId,
          // Where it actually came from. `mobile_form` would be a lie, and the
          // channel is what tells a reviewer how much to trust the sender.
          sourceChannel: input.channel,
        },
      });
      result.stored++;
    } catch (error) {
      result.skipped.push({
        fileName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export const documentRegisterSchema = z.object({
  projectId: z.string().uuid(),
  potentialChangeId: z.string().uuid().optional().nullable(),
  documentType: z.enum([
    'contract', 'drawing', 'specification', 'boq', 'programme', 'correspondence',
    'site_photo', 'voice_note', 'instruction', 'rfi', 'quotation', 'notice',
    'variation_proposal', 'other',
  ]).default('other'),
  documentName: z.string().trim().min(1).max(300),
  documentNumber: z.string().trim().max(100).optional().nullable(),
  revisionNumber: z.string().trim().max(50).optional().nullable(),
  issueDate: z.coerce.date().optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
});

/** Registers a document that lives elsewhere, by URL. No bytes are stored. */
export async function registerDocument(
  user: AuthenticatedUser,
  input: z.infer<typeof documentRegisterSchema>,
) {
  await assertProjectAccess(user, input.projectId, 'document.upload');

  return prisma.$transaction(async (tx) => {
    const document = await tx.projectDocument.create({
      data: { ...input, uploadedByUserId: user.id, sourceChannel: 'mobile_form' },
    });
    await recordAudit({
      db: tx,
      projectId: input.projectId,
      userId: user.id,
      recordType: 'project_document',
      recordId: document.id,
      actionType: 'created',
      newValue: { documentName: document.documentName, documentType: document.documentType },
    });
    return document;
  });
}

export async function uploadDocument(
  user: AuthenticatedUser,
  input: {
    projectId: string;
    potentialChangeId?: string | null;
    documentType?: DocumentType;
    fileName: string;
    mimeType: string;
    content: Buffer;
  },
) {
  await assertProjectAccess(user, input.projectId, 'document.upload');
  assertAcceptableFile(input.mimeType, input.content.byteLength, input.fileName);

  const storage = getStorageProvider();

  // Evidence for a change goes in that change's Evidence folder; anything else
  // goes to the project root folder.
  const folderId = input.potentialChangeId
    ? (await ensurePotentialChangeFolders(input.potentialChangeId)).evidenceFolderId
    : await ensureProjectFolders(input.projectId);

  const stored = await storage.upload({
    folderId,
    name: input.fileName,
    mimeType: input.mimeType,
    content: input.content,
  });

  return prisma.$transaction(async (tx) => {
    const document = await tx.projectDocument.create({
      data: {
        projectId: input.projectId,
        potentialChangeId: input.potentialChangeId ?? null,
        documentType: input.documentType ?? inferDocumentType(input.mimeType, input.fileName),
        documentName: input.fileName,
        driveFileId: stored.fileId,
        storagePath: stored.storagePath,
        sourceUrl: stored.sourceUrl,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        uploadedByUserId: user.id,
        sourceChannel: 'mobile_form',
      },
    });

    await recordAudit({
      db: tx,
      projectId: input.projectId,
      userId: user.id,
      recordType: 'project_document',
      recordId: document.id,
      actionType: 'uploaded',
      newValue: { documentName: document.documentName, sizeBytes: document.sizeBytes },
      metadata: { storageProvider: storage.name },
    });

    return document;
  });
}

/**
 * The proxy read. Checks access, THEN fetches bytes.
 *
 * The order matters: fetching first and checking second would mean a denied
 * request still costs a Drive round trip, and one early `return` away from
 * being a leak.
 */
export async function readDocumentContent(user: AuthenticatedUser, documentId: string) {
  const document = await prisma.projectDocument.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundError('Document not found');

  await assertProjectAccess(user, document.projectId);

  if (!document.driveFileId) {
    throw new ForbiddenError('This document is a registered link, not a stored file');
  }

  const file = await getStorageProvider().download(document.driveFileId);

  await recordAudit({
    projectId: document.projectId,
    userId: user.id,
    recordType: 'project_document',
    recordId: documentId,
    actionType: 'downloaded',
  });

  return file;
}

export async function listDocuments(
  user: AuthenticatedUser,
  filters: { projectId?: string; potentialChangeId?: string } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.ProjectDocumentWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }
  if (filters.potentialChangeId) where.potentialChangeId = filters.potentialChangeId;

  return prisma.projectDocument.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
}

/**
 * A guess, used only when nobody said what the file is.
 *
 * A PDF used to become a `drawing`, confidently and often wrongly: an RFI, a
 * client instruction and a quotation are all PDFs, and all three entered the
 * register labelled as drawings. A wrong label in a commercial register is
 * worse than no label, because it is searched and filtered on.
 *
 * So a PDF is now `other` unless someone says otherwise, and the upload forms
 * ask. An image from a phone on site really is a site photo, and that one is
 * safe to assume.
 */
function inferDocumentType(mimeType: string, fileName = ''): DocumentType {
  if (mimeType.startsWith('image/')) return 'site_photo';
  if (mimeType.startsWith('audio/')) return 'voice_note';

  const lower = fileName.toLowerCase();
  if (['.dwg', '.dxf', '.rvt', '.ifc', '.dwf'].some((e) => lower.endsWith(e))) return 'drawing';

  return 'other';
}


/* ─── Folder names ───────────────────────────────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `August`. Osman's choice, and it is what people say out loud. */
export function monthFolderName(date: Date): string {
  return MONTHS[date.getUTCMonth()] ?? 'Unknown';
}

/**
 * `DXB-001-01092026` — project code, then the date with no separators.
 *
 * DDMMYYYY, Osman's convention, matching how dates are written on site here.
 * Two consequences worth knowing rather than discovering: Drive sorts these
 * alphabetically, so within a month the 1st sorts before the 2nd but the 10th
 * lands before the 2nd as well; and `01092026` reads as January to anything
 * expecting American order. The folder name is a label — every date the system
 * REASONS about is a real date column, and every date it displays goes through
 * formatDate as `01 Sep 2026`.
 */
export function dayFolderName(projectCode: string, date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${projectCode}-${dd}${mm}${date.getUTCFullYear()}`;
}
