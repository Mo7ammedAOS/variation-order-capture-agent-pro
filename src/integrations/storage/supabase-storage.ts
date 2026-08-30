import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/auth/supabase';
import { getEnv } from '@/lib/env';
import { IntegrationError, NotFoundError } from '@/lib/errors';
import type { StorageProvider, StoredFile, UploadInput } from '@/integrations/storage/provider';

/**
 * Supabase Storage.
 *
 * Files sit in the same project as the database, so one vendor holds both the
 * bytes and the index, and one backup regime covers both. That is the whole
 * reason it was chosen over a disk volume nothing backs up.
 *
 * ── The bucket MUST be private ─────────────────────────────────────────────
 * Reads go through `/api/documents/[id]/content`, which checks project access
 * first. A public bucket would make every object reachable by URL and route
 * around that check entirely, so `sourceUrl` is always null here: there is no
 * link to leak into the HTML. Signed URLs are deliberately not used either —
 * a signed URL outlives the permission that minted it.
 *
 * ── There are no folders ───────────────────────────────────────────────────
 * Object stores have keys, not directories. `ensureFolder` therefore creates
 * nothing and calls nothing; it derives a path prefix. That makes it perfectly
 * idempotent and free, which is the property `document.service` needs — the
 * advisory locks around it stay correct, they simply have less to protect.
 */

/** Object keys are safest as ASCII. Names stay in the database, not the key. */
function segment(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w.\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 120) || 'unnamed'
  );
}

function bucket() {
  return getEnv().SUPABASE_STORAGE_BUCKET;
}

function storage() {
  return createSupabaseAdminClient().storage.from(bucket());
}

export const supabaseStorageProvider: StorageProvider = {
  name: 'supabase',

  /**
   * Derives the prefix. Creates nothing — an object store has no empty folder,
   * and a placeholder file to fake one is litter that later listings trip over.
   */
  async ensureFolder(name: string, parentId: string): Promise<string> {
    const parent = parentId === 'root' ? '' : parentId;
    return parent ? `${parent}/${segment(name)}` : segment(name);
  },

  async upload(input: UploadInput): Promise<StoredFile> {
    const content = Buffer.from(input.content);

    // The UUID prefix, not the filename, is what makes the key unique. Two site
    // engineers both uploading IMG_0042.jpg must not collide, and `upsert` stays
    // false so a collision fails loudly rather than overwriting evidence.
    const key = `${input.folderId}/${randomUUID()}-${segment(input.name)}`;

    const { error } = await storage().upload(key, content, {
      contentType: input.mimeType,
      upsert: false,
    });
    if (error) {
      throw new IntegrationError(`Supabase Storage upload failed: ${error.message}`);
    }

    return {
      fileId: key,
      storagePath: key,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: content.byteLength,
      sourceUrl: null,
    };
  },

  async download(fileId: string) {
    const { data, error } = await storage().download(fileId);
    if (error || !data) {
      throw new NotFoundError('File not found in Supabase Storage');
    }

    return {
      content: Buffer.from(await data.arrayBuffer()),
      mimeType: data.type || 'application/octet-stream',
      name: fileId.split('/').pop() ?? fileId,
    };
  },

  /**
   * Moves to `.trash/`, never removes.
   *
   * Evidence is immutable — the same rule the local adapter keeps by renaming
   * to `.trashed`. A photograph that supported a claim must still exist after
   * someone tidies up.
   */
  async delete(fileId: string): Promise<void> {
    const { error } = await storage().move(fileId, `.trash/${fileId}`);
    if (error && !/not found/i.test(error.message)) {
      throw new IntegrationError(`Supabase Storage trash failed: ${error.message}`);
    }
  },
};
