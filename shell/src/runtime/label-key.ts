const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // runs of non-alnum → single _
    .replace(/^[_-]+|[_-]+$/g, '') // trim separators
    .slice(0, 63)
    .replace(/[_-]+$/g, ''); // re-trim if slice landed on a separator
}

export function mintLabelKey(
  name: string,
  existingKeys: readonly string[],
): string | null {
  const base = slugify(name);
  if (!base || !KEY_RE.test(base)) return null;
  const taken = new Set(existingKeys.map((k) => k.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`.slice(0, 63).replace(/[_-]+$/g, '');
    if (!taken.has(candidate)) return candidate;
  }
}

export { KEY_RE };
