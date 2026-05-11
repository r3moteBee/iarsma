/**
 * Recipient-list parser for the compose UI (Phase 2 work item 4).
 *
 * Accepts a comma-separated list and parses each entry as either:
 *   - `Name <email@host>` → `{ name: "Name", email: "email@host" }`
 *   - `email@host`         → `{ email: "email@host" }`
 *
 * Empty entries (whitespace between commas) are dropped. Entries that
 * fail the minimal `<contains an `@`>` shape check are returned in the
 * `errors` array so the UI can render them as form errors before
 * save / send.
 *
 * Not RFC 5322-compliant — Phase 2 is plain text + a sanity check;
 * a richer chip-based recipient input lands in a future polish pass.
 */

export type ParsedRecipient = {
  readonly name?: string;
  readonly email: string;
};

export type RecipientParseResult = {
  readonly recipients: ParsedRecipient[];
  /** Raw text entries that failed validation. */
  readonly errors: string[];
};

const NAME_EMAIL_RE = /^\s*([^<]+?)\s*<\s*([^>\s]+)\s*>\s*$/;

export function parseRecipients(input: string): RecipientParseResult {
  if (input.trim() === '') {
    return { recipients: [], errors: [] };
  }
  const recipients: ParsedRecipient[] = [];
  const errors: string[] = [];
  for (const raw of input.split(',')) {
    const piece = raw.trim();
    if (piece === '') continue;
    const m = NAME_EMAIL_RE.exec(piece);
    if (m !== null) {
      const name = m[1]!.trim();
      const email = m[2]!.trim();
      if (!isValidEmail(email)) {
        errors.push(piece);
        continue;
      }
      recipients.push(name !== '' ? { name, email } : { email });
      continue;
    }
    // No `Name <addr>` shape — treat as bare email.
    if (!isValidEmail(piece)) {
      errors.push(piece);
      continue;
    }
    recipients.push({ email: piece });
  }
  return { recipients, errors };
}

/** Render a recipient list back into a string for the text-input value. */
export function formatRecipients(
  list: ReadonlyArray<ParsedRecipient> | undefined,
): string {
  if (list === undefined || list.length === 0) return '';
  return list
    .map((r) => (r.name !== undefined ? `${r.name} <${r.email}>` : r.email))
    .join(', ');
}

function isValidEmail(s: string): boolean {
  // Bare minimum sanity check: one `@` not at the start or end, and
  // something on either side. The JMAP server / SMTP relay does the
  // real validation; this prevents obvious typos from slipping past
  // the save-on-blur path.
  const at = s.indexOf('@');
  return at > 0 && at < s.length - 1 && !s.includes(' ');
}
