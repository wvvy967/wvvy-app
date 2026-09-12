#!/usr/bin/env node
/**
 * Upload an AAB to Google Play, or ask Play what version code to use next.
 *
 * CI does this with the r0adkll/upload-google-play action. There is no local
 * equivalent of a GitHub Action, and the alternatives — fastlane's `supply`, or
 * the googleapis package — mean a Ruby toolchain or a large dependency in an app
 * that otherwise has none. The Play Developer API is four HTTP calls behind a
 * signed JWT, all of which Node can do unaided, so this does that instead.
 *
 *   node scripts/play-upload.mjs --package app.x --json-key key.json --aab app.aab --track internal
 *   node scripts/play-upload.mjs --package app.x --json-key key.json --print-next-code
 *
 * The service account needs the "Release apps to testing tracks" permission on
 * the app in the Play Console.
 */

import { createSign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) die(`--${name} needs a value`);
  return value;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * A service-account access token, via the JWT bearer flow.
 *
 * Scoped to androidpublisher alone: this key can ship a release, and that is all
 * it should be able to do if it ever leaks.
 */
async function accessToken(keyPath) {
  const raw = await readFile(keyPath, 'utf8').catch(() => die(`cannot read the service account key at ${keyPath}`));
  const key = JSON.parse(raw);
  if (!key.client_email || !key.private_key) die(`${keyPath} is not a service account key (no client_email/private_key)`);

  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600
  };
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  });
  const body = await response.json();
  if (!response.ok) die(`Google refused the service account key: ${body.error_description ?? JSON.stringify(body)}`);
  return body.access_token;
}

async function call(token, url, { method = 'GET', body, headers = {}, duplex } = {}) {
  // `duplex: 'half'` is required by fetch whenever the body is a stream rather
  // than a buffer, and is what lets the AAB upload without being read into
  // memory first.
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body, ...(duplex ? { duplex } : {}) });
  const text = await response.text();
  if (!response.ok) die(`${method} ${url.replace(/\?.*/, '')} → ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/*
  An edit is a transaction: nothing you do inside one is visible until it is
  committed, and an abandoned one changes nothing. That is what makes it safe to
  open one just to read the list of uploaded bundles.
*/
async function withEdit(token, pkg, fn) {
  const edit = await call(token, `${API}/${pkg}/edits`, { method: 'POST' });
  try {
    const result = await fn(edit.id);
    return result;
  } catch (error) {
    await call(token, `${API}/${pkg}/edits/${edit.id}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

async function nextVersionCode(token, pkg) {
  return withEdit(token, pkg, async (editId) => {
    const { bundles = [] } = await call(token, `${API}/${pkg}/edits/${editId}/bundles`);
    const highest = bundles.reduce((max, bundle) => Math.max(max, bundle.versionCode ?? 0), 0);
    await call(token, `${API}/${pkg}/edits/${editId}`, { method: 'DELETE' }).catch(() => {});
    return highest + 1;
  });
}

const pkg = arg('package') ?? die('--package is required');
const keyPath = arg('json-key') ?? die('--json-key is required');
const token = await accessToken(keyPath);

if (flag('print-next-code')) {
  process.stdout.write(String(await nextVersionCode(token, pkg)));
  process.exit(0);
}

const aabPath = arg('aab') ?? die('--aab is required');
const track = arg('track', 'internal');
const releaseName = arg('release-name');
const { size } = await stat(aabPath).catch(() => die(`no such file: ${aabPath}`));

await withEdit(token, pkg, async (editId) => {
  console.log(`Uploading ${aabPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  // Streamed rather than read into memory: an AAB is tens of megabytes and there
  // is no reason to hold all of it at once.
  const uploaded = await call(token, `${UPLOAD_API}/${pkg}/edits/${editId}/bundles?uploadType=media`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
    body: createReadStream(aabPath),
    duplex: 'half'
  });
  console.log(`Uploaded version code ${uploaded.versionCode}`);

  await call(token, `${API}/${pkg}/edits/${editId}/tracks/${track}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      track,
      releases: [{ versionCodes: [String(uploaded.versionCode)], status: 'completed', ...(releaseName ? { name: releaseName } : {}) }]
    })
  });

  await call(token, `${API}/${pkg}/edits/${editId}:commit`, { method: 'POST' });
  console.log(`Released to ${track}`);
});
