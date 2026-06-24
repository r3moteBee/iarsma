/**
 * Label operations — orchestrates registry CRUD + JMAP keyword mutations.
 *
 * This module composes:
 *   - label-store: readRegistry / writeRegistry
 *   - label-key: mintLabelKey
 *   - label-registry: MAX_LABELS, DEFAULT_LABEL_COLOR
 *   - jmap-client: buildMailModifyRequest, makeError (keyword patches)
 *
 * It is consumed by jmapInvoker's switch cases for the five label.*
 * capabilities. All JMAP I/O that touches Email/query + Email/set for
 * keyword mutations lives here.
 */

import type { JmapClientOptions, Session } from './jmap-client.js';
import { buildMailModifyRequest } from './jmap-client.js';
import { readRegistry, writeRegistry } from './label-store.js';
import { MAX_LABELS, DEFAULT_LABEL_COLOR } from './label-registry.js';
import { mintLabelKey } from './label-key.js';
import type { LabelDef } from './label-registry.js';
import type { ToolError } from './types.js';

// ─── Public context type ──────────────────────────────────────────────────────

export type LabelOpsCtx = JmapClientOptions & {
  readonly session: Session;
};

// ─── Paging constants ─────────────────────────────────────────────────────────

/** Max emails to untag per JMAP batch. */
const UNTAG_BATCH_SIZE = 500;
/** Safety cap: no more than this many pages per untag sweep. */
const UNTAG_MAX_PAGES = 20_000; // 20 000 × 500 = 10 M messages max

// ─── label.list ───────────────────────────────────────────────────────────────

export type LabelListResult = { readonly labels: readonly LabelDef[] };

export async function labelList(ctx: LabelOpsCtx): Promise<LabelListResult> {
  const { registry } = await readRegistry({
    ...ctx,
    accountId: ctx.session.primaryAccountIdMail,
    apiUrl: ctx.session.apiUrl,
  });
  return { labels: registry.labels };
}

// ─── label.create ─────────────────────────────────────────────────────────────

export type LabelCreateParams = {
  readonly name: string;
  readonly color?: string;
};

export type LabelCreateResult = { readonly key: string };

export async function labelCreate(
  ctx: LabelOpsCtx,
  params: LabelCreateParams,
): Promise<LabelCreateResult> {
  const storeCtx = { ...ctx, accountId: ctx.session.primaryAccountIdMail, apiUrl: ctx.session.apiUrl };
  const { registry } = await readRegistry(storeCtx);

  if (registry.labels.length >= MAX_LABELS) {
    throw makeError(
      'label_limit_reached',
      "You've reached the maximum of 200 labels. Delete one to add another.",
    );
  }

  const existingKeys = registry.labels.map((l) => l.key);
  const key = mintLabelKey(params.name, existingKeys);
  if (key === null) {
    throw makeError('label_name_invalid', 'Enter a label name using letters or numbers.');
  }

  // Defensive guard: mintLabelKey auto-suffixes collisions so key===null is
  // the only normal failure path. If somehow the returned key is already
  // taken (shouldn't happen), surface a friendly conflict error.
  if (existingKeys.includes(key)) {
    throw makeError(
      'label_key_conflict',
      'A label with a similar name already exists. Pick a different name.',
    );
  }

  const nextOrder = registry.labels.length > 0
    ? Math.max(...registry.labels.map((l) => l.order)) + 1
    : 0;

  await writeRegistry(storeCtx, (r) => ({
    ...r,
    labels: [
      ...r.labels,
      {
        key,
        name: params.name,
        color: params.color ?? DEFAULT_LABEL_COLOR,
        order: nextOrder,
      },
    ],
  }));

  return { key };
}

// ─── label.update ─────────────────────────────────────────────────────────────

export type LabelUpdateParams = {
  readonly key: string;
  readonly name?: string;
  readonly color?: string;
  readonly order?: number;
};

export type LabelUpdateResult = { readonly updated: true };

export async function labelUpdate(
  ctx: LabelOpsCtx,
  params: LabelUpdateParams,
): Promise<LabelUpdateResult> {
  const storeCtx = { ...ctx, accountId: ctx.session.primaryAccountIdMail, apiUrl: ctx.session.apiUrl };
  const { registry } = await readRegistry(storeCtx);

  const existing = registry.labels.find((l) => l.key === params.key);
  if (existing === undefined) {
    const names = registry.labels.map((l) => l.name).join(', ');
    throw makeError(
      'label_not_found',
      `That label doesn't exist. Available labels: ${names}.`,
    );
  }

  // If renaming, validate the new name slugifies to something non-empty.
  if (params.name !== undefined) {
    const testKey = mintLabelKey(params.name, []);
    if (testKey === null) {
      throw makeError('label_name_invalid', 'Enter a label name using letters or numbers.');
    }
  }

  await writeRegistry(storeCtx, (r) => ({
    ...r,
    labels: r.labels.map((l) =>
      l.key === params.key
        ? {
            key: l.key, // key is IMMUTABLE — never change it
            name: params.name ?? l.name,
            color: params.color ?? l.color,
            order: params.order ?? l.order,
          }
        : l,
    ),
  }));

  return { updated: true };
}

// ─── label.delete ─────────────────────────────────────────────────────────────

export type LabelDeletePreview = { readonly affectedCount: number };
export type LabelDeleteResult = { readonly deleted: true; readonly untagged: number };

/**
 * Dry-run: returns the count of messages currently tagged with the label keyword.
 */
export async function labelDeletePreview(
  ctx: LabelOpsCtx,
  params: { readonly key: string },
): Promise<LabelDeletePreview> {
  const storeCtx = { ...ctx, accountId: ctx.session.primaryAccountIdMail, apiUrl: ctx.session.apiUrl };
  const { registry } = await readRegistry(storeCtx);

  const existing = registry.labels.find((l) => l.key === params.key);
  if (existing === undefined) {
    const names = registry.labels.map((l) => l.name).join(', ');
    throw makeError(
      'label_not_found',
      `That label doesn't exist. Available labels: ${names}.`,
    );
  }

  const count = await countEmailsWithKeyword(ctx, params.key);
  return { affectedCount: count };
}

/**
 * Commit: untag every message carrying the keyword (no-cap paging loop),
 * then remove the label from the registry.
 */
export async function labelDeleteCommit(
  ctx: LabelOpsCtx,
  params: { readonly key: string },
): Promise<LabelDeleteResult> {
  const storeCtx = { ...ctx, accountId: ctx.session.primaryAccountIdMail, apiUrl: ctx.session.apiUrl };
  const { registry } = await readRegistry(storeCtx);

  const existing = registry.labels.find((l) => l.key === params.key);
  if (existing === undefined) {
    const names = registry.labels.map((l) => l.name).join(', ');
    throw makeError(
      'label_not_found',
      `That label doesn't exist. Available labels: ${names}.`,
    );
  }

  // Untag all messages with the keyword — NO cap (paging until exhausted).
  const untagged = await untagAllWithKeyword(ctx, params.key);

  // Remove the entry from the registry.
  await writeRegistry(storeCtx, (r) => ({
    ...r,
    labels: r.labels.filter((l) => l.key !== params.key),
  }));

  return { deleted: true, untagged };
}

// ─── label.apply ──────────────────────────────────────────────────────────────

export type LabelApplyParams = {
  readonly emailIds: readonly string[];
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
};

export type LabelApplyPreview = { readonly affectedCount: number };
export type LabelApplyResult = { readonly modifiedCount: number };

/**
 * Dry-run: validate label references, return affectedCount = emailIds.length.
 */
export async function labelApplyPreview(
  ctx: LabelOpsCtx,
  params: LabelApplyParams,
): Promise<LabelApplyPreview> {
  const storeCtx = { ...ctx, accountId: ctx.session.primaryAccountIdMail, apiUrl: ctx.session.apiUrl };
  const { registry } = await readRegistry(storeCtx);

  resolveLabels(registry.labels, params.add ?? [], params.remove ?? []);

  return { affectedCount: params.emailIds.length };
}

/**
 * Commit: resolve label name/key references, apply keyword patch to emailIds.
 */
export async function labelApplyCommit(
  ctx: LabelOpsCtx,
  params: LabelApplyParams,
): Promise<LabelApplyResult> {
  const storeCtx = { ...ctx, accountId: ctx.session.primaryAccountIdMail, apiUrl: ctx.session.apiUrl };
  const { registry } = await readRegistry(storeCtx);

  const { addKeys, removeKeys } = resolveLabels(
    registry.labels,
    params.add ?? [],
    params.remove ?? [],
  );

  // Build the keyword patch: true = add, null = remove.
  const keywords: Record<string, true | null> = {};
  for (const key of addKeys) {
    keywords[key] = true;
  }
  for (const key of removeKeys) {
    keywords[key] = null;
  }

  const token = await ctx.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = ctx.fetch ?? fetch;
  const accountId = ctx.session.primaryAccountIdMail;
  const body = buildMailModifyRequest({
    accountId,
    params: {
      emailIds: params.emailIds,
      patch: { keywords },
    },
  });

  let response: Response;
  try {
    response = await fetchImpl(ctx.session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describeError(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP Email/set (label apply) returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseLabelApplyResponse(text);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Resolve a list of add/remove entries (which may be label names OR keys)
 * against the registry. Throws label_not_found (listing valid names) for
 * any unresolved entry.
 */
function resolveLabels(
  labels: readonly LabelDef[],
  add: readonly string[],
  remove: readonly string[],
): { addKeys: string[]; removeKeys: string[] } {
  const resolveOne = (entry: string): string => {
    // Try exact key match first, then name match.
    const byKey = labels.find((l) => l.key === entry);
    if (byKey !== undefined) return byKey.key;
    const byName = labels.find((l) => l.name === entry);
    if (byName !== undefined) return byName.key;
    const names = labels.map((l) => l.name).join(', ');
    throw makeError(
      'label_not_found',
      `That label doesn't exist. Available labels: ${names}.`,
    );
  };

  return {
    addKeys: add.map(resolveOne),
    removeKeys: remove.map(resolveOne),
  };
}

/**
 * Query how many messages currently carry the keyword.
 * Uses a single Email/query with limit=0 + calculateTotal=true.
 */
async function countEmailsWithKeyword(ctx: LabelOpsCtx, keyword: string): Promise<number> {
  const token = await ctx.getAuthToken();
  if (token === null) throw makeError('unauthorized', 'No auth token available.');
  const fetchImpl = ctx.fetch ?? fetch;
  const accountId = ctx.session.primaryAccountIdMail;

  const body = JSON.stringify({
    using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
    methodCalls: [
      [
        'Email/query',
        {
          accountId,
          filter: { hasKeyword: keyword },
          limit: 0,
          calculateTotal: true,
        },
        '0',
      ],
    ],
  });

  let response: Response;
  try {
    response = await fetchImpl(ctx.session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describeError(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP Email/query (count) returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError('jmap_parse_error', `Failed to parse Email/query count response: ${describeError(e)}`);
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError('jmap_parse_error', 'Email/query count: no methodResponses.');
  }
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) {
    throw makeError('jmap_parse_error', 'Email/query count: malformed methodResponse.');
  }
  const result = first[1] as { total?: unknown; ids?: unknown };
  if (typeof result.total === 'number') return result.total;
  // Fallback: count the ids array if total is not returned.
  return Array.isArray(result.ids) ? result.ids.length : 0;
}

/**
 * Page through ALL messages carrying the keyword and patch keywords/{key}: null
 * on each batch. Returns the total count of untagged messages.
 *
 * Loop contract (mirrors fetchMailboxDeleteCommit, NO 500-message cap):
 *   1. Email/query { filter: { hasKeyword: key }, limit: UNTAG_BATCH_SIZE }
 *   2. If ids.length === 0, done.
 *   3. Email/set { update: { [id]: { "keywords/key": null } } } for each id.
 *   4. If ids.length < UNTAG_BATCH_SIZE, done (partial page → drained).
 *   5. Repeat.
 */
async function untagAllWithKeyword(ctx: LabelOpsCtx, keyword: string): Promise<number> {
  const token = await ctx.getAuthToken();
  if (token === null) throw makeError('unauthorized', 'No auth token available.');
  const fetchImpl = ctx.fetch ?? fetch;
  const accountId = ctx.session.primaryAccountIdMail;

  let totalUntagged = 0;
  // Track whether the loop ended normally (empty query or partial page).
  // If false after the loop, we hit the UNTAG_MAX_PAGES ceiling.
  let drained = false;

  for (let page = 0; page < UNTAG_MAX_PAGES; page++) {
    // Step 1: Query for a batch of ids.
    const queryBody = JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [
        [
          'Email/query',
          {
            accountId,
            filter: { hasKeyword: keyword },
            limit: UNTAG_BATCH_SIZE,
          },
          '0',
        ],
      ],
    });

    let queryResponse: Response;
    try {
      queryResponse = await fetchImpl(ctx.session.apiUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: queryBody,
      });
    } catch (e) {
      throw makeError('network_error', `JMAP fetch failed: ${describeError(e)}`);
    }
    if (!queryResponse.ok) {
      throw makeError(
        queryResponse.status === 401 ? 'unauthorized' : 'jmap_http_error',
        `JMAP Email/query (untag) returned ${queryResponse.status} ${queryResponse.statusText}`,
      );
    }
    const queryText = await queryResponse.text();
    const ids = parseEmailQueryIds(queryText);

    // Step 2: If no ids, we're done — all messages untagged.
    if (ids.length === 0) {
      drained = true;
      break;
    }

    // Step 3: Patch keywords/{keyword}: null for this batch.
    const setBody = buildMailModifyRequest({
      accountId,
      params: {
        emailIds: ids,
        patch: { keywords: { [keyword]: null } },
      },
    });

    let setResponse: Response;
    try {
      setResponse = await fetchImpl(ctx.session.apiUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: setBody,
      });
    } catch (e) {
      throw makeError('network_error', `JMAP fetch failed: ${describeError(e)}`);
    }
    if (!setResponse.ok) {
      throw makeError(
        setResponse.status === 401 ? 'unauthorized' : 'jmap_http_error',
        `JMAP Email/set (untag) returned ${setResponse.status} ${setResponse.statusText}`,
      );
    }
    const setResponseText = await setResponse.text();
    const updatedCount = parseEmailSetUpdatedCount(setResponseText);

    // Step 4: Detect no-progress — the query returned ids to untag but
    // the set updated zero messages. Deleted messages drop out of the
    // next hasKeyword query naturally, so genuine zero progress is a
    // real server-side failure, not a race.
    if (updatedCount === 0) {
      throw makeError(
        'label_untag_failed',
        'Could not remove the label from some messages. Please try again.',
      );
    }

    totalUntagged += updatedCount;

    // Step 5: Partial page means we've drained all matching messages.
    if (ids.length < UNTAG_BATCH_SIZE) {
      drained = true;
      break;
    }
  }

  // If the loop exited without draining (ceiling hit with a full batch
  // still in progress), there are still messages tagged — fail loud.
  // Never silently report success on an incomplete untag.
  if (!drained) {
    throw makeError(
      'label_untag_failed',
      'Could not remove the label from some messages. Please try again.',
    );
  }

  return totalUntagged;
}

/**
 * Extract the `ids` array from an Email/query JMAP response.
 */
function parseEmailQueryIds(body: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) return [];
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) return [];
  const result = first[1] as { ids?: unknown };
  if (!Array.isArray(result.ids)) return [];
  return result.ids.filter((id): id is string => typeof id === 'string');
}

/**
 * Extract the count of ACTUALLY updated ids from an Email/set response.
 * Returns 0 if the response is malformed or the updated map is absent.
 * Used by the untag loop to count real progress (not just queried ids).
 */
function parseEmailSetUpdatedCount(body: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 0;
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) return 0;
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) return 0;
  const result = first[1] as { updated?: unknown };
  if (result.updated === null || typeof result.updated !== 'object') return 0;
  return Object.keys(result.updated as Record<string, unknown>).length;
}

/**
 * Parse an Email/set update response for label.apply. Returns modifiedCount.
 * Surfaces email_not_found when notUpdated contains entries.
 */
function parseLabelApplyResponse(body: string): LabelApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError('jmap_parse_error', `Failed to parse Email/set (label apply) response: ${describeError(e)}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Email/set (label apply) response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError('jmap_parse_error', 'Email/set (label apply) has no methodResponses.');
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'Email/set') {
    throw makeError('jmap_parse_error', 'First methodResponse is not Email/set.');
  }
  const result = first[1] as {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notUpdated !== undefined && Object.keys(result.notUpdated).length > 0) {
    throw makeError('email_not_found', 'One or more of those messages no longer exist.');
  }
  const updated = result.updated ?? {};
  return { modifiedCount: Object.keys(updated).length };
}

function makeError(code: string, message: string): ToolError {
  return { code, message };
}

function describeError(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
