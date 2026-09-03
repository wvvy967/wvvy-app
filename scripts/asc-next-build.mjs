#!/usr/bin/env node
/**
 * Print the build number to use for the next TestFlight upload.
 *
 * Build numbers are the one irreversible thing about an upload: App Store
 * Connect refuses a number it has already seen, refuses one below the highest
 * for that version, and a build can be expired but never deleted. CI sidesteps
 * the problem by using the workflow run number, which only ever climbs — but a
 * build made on a laptop knows nothing about that sequence, and a guess that
 * lands too high permanently strands every later CI upload of that version.
 *
 * So this asks. The answer is whatever App Store Connect already holds, plus
 * one, which is correct no matter which machine made the previous build.
 *
 *   node scripts/asc-next-build.mjs --bundle-id app.x [--version 1.2.0]
 *
 * Reads APPSTORE_KEY_ID, APPSTORE_ISSUER_ID and APPSTORE_PRIVATE_KEY_PATH from
 * the environment. Prints a single integer on stdout and nothing else, so it can
 * be captured directly by the shell.
 */

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API = 'https://api.appstoreconnect.apple.com/v1';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) die(`--${name} needs a value`);
  return value;
}

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * An App Store Connect API token: ES256, twenty minutes, audience fixed by Apple.
 *
 * `dsaEncoding: 'ieee-p1363'` is load-bearing — Node signs ECDSA in DER by
 * default, and JWT requires the raw r||s form. With DER, Apple answers 401 and
 * says nothing about why.
 */
async function token() {
  const keyId = process.env.APPSTORE_KEY_ID || die('APPSTORE_KEY_ID is not set');
  const issuerId = process.env.APPSTORE_ISSUER_ID || die('APPSTORE_ISSUER_ID is not set');
  const keyPath = process.env.APPSTORE_PRIVATE_KEY_PATH || die('APPSTORE_PRIVATE_KEY_PATH is not set');
  const privateKey = await readFile(keyPath, 'utf8').catch(() => die(`cannot read the App Store Connect key at ${keyPath}`));

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claims = { iss: issuerId, iat: issuedAt, exp: issuedAt + 1200, aud: 'appstoreconnect-v1' };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('SHA256').update(unsigned).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function get(jwt, path) {
  const response = await fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${jwt}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.errors?.[0]?.detail ?? JSON.stringify(body).slice(0, 300);
    die(`App Store Connect ${response.status} on /${path.replace(/\?.*/, '')}: ${detail}`);
  }
  return body;
}

const bundleId = arg('bundle-id') ?? die('--bundle-id is required');
const version = arg('version');
const jwt = await token();

const apps = await get(jwt, `apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
const app = apps.data?.[0];
if (!app) die(`no app with bundle id ${bundleId} on this App Store Connect account`);

/*
  Filtered to the marketing version when one was given, because the uniqueness
  rule is per version: 1.1.0 may start again at 1 even though 1.0.0 reached 40.
  Without a version this takes the highest build overall, which is always safe
  and occasionally higher than it strictly needs to be.
*/
const query = [`filter[app]=${app.id}`, 'sort=-version', 'limit=200', version ? `filter[preReleaseVersion.version]=${encodeURIComponent(version)}` : ''].filter(Boolean).join('&');
const builds = await get(jwt, `builds?${query}`);

// `version` on a build resource is the build number; Apple's naming, not ours.
const highest = (builds.data ?? []).reduce((max, build) => {
  const value = Number.parseInt(build.attributes?.version ?? '0', 10);
  return Number.isFinite(value) ? Math.max(max, value) : max;
}, 0);

process.stdout.write(String(highest + 1));
