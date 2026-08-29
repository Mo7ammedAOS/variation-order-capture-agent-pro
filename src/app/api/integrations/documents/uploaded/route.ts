import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { NotFoundError } from '@/lib/errors';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { checkRateLimit, INTEGRATION_RATE_LIMIT } from '@/lib/rate-limit';
import { documentUploadedSchema } from '@/app/api/integrations/schemas';
import { processOnce } from '@/services/integration.service';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/services/audit-log.service';

export const dynamic = 'force-dynamic';

/**
 * Lane C. A file appeared in watched storage; n8n tells us about it.
 *
 * This registers METADATA. The bytes stay where they are — we record the id and
 * the link, and the authenticated proxy is what serves them. Copying every
 * watched file into our own store would duplicate the client's document control
 * and immediately drift from it.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);

    checkRateLimit('integration:documents', INTEGRATION_RATE_LIMIT);

    const payload = documentUploadedSchema.parse(JSON.parse(raw));

    const outcome = await processOnce('document_upload', payload.idempotency_key, payload, async () => {
      const project = await prisma.project.findUnique({
        where: { projectCode: payload.project_code.toUpperCase() },
        select: { id: true },
      });
      if (!project) throw new NotFoundError(`No project with code ${payload.project_code}`);

      return prisma.$transaction(async (tx) => {
        const document = await tx.projectDocument.create({
          data: {
            projectId: project.id,
            documentType: payload.document_type,
            documentName: payload.document_name,
            documentNumber: payload.document_number ?? null,
            revisionNumber: payload.revision_number ?? null,
            sourceUrl: payload.source_url ?? null,
            driveFileId: payload.external_file_id ?? null,
            sourceChannel: 'document_upload',
          },
        });

        await recordAudit({
          db: tx,
          projectId: project.id,
          recordType: 'project_document',
          recordId: document.id,
          actionType: 'created',
          newValue: { documentName: document.documentName },
          source: 'n8n',
        });

        return { documentId: document.id, projectId: project.id };
      });
    });

    return NextResponse.json(
      { duplicate: outcome.duplicate, event_id: outcome.eventId, result: outcome.result },
      { status: outcome.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
