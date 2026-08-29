import 'server-only';
import type { DocumentType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';
import {
  getStorageProvider,
  PC_FOLDER_TREE,
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

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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

function assertAcceptableFile(mimeType: string, sizeBytes: number) {
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  const allowed =
    ALLOWED_MIME_TYPES.has(mimeType) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
  if (!allowed) throw new ValidationError(`Files of type ${mimeType} are not accepted`);
}

/**
 * Returns the project's storage folder, creating the tree on first use.
 *
 * Serialised with a Postgres advisory lock keyed on the project. Without it two
 * concurrent captures would each find no folder and each create one, and the
 * store would silently hold two `07 Potential Changes` trees.
 */
export async function ensureProjectFolders(projectId: string): Promise<string> {
  const env = getEnv();
  const storage = getStorageProvider();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-folder:${projectId}`}))`;

    const project = await tx.project.findUnique({
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

    await tx.project.update({
      where: { id: projectId },
      data: { driveFolderId: projectFolderId },
    });
    return projectFolderId;
  });
}

/** The `07 Potential Changes/PC-.../Evidence` folder for one change. */
export async function ensurePotentialChangeFolders(potentialChangeId: string): Promise<{
  folderId: string;
  evidenceFolderId: string;
}> {
  const storage = getStorageProvider();

  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: { id: true, projectId: true, pcNumber: true, driveFolderId: true },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  const projectFolderId = await ensureProjectFolders(change.projectId);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pc-folder:${potentialChangeId}`}))`;

    const fresh = await tx.potentialChange.findUnique({
      where: { id: potentialChangeId },
      select: { driveFolderId: true },
    });

    let folderId = fresh?.driveFolderId ?? null;
    if (!folderId) {
      const changesFolder = await storage.ensureFolder(PC_PARENT_FOLDER, projectFolderId);
      folderId = await storage.ensureFolder(change.pcNumber, changesFolder);
      for (const child of PC_FOLDER_TREE) {
        await storage.ensureFolder(child, folderId);
      }
      await tx.potentialChange.update({
        where: { id: potentialChangeId },
        data: { driveFolderId: folderId },
      });
    }

    const evidenceFolderId = await storage.ensureFolder('Evidence', folderId);
    return { folderId, evidenceFolderId };
  });
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
  assertAcceptableFile(input.mimeType, input.content.byteLength);

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
        documentType: input.documentType ?? inferDocumentType(input.mimeType),
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

function inferDocumentType(mimeType: string): DocumentType {
  if (mimeType.startsWith('image/')) return 'site_photo';
  if (mimeType.startsWith('audio/')) return 'voice_note';
  if (mimeType === 'application/pdf') return 'drawing';
  return 'other';
}
