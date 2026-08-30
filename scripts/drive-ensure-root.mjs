#!/usr/bin/env node
/**
 * Ensures the top-level Drive folder exists and prints its id.
 *
 * Ensure-shaped, not create-shaped: Drive permits duplicate names in one
 * folder, so a second run must find the first folder rather than making a
 * rival the app would then disagree with the database about.
 *
 * Reads credentials from the file named by TOKEN_FILE (mode 600, deleted by
 * the caller), never from arguments — arguments are visible in `ps`.
 */
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

const NAME = process.env.DRIVE_ROOT_NAME ?? 'VO Capture & Control';
const file = process.env.TOKEN_FILE;
if (!file) {
  console.error('TOKEN_FILE is not set');
  process.exit(1);
}

const out = readFileSync(file, 'utf8');
const pick = (key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();

const oauth = new google.auth.OAuth2(
  pick('GOOGLE_OAUTH_CLIENT_ID'),
  pick('GOOGLE_OAUTH_CLIENT_SECRET'),
);
oauth.setCredentials({ refresh_token: pick('GOOGLE_OAUTH_REFRESH_TOKEN') });
const drive = google.drive({ version: 'v3', auth: oauth });

const escaped = NAME.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const existing = await drive.files.list({
  q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`,
  fields: 'files(id)',
  pageSize: 1,
});

const found = existing.data.files?.[0]?.id;
if (found) {
  console.log(found);
} else {
  const created = await drive.files.create({
    requestBody: { name: NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  if (!created.data.id) {
    console.error('Drive did not return a folder id');
    process.exit(1);
  }
  console.log(created.data.id);
}
