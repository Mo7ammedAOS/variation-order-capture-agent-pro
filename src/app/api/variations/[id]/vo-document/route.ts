import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { buildVariationOrderPdf } from '@/services/vo-document.service';
import { isAppError } from '@/lib/errors';

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
 * record carries `submittedValue` and `submittedAt`, the pricing behind an
 * approved change cannot be edited, and the copy that went to the client is
 * filed in `09 Variation Orders` by the approval that sent it.
 *
 * ── Access ─────────────────────────────────────────────────────────────────
 * Checked inside the builder, before a single fact is read. This document is
 * composed out of the client's name, the contract number, the full build-up
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
    const { pdf, reference } = await buildVariationOrderPdf(user, id);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // `inline`, so it opens in the browser's viewer. A QS checks it before
        // sending it, and forcing a download to do that is a wasted step.
        'Content-Disposition': `inline; filename="${reference}.pdf"`,
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
