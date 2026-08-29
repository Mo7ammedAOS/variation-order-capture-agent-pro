import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '@/lib/env';
import { NotFoundError } from '@/lib/errors';
import type { StorageProvider, StoredFile, UploadInput } from '@/integrations/storage/provider';

/**
 * Local disk storage. Used by the tests and by anyone running the app without
 * Google credentials, so the capture flow is exercisable end to end offline.
 *
 * `ensureFolder` is idempotent through a deterministic id — the same name under
 * the same parent always resolves to the same directory, so the concurrency
 * test that covers the Drive adapter covers this one too.
 */

function folderId(name: string, parentId: string): string {
  return createHash('sha1').update(`${parentId}/${name}`).digest('hex').slice(0, 24);
}

function rootDir(): string {
  return path.resolve(getEnv().LOCAL_STORAGE_ROOT);
}

export const localDiskProvider: StorageProvider = {
  name: 'local',

  async ensureFolder(name: string, parentId: string): Promise<string> {
    const id = folderId(name, parentId);
    const dir = path.join(rootDir(), id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '.folder'), JSON.stringify({ name, parentId }), 'utf8');
    return id;
  },

  async upload(input: UploadInput): Promise<StoredFile> {
    const dir = path.join(rootDir(), input.folderId);
    await mkdir(dir, { recursive: true });

    const fileId = randomUUID();
    const target = path.join(dir, fileId);

    // Write then rename, so a reader never sees a half-written file.
    const temp = `${target}.partial`;
    await writeFile(temp, Buffer.from(input.content));
    await rename(temp, target);
    await writeFile(
      `${target}.meta.json`,
      JSON.stringify({ name: input.name, mimeType: input.mimeType }),
      'utf8',
    );

    return {
      fileId,
      storagePath: path.join(input.folderId, fileId),
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: Buffer.from(input.content).byteLength,
      sourceUrl: null,
    };
  },

  async download(fileId: string) {
    const found = await findFile(fileId);
    if (!found) throw new NotFoundError('File not found in local storage');

    const [content, rawMeta] = await Promise.all([
      readFile(found),
      readFile(`${found}.meta.json`, 'utf8').catch(() => '{}'),
    ]);
    const meta = JSON.parse(rawMeta) as { name?: string; mimeType?: string };

    return {
      content,
      mimeType: meta.mimeType ?? 'application/octet-stream',
      name: meta.name ?? fileId,
    };
  },

  async delete(fileId: string): Promise<void> {
    const found = await findFile(fileId);
    if (!found) return;
    await rename(found, `${found}.trashed`);
  },
};

async function findFile(fileId: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  const root = rootDir();
  let folders: string[];
  try {
    folders = await readdir(root);
  } catch {
    return null;
  }
  for (const folder of folders) {
    const candidate = path.join(root, folder, fileId);
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
