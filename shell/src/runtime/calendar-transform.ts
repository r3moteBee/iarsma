/**
 * Pure mapping from an `event.list` item to the view's CalendarViewEvent.
 *
 * Extracted from App.tsx so it's unit-testable. U-6: the original inline
 * map dropped `location` entirely (CalendarViewEvent.location is a flat
 * string, but JSCalendar carries `locations` as a keyed map), so the
 * event detail view never showed a location.
 */

import type { CalendarViewEvent } from '../views/calendar-view.js';

/** Structural shape of an `event.list` item (mirrors the JMAP parse). */
export type EventListItemLike = {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly duration?: string;
  readonly description?: string;
  readonly locations?: Readonly<Record<string, { readonly name?: string }>>;
  readonly calendarIds?: Readonly<Record<string, boolean>>;
  readonly participants?: Readonly<
    Record<
      string,
      {
        readonly email: string;
        readonly name?: string;
        readonly roles?: Readonly<Record<string, boolean>>;
        readonly participationStatus?: string;
        readonly expectReply?: boolean;
      }
    >
  >;
};

/** First non-empty location name in the JSCalendar `locations` map. */
function primaryLocation(
  locations: EventListItemLike['locations'],
): string | undefined {
  if (locations === undefined) return undefined;
  for (const loc of Object.values(locations)) {
    if (loc.name !== undefined && loc.name.trim() !== '') return loc.name;
  }
  return undefined;
}

export function toCalendarViewEvent(
  evt: EventListItemLike,
  colorByCalId: ReadonlyMap<string, string | undefined>,
): CalendarViewEvent {
  const ids = evt.calendarIds;
  const calId =
    ids !== undefined ? Object.keys(ids).find((k) => ids[k] === true) : undefined;
  const color = calId !== undefined ? colorByCalId.get(calId) : undefined;
  // Flatten the JSCalendar participants map; alphabetic-by-email keeps
  // badge rendering stable across refreshes.
  const participants =
    evt.participants !== undefined
      ? Object.values(evt.participants)
          .map((p) => ({
            email: p.email,
            ...(p.name !== undefined ? { name: p.name } : {}),
            ...(p.roles !== undefined ? { roles: p.roles } : {}),
            ...(p.participationStatus !== undefined
              ? { participationStatus: p.participationStatus }
              : {}),
            ...(p.expectReply !== undefined ? { expectReply: p.expectReply } : {}),
          }))
          .sort((a, b) => a.email.localeCompare(b.email))
      : undefined;
  const location = primaryLocation(evt.locations);
  return {
    id: evt.id,
    title: evt.title,
    start: evt.start,
    ...(evt.duration !== undefined ? { duration: evt.duration } : {}),
    ...(evt.description !== undefined ? { description: evt.description } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(calId !== undefined ? { calendarId: calId } : {}),
    ...(color !== undefined ? { calendarColor: color } : {}),
    ...(participants !== undefined && participants.length > 0 ? { participants } : {}),
  };
}
