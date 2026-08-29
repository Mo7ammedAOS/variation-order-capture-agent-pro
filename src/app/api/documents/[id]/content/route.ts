import { withAuth } from '@/lib/api';
import { readDocumentContent } from '@/services/document.service';

export const dynamic = 'force-dynamic';

/**
 * The ONLY way a file reaches a browser.
 *
 * Access is checked, then the bytes are fetched. A Drive `webViewLink` in the
 * HTML would route around every access rule in the system — anyone with the URL
 * would have the file, forever, regardless of which projects they are on.
 *
 * `Content-Disposition: inline` so a site photo previews rather than downloading,
 * and `X-Content-Type-Options: nosniff` so an uploaded file cannot talk a
 * browser into executing it.
 */
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) => {
  const file = await readDocumentContent(user, params.id);

  return new Response(new Uint8Array(file.content), {
    headers: {
      'content-type': file.mimeType,
      'content-length': String(file.content.byteLength),
      'content-disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});
