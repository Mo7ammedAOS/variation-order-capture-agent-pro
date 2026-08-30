#!/usr/bin/env node
/**
 * Mints a Google Drive refresh token, once, on your own machine.
 *
 *   npm run drive:token
 *
 * Needed because `osmanflow.com` is a personal Gmail account. Shared Drives do
 * not exist there, so a service account cannot be used — it has no storage
 * quota of its own and uploads fail with `storageQuotaExceeded`. OAuth against
 * a real user is the only route, and the token it produces represents YOU.
 *
 * ── This is deliberately not the OAuth Playground ──────────────────────────
 * The Playground works, but it means pasting your client secret into someone
 * else's web page. This runs entirely on localhost: the secret never leaves
 * your machine, and Google redirects back here with the code.
 *
 * ── The token is a credential ──────────────────────────────────────────────
 * A refresh token grants ongoing access to the Drive of whoever consents. It
 * goes in .env.production (chmod 600, gitignored) and NOWHERE else. Never in
 * the repo, never in a message, never in a screenshot.
 *
 * It does not expire on a schedule, but it dies if you revoke access, change
 * the account password, or leave the OAuth app in "Testing" — Google expires
 * testing-mode refresh tokens after 7 days. Publish the consent screen.
 */

import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { google } from 'googleapis';

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/drive';

/**
 * Values may come from the environment, which is what makes this usable
 * non-interactively:
 *
 *   GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… npm run drive:token
 *
 * Prompting is the fallback. Piping answers into readline does NOT work — the
 * second question never resolves once stdin closes, and the script hangs with
 * an unsettled await rather than failing usefully.
 */
const envId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
const fromEnv = Boolean(envId && envSecret);

console.log(`
┌───────────────────────────────────────────────────────────────────────┐
│  Google Drive refresh token                                           │
└───────────────────────────────────────────────────────────────────────┘

Before you start, in console.cloud.google.com:

  1. Create a project, then enable the  Google Drive API
  2. OAuth consent screen → External → add YOUR OWN email as a test user,
     then PUBLISH it (testing-mode refresh tokens expire after 7 days)
  3. Credentials → Create OAuth client ID → type  Web application
  4. Under "Authorised redirect URIs" add exactly:

         ${REDIRECT_URI}

     Exactly. A trailing slash is a different URI and Google will refuse.
`);

let clientId = envId ?? '';
let clientSecret = envSecret ?? '';

if (fromEnv) {
  console.log('Using GOOGLE_OAUTH_CLIENT_ID / _SECRET from the environment.\n');
} else {
  if (!stdin.isTTY) {
    console.error(
      'Nothing to read: stdin is not a terminal and the environment holds no\n' +
        'credentials. Re-run as:\n\n' +
        '  GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… npm run drive:token\n',
    );
    process.exit(1);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  clientId = (await rl.question('Client ID:     ')).trim();
  clientSecret = (await rl.question('Client secret: ')).trim();
  rl.close();
}

if (!clientId || !clientSecret) {
  console.error('\nBoth values are required. Nothing was sent anywhere.');
  process.exit(1);
}

const oauth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const url = oauth.generateAuthUrl({
  // offline is what returns a refresh token at all; without it you get an
  // access token that dies in an hour and a server that stops working by lunch.
  access_type: 'offline',
  // Google returns a refresh token only on FIRST consent for a client. If you
  // have consented before, without this you get none and the cause is invisible.
  prompt: 'consent',
  scope: [SCOPE],
});

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const requested = new URL(req.url, `http://localhost:${PORT}`);
    if (requested.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }

    const error = requested.searchParams.get('error');
    const received = requested.searchParams.get('code');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>VO Capture &amp; Control</title>
       <body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">
         <h1 style="font-size:1.25rem">${error ? 'Consent refused' : 'Done'}</h1>
         <p>${error ? `Google returned: ${error}` : 'Token minted. Return to your terminal, and close this tab.'}</p>
       </body>`,
    );

    server.close();
    if (error) reject(new Error(`Consent refused: ${error}`));
    else if (received) resolve(received);
    else reject(new Error('Google redirected without a code'));
  });

  server.on('error', (err) => {
    reject(
      err.code === 'EADDRINUSE'
        ? new Error(`Port ${PORT} is busy. Close whatever holds it and retry.`)
        : err,
    );
  });

  server.listen(PORT, () => {
    console.log(`\nOpen this in the browser signed in to the RIGHT Google account:\n\n${url}\n`);
    console.log(`Waiting on ${REDIRECT_URI} …`);
  });
});

const { tokens } = await oauth.getToken(code);

if (!tokens.refresh_token) {
  console.error(`
No refresh token came back.

Google issues one only on first consent for a client. Revoke this app at
https://myaccount.google.com/permissions and run this again.`);
  process.exit(1);
}

// Confirm the token works and name the account, so a token minted while signed
// in to the wrong Google account is caught here rather than in production.
oauth.setCredentials(tokens);
const { data } = await google.drive({ version: 'v3', auth: oauth }).about.get({
  fields: 'user(emailAddress), storageQuota(limit, usage)',
});

const quota = data.storageQuota ?? {};
const gb = (bytes) => (Number(bytes) / 1024 ** 3).toFixed(1);

console.log(`
Authorised as:  ${data.user?.emailAddress ?? 'unknown'}
Drive storage:  ${quota.usage ? gb(quota.usage) : '?'} GB used${quota.limit ? ` of ${gb(quota.limit)} GB` : ''}

Add to .env.production on the VPS — never to the repo:

GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_OAUTH_CLIENT_ID=${clientId}
GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}
GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}

Then create a folder in that account's Drive to hold everything, and set
GOOGLE_DRIVE_ROOT_FOLDER_ID to the id — the tail of the folder's URL.

That storage is shared with Gmail and Photos on a personal account, so watch it.
`);
