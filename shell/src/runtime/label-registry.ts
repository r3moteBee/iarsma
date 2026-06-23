import { KEY_RE } from './label-key';

export type LabelDef = {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly order: number;
};

export type LabelRegistry = {
  readonly version: 1;
  readonly labels: readonly LabelDef[];
};

export const MAX_LABELS = 200;
export const DEFAULT_LABEL_COLOR = '#ff6b35';

export const EMPTY_REGISTRY: LabelRegistry = { version: 1, labels: [] };

/** Stable serialization: labels sorted by order then key. */
export function serializeRegistry(r: LabelRegistry): string {
  const sorted = [...r.labels].sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.key.localeCompare(b.key),
  );
  return JSON.stringify({ version: 1, labels: sorted });
}

/** Tolerant parse: bad/empty/missing JSON → EMPTY_REGISTRY; drops malformed entries. */
export function parseRegistry(json: string): LabelRegistry {
  if (!json) return EMPTY_REGISTRY;

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return EMPTY_REGISTRY;
  }

  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).labels)
  ) {
    return EMPTY_REGISTRY;
  }

  const rawLabels = (raw as Record<string, unknown>).labels as unknown[];

  const labels: LabelDef[] = rawLabels
    .slice(0, MAX_LABELS)
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null,
    )
    .filter((entry) => {
      const key = entry.key;
      return typeof key === 'string' && KEY_RE.test(key);
    })
    .map((entry) => ({
      key: entry.key as string,
      name: typeof entry.name === 'string' ? entry.name : '',
      color:
        typeof entry.color === 'string' ? entry.color : DEFAULT_LABEL_COLOR,
      order:
        typeof entry.order === 'number'
          ? entry.order
          : Number(entry.order) || 0,
    }));

  return { version: 1, labels };
}
