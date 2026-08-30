import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { getEnv } from '@/lib/env';
import { IntegrationError } from '@/lib/errors';
import type { StorageProvider, StoredFile, UploadInput } from '@/integrations/storage/provider';

/**
 * Google Drive storage.
 *
 * TWO AUTH MODES, because which one is available depends on the Google account:
 *
 *   service_account   Needs a SHARED DRIVE. A service account has no Drive
 *                     storage quota of its own, so uploading into a My Drive
 *                     folder merely *shared* with it fails with
 *                     `storageQuotaExceeded`. Shared Drives require Workspace.
 *
 *   oauth             A refresh token for a real user. The only option on a
 *                     personal @gmail.com account, where Shared Drives do not
 *                     exist. Files are owned by that user.
 *
 * Every call passes `supportsAllDrives`, which is required for Shared Drives
 * and harmless otherwise.
 */

const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let client: drive_v3.Drive | undefined;

function getDrive(): drive_v3.Drive {
  if (client) return client;
  const env = getEnv();

  if (env.GOOGLE_DRIVE_AUTH_MODE === 'service_account') {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      throw new IntegrationError('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    }
    let credentials: { client_email: string; private_key: string };
    try {
      credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as typeof credentials;
    } catch {
      throw new IntegrationError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      // Keys pasted into an env var arrive with literal \n sequences.
      key: credentials.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    client = google.drive({ version: 'v3', auth });
    return client;
  }

  const missing = (
    [
      ['GOOGLE_OAUTH_CLIENT_ID', env.GOOGLE_OAUTH_CLIENT_ID],
      ['GOOGLE_OAUTH_CLIENT_SECRET', env.GOOGLE_OAUTH_CLIENT_SECRET],
      ['GOOGLE_OAUTH_REFRESH_TOKEN', env.GOOGLE_OAUTH_REFRESH_TOKEN],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new IntegrationError(
      `GOOGLE_DRIVE_AUTH_MODE=oauth requires ${missing.join(', ')}. ` +
        'Mint a refresh token with `npm run drive:token` — see DEPLOYMENT_GUIDE.md.',
    );
  }

  const oauth = new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  client = google.drive({ version: 'v3', auth: oauth });
  return client;
}

/** Drive query strings are not parameterised, so single quotes must be escaped. */
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export const googleDriveProvider: StorageProvider = {
  name: 'google_drive',

  async ensureFolder(name: string, parentId: string): Promise<string> {
    const drive = getDrive();
    const safeName = escapeQueryValue(name);

    const existing = await drive.files.list({
      q: `name = '${safeName}' and '${escapeQueryValue(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const found = existing.data.files?.[0]?.id;
    if (found) return found;

    const created = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    });

    const id = created.data.id;
    if (!id) throw new IntegrationError(`Drive did not return an id for folder "${name}"`);
    return id;
  },

  async upload(input: UploadInput): Promise<StoredFile> {
    const drive = getDrive();
    const buffer = Buffer.from(input.content);

    try {
      const response = await drive.files.create(
        {
          requestBody: { name: input.name, parents: [input.folderId] },
          media: { mimeType: input.mimeType, body: Readable.from(buffer) },
          fields: 'id, name, mimeType, size, webViewLink',
          supportsAllDrives: true,
        },
        // Anything sizeable goes up resumably, so a dropped connection on a
        // site photo over mobile data does not mean starting again.
        buffer.byteLength > RESUMABLE_THRESHOLD_BYTES
          ? { onUploadProgress: () => undefined }
          : undefined,
      );

      const file = response.data;
      if (!file.id) throw new IntegrationError('Drive did not return a file id');

      return {
        fileId: file.id,
        storagePath: `${input.folderId}/${file.id}`,
        name: file.name ?? input.name,
        mimeType: file.mimeType ?? input.mimeType,
        sizeBytes: file.size ? Number(file.size) : buffer.byteLength,
        sourceUrl: file.webViewLink ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('storageQuotaExceeded')) {
        throw new IntegrationError(
          'Drive rejected the upload for lack of quota. A service account has no ' +
            'storage of its own — the target must be a Shared Drive, or switch ' +
            'GOOGLE_DRIVE_AUTH_MODE to oauth. See DEPLOYMENT_GUIDE.md.',
        );
      }
      throw new IntegrationError(`Drive upload failed: ${message}`);
    }
  },

  async download(fileId: string) {
    const drive = getDrive();

    const meta = await drive.files.get({
      fileId,
      fields: 'name, mimeType',
      supportsAllDrives: true,
    });

    const response = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );

    return {
      content: Buffer.from(response.data as ArrayBuffer),
      mimeType: meta.data.mimeType ?? 'application/octet-stream',
      name: meta.data.name ?? fileId,
    };
  },

  async delete(fileId: string): Promise<void> {
    // Trashed, not purged. Evidence is never destroyed by the application.
    await getDrive().files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  },
};
