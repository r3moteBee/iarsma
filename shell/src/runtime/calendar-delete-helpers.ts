export function resolveCalendarDeleteState(input: {
  readonly refusal: 'not_empty' | null;
  readonly error: string | null;
}): { mode: 'light' | 'typed'; errorMsg?: string } {
  const mode = input.refusal === 'not_empty' ? 'typed' : 'light';
  return input.error !== null ? { mode, errorMsg: input.error } : { mode };
}
