/**
 * New-mail notification helpers (Phase 3c item 9).
 *
 * Push-driven updates:
 * - Tab title: "(N) Iarsma" when unread > 0
 * - Live region announcement: "New message from <sender>"
 * - Browser Notification (opt-in, not auto-prompted)
 */

let liveRegionEl: HTMLElement | null = null;

export function ensureLiveRegion(): HTMLElement {
  if (liveRegionEl !== null) return liveRegionEl;
  if (typeof document === 'undefined') {
    return { textContent: null } as unknown as HTMLElement;
  }
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('role', 'status');
  el.style.position = 'absolute';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.overflow = 'hidden';
  el.style.clip = 'rect(0,0,0,0)';
  document.body.appendChild(el);
  liveRegionEl = el;
  return el;
}

export function announceNewMail(sender: string): void {
  const el = ensureLiveRegion();
  el.textContent = `New message from ${sender}`;
}

/**
 * Count-based announce (Phase 3 #9). Push deltas don't tell us who
 * sent the new mail without a follow-up fetch, so the bare-minimum
 * announcement is the count change. Singular vs. plural matters for
 * screen reader prosody.
 */
export function announceUnreadDelta(delta: number): void {
  if (delta <= 0) return;
  const el = ensureLiveRegion();
  el.textContent =
    delta === 1
      ? '1 new message in Inbox.'
      : `${delta} new messages in Inbox.`;
}

export function updateTabTitle(unreadCount: number): void {
  if (typeof document === 'undefined') return;
  document.title = unreadCount > 0 ? `(${unreadCount}) Iarsma` : 'Iarsma';
}

export async function sendBrowserNotification(opts: {
  readonly sender: string;
  readonly subject: string;
}): Promise<void> {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  new Notification(`New mail from ${opts.sender}`, {
    body: opts.subject,
    tag: 'iarsma-new-mail',
  });
}
