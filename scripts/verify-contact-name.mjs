#!/usr/bin/env node
/**
 * U-2 live round-trip check — proves what Stalwart actually stores for a
 * contact name when we send the FN-derived JSContact shape that
 * `normalizeContactName` (shell/src/runtime/jmap-client.ts) produces.
 *
 * It creates a throwaway contact, reads it back, prints the stored `name`,
 * then destroys it. Read-only to your real data apart from the temp card
 * (which it removes).
 *
 * Auth (pick one):
 *   IARSMA_BEARER="<oauth access token>"
 *   IARSMA_BASIC="admin@tuatha.ai:<app-password>"
 *
 * Endpoint (pick one):
 *   IARSMA_SESSION_URL="https://sw-mail.r3motely.net/.well-known/jmap"
 *   IARSMA_BASE="https://sw-mail.r3motely.net"   # we append /.well-known/jmap
 *
 * Run:  node scripts/verify-contact-name.mjs
 */

const base = process.env.IARSMA_BASE;
const sessionUrl =
  process.env.IARSMA_SESSION_URL ??
  (base ? `${base.replace(/\/$/, '')}/.well-known/jmap` : undefined);

if (!sessionUrl) {
  console.error('Set IARSMA_SESSION_URL or IARSMA_BASE. See header of this file.');
  process.exit(2);
}

function authHeader() {
  if (process.env.IARSMA_BEARER) return `Bearer ${process.env.IARSMA_BEARER}`;
  if (process.env.IARSMA_BASIC) {
    return `Basic ${Buffer.from(process.env.IARSMA_BASIC).toString('base64')}`;
  }
  console.error('Set IARSMA_BEARER or IARSMA_BASIC.');
  process.exit(2);
}

const headers = {
  Authorization: authHeader(),
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'];

async function jmap(apiUrl, methodCalls) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ using: USING, methodCalls }),
  });
  if (!res.ok) {
    throw new Error(`JMAP ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const session = await fetch(sessionUrl, { headers }).then((r) => {
    if (!r.ok) throw new Error(`session ${r.status} ${r.statusText}`);
    return r.json();
  });
  const apiUrl = session.apiUrl;
  const accountId =
    session.primaryAccounts?.['urn:ietf:params:jmap:contacts'] ??
    session.primaryAccounts?.['urn:ietf:params:jmap:core'];
  if (!apiUrl || !accountId) throw new Error('Could not resolve apiUrl/accountId from session');
  console.log(`apiUrl=${apiUrl}\naccountId=${accountId}`);

  // Find an address book to file the card under.
  const abResp = await jmap(apiUrl, [['AddressBook/get', { accountId }, '0']]);
  const addressBookId = abResp.methodResponses?.[0]?.[1]?.list?.[0]?.id;
  console.log(`addressBookId=${addressBookId ?? '(none — will create without)'}`);

  // The exact shape normalizeContactName produces for given+surname:
  const card = {
    '@type': 'Card',
    name: { full: 'Testy McTester', given: 'Testy', surname: 'McTester' },
    emails: { e0: { address: 'u2-roundtrip@example.invalid' } },
    ...(addressBookId ? { addressBookIds: { [addressBookId]: true } } : {}),
  };

  const created = await jmap(apiUrl, [
    ['ContactCard/set', { accountId, create: { c0: card } }, '0'],
  ]);
  const setRes = created.methodResponses?.[0]?.[1];
  const id = setRes?.created?.c0?.id;
  if (!id) {
    console.error('CREATE FAILED:', JSON.stringify(setRes, null, 2));
    process.exit(1);
  }
  console.log(`\ncreated card id=${id}`);

  const got = await jmap(apiUrl, [
    [
      'ContactCard/get',
      { accountId, ids: [id], properties: ['id', 'name', 'emails'] },
      '0',
    ],
  ]);
  const stored = got.methodResponses?.[0]?.[1]?.list?.[0];
  console.log('\n=== STORED name (what Stalwart kept) ===');
  console.log(JSON.stringify(stored?.name, null, 2));

  // Cleanup.
  await jmap(apiUrl, [['ContactCard/set', { accountId, destroy: [id] }, '0']]);
  console.log(`\ncleaned up card id=${id}`);

  const fullOk = stored?.name?.full === 'Testy McTester';
  const partsOk = stored?.name?.given === 'Testy' && stored?.name?.surname === 'McTester';
  console.log(
    `\nVERDICT: full ${fullOk ? 'PERSISTED ✓' : 'MISSING ✗'}; ` +
      `given/surname ${partsOk ? 'PERSISTED ✓' : 'dropped (full alone will still display)'}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
