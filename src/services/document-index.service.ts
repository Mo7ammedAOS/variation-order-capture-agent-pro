import 'server-only';
import { randomUUID } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEmbeddingProvider } from '@/integrations/embeddings';
import { chunkText, extractText, isIndexable } from '@/lib/text-extract';
import { toVectorLiteral } from '@/services/search.service';
import { getStorageProvider } from '@/integrations/storage';

/**
 * The commercial documents, made searchable by meaning.
 *
 * ── What gets indexed, and what deliberately does not ──────────────────────
 * Contract, BOQ, rates, specification, programme. These are the documents that
 * answer "is this already in our scope, and is there a rate for it?" — the
 * question a QS answers by hand today, and the one worth automating.
 *
 * Drawings, photos, RFIs and correspondence are NOT indexed. They are evidence:
 * stored, served, never read. Osman was explicit, and it is the honest line —
 * reading a drawing properly is a different product, not a feature.
 *
 * ── Why the search is always scoped to one project ─────────────────────────
 * An unscoped similarity search would surface one client's contract inside
 * another client's screen. That is the single rule this product cannot break,
 * and it is enforced in the WHERE clause, before the vector comparison.
 */

/** Documents worth reading. Everything else is evidence. */
export const INDEXED_DOCUMENT_TYPES: DocumentType[] = [
  'contract',
  'boq',
  'specification',
  'programme',
];

export function shouldIndex(documentType: DocumentType, mimeType: string | null): boolean {
  return INDEXED_DOCUMENT_TYPES.includes(documentType) && isIndexable(mimeType);
}

export interface IndexResult {
  documentId: string;
  chunks: number;
  skipped?: string;
}

/**
 * Reads a stored document and writes its chunks into the vector table.
 *
 * Safe to run again: the old chunks are deleted first, so re-indexing after a
 * revision replaces rather than accumulates. Two copies of a superseded BOQ
 * would both answer a search, and the wrong one would sometimes win.
 */
export async function indexDocument(documentId: string): Promise<IndexResult> {
  const document = await prisma.projectDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true, projectId: true, documentName: true, documentType: true,
      mimeType: true, driveFileId: true, storagePath: true,
    },
  });
  if (!document) return { documentId, chunks: 0, skipped: 'Document not found' };

  if (!shouldIndex(document.documentType, document.mimeType)) {
    return { documentId, chunks: 0, skipped: 'Not a document type we read' };
  }

  const fileId = document.driveFileId ?? document.storagePath;
  if (!fileId) return { documentId, chunks: 0, skipped: 'No stored file' };

  const stored = await getStorageProvider().download(fileId);
  const { text } = await extractText(
    stored.content,
    document.mimeType ?? stored.mimeType,
    document.documentName,
  );

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { documentId, chunks: 0, skipped: 'No readable text — probably a scan' };
  }

  const provider = getEmbeddingProvider();

  // Embed before touching the table. If the model fails halfway, the previous
  // index is still there and still answering; wiping first would leave the
  // project silently unsearchable.
  const embedded: { index: number; content: string; literal: string; model: string; dims: number }[] = [];
  for (const [index, content] of chunks.entries()) {
    const { vector, model, dims } = await provider.embed(content);
    embedded.push({ index, content, literal: toVectorLiteral(vector), model, dims });
  }

  await prisma.$transaction(async (tx) => {
    await tx.documentChunk.deleteMany({ where: { documentId: document.id } });
    for (const chunk of embedded) {
      await tx.$executeRaw`
        INSERT INTO document_chunks
          (id, project_id, document_id, chunk_index, content, embedding, embedding_model, embedding_dims, created_at)
        VALUES
          (${randomUUID()}::uuid, ${document.projectId}::uuid, ${document.id}::uuid,
           ${chunk.index}, ${chunk.content}, ${chunk.literal}::vector,
           ${chunk.model}, ${chunk.dims}, NOW())
      `;
    }
  });

  return { documentId, chunks: embedded.length };
}

export interface ScopeMatch {
  documentId: string;
  documentName: string;
  documentType: DocumentType;
  chunkIndex: number;
  excerpt: string;
  similarity: number;
}

/** Below this, a "match" is noise, and noise teaches people to ignore the panel. */
const MATCH_FLOOR = 0.45;

/**
 * Asks the project's own documents whether a captured change is already covered.
 *
 * Returns evidence, never a verdict. "BOQ page 14 says this" is useful; "this
 * is not a variation" is a decision, and decisions belong to the QS. A model
 * that closes claims would eventually close a real one.
 */
export async function findScopeMatches(
  projectId: string,
  text: string,
  limit = 5,
): Promise<ScopeMatch[]> {
  const clean = text.trim();
  if (clean.length < 12) return [];

  const { vector } = await getEmbeddingProvider().embed(clean);
  const literal = toVectorLiteral(vector);

  // project_id in the WHERE clause, before the comparison. Not a filter applied
  // afterwards — that would still have searched everything.
  const rows = await prisma.$queryRaw<
    {
      document_id: string; document_name: string; document_type: string;
      chunk_index: number; content: string; similarity: number;
    }[]
  >`
    SELECT c.document_id, d.document_name, d.document_type::text AS document_type,
           c.chunk_index, c.content, 1 - (c.embedding <=> ${literal}::vector) AS similarity
      FROM document_chunks c
      JOIN project_documents d ON d.id = c.document_id
     WHERE c.project_id = ${projectId}::uuid
     ORDER BY c.embedding <=> ${literal}::vector
     LIMIT ${limit}
  `;

  return rows
    .map((row) => ({
      documentId: row.document_id,
      documentName: row.document_name,
      documentType: row.document_type as DocumentType,
      chunkIndex: row.chunk_index,
      excerpt: row.content.length > 400 ? `${row.content.slice(0, 400).trimEnd()}…` : row.content,
      similarity: Number(row.similarity),
    }))
    .filter((match) => match.similarity >= MATCH_FLOOR);
}

/** How much of a project's library is actually searchable. */
export async function indexStatus(projectId: string) {
  const [documents, chunks] = await Promise.all([
    prisma.projectDocument.findMany({
      where: { projectId, documentType: { in: INDEXED_DOCUMENT_TYPES } },
      select: { id: true, documentName: true, documentType: true, mimeType: true,
                _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.documentChunk.count({ where: { projectId } }),
  ]);

  return {
    totalChunks: chunks,
    documents: documents.map((d) => ({
      id: d.id,
      name: d.documentName,
      type: d.documentType,
      chunks: d._count.chunks,
      indexed: d._count.chunks > 0,
    })),
  };
}
