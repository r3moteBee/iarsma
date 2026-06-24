/**
 * CalendarView — responsive calendar UI with month/week/day views.
 *
 * Purely presentational — receives events as props and delegates all
 * navigation/view changes to callback props. Data fetching is wired
 * in the integration layer.
 *
 * Keyboard shortcuts (when calendar is focused):
 *   - Arrow left/right: previous/next day (or week/month)
 *   - t: jump to today
 *   - m: switch to month view
 *   - w: switch to week view
 *   - d: switch to day view
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog } from '../components/index.js';
import { MenuButton } from '../components/menu-button.js';
import { SegmentedControl, type SegmentedOption } from '../components/segmented-control.js';
import styles from './calendar-view.module.css';

// ── Types ─────────────────────────────────────────────────────────

export type CalendarViewEvent = {
  readonly id: string;
  readonly title: string;
  readonly start: string; // ISO local datetime
  readonly duration?: string; // ISO duration "PT1H"
  readonly calendarColor?: string;
  readonly calendarId?: string;
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
  readonly description?: string;
  readonly location?: string;
  /** §7.3.1 — who put this event on the calendar. Defaults to 'human'
   *  when absent; 'agent' triggers the agent-treatment row dot so
   *  "your scheduling agent booked this" is legible at a glance. */
  readonly createdBy?: 'human' | 'agent';
  /** PR 54 — attendees on the event as parsed from JMAP. Surfaces in
   *  the detail view (with PARTSTAT badges) and seeds the form when
   *  the user edits the event. */
  readonly participants?: readonly {
    readonly email: string;
    readonly name?: string;
    readonly roles?: Readonly<Record<string, boolean>>;
    readonly participationStatus?: string;
    readonly expectReply?: boolean;
  }[];
};

export type CalendarInfo = {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  /** Whether this is the account's default calendar. Default rows
   *  cannot be deleted, so the per-row menu omits the Delete item. */
  readonly isDefault?: boolean;
};

/**
 * One attendee row as edited in the form (PR 54 / CoWork #7). Optional
 * because the form can produce an empty list (no invites). `name` is
 * optional — many users only have email addresses on hand.
 */
export type EventFormAttendee = {
  readonly email: string;
  readonly name?: string;
  /** Whether this attendee is marked optional. Defaults to false
   *  (regular `attendee` role). Optional attendees ride along with
   *  `roles: { attendee: true, optional: true }` on commit. */
  readonly optional?: boolean;
};

export type EventFormData = {
  readonly title: string;
  readonly date: string; // YYYY-MM-DD
  readonly startTime: string; // HH:MM
  readonly duration: string; // ISO duration "PT30M", "PT1H", "PT2H", "P1D"
  readonly description?: string;
  readonly location?: string;
  /** PR 54 — when present and non-empty, the host wraps these into
   *  JSCalendar participants (plus an organizer entry from the
   *  current identity) and sends through CalendarEvent/set. Stalwart's
   *  server-side scheduling fires iTIP REQUEST. */
  readonly attendees?: readonly EventFormAttendee[];
};

export type CalendarViewProps = {
  readonly events: readonly CalendarViewEvent[];
  readonly view: 'month' | 'week' | 'day';
  readonly onViewChange: (view: 'month' | 'week' | 'day') => void;
  readonly currentDate: Date;
  readonly onDateChange: (date: Date) => void;
  readonly onEventClick?: (eventId: string) => void;
  readonly onCreateEvent?: (date: Date) => void;
  readonly isLoading?: boolean;
  /** Calendars to list in the visibility rail (§8.4). Omit to hide
   *  the rail entirely (legacy / test usage). */
  readonly calendars?: readonly CalendarInfo[];
  /** IDs of calendars the user has hidden. The host filters events
   *  before they reach us — the rail uses this only to render the
   *  checkbox state. */
  readonly hiddenCalendarIds?: readonly string[];
  readonly onToggleCalendar?: (calendarId: string) => void;
  // Calendar management callbacks (Task 9)
  readonly onCreateCalendar?: () => void;
  readonly onEditCalendar?: (calendarId: string) => void;
  readonly onDeleteCalendar?: (calendarId: string) => void;
  // CRUD callbacks
  readonly onSaveEvent?: (input: EventFormData) => Promise<void>;
  readonly onUpdateEvent?: (id: string, input: EventFormData) => Promise<void>;
  readonly onDeleteEvent?: (id: string) => Promise<void>;
};

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Parse an ISO 8601 duration string (e.g. "PT1H", "PT30M", "PT1H30M")
 * into total minutes.
 */
function parseDurationMinutes(iso: string | undefined): number {
  if (iso === undefined) return 60; // default 1 hour
  let minutes = 0;
  const hourMatch = /(\d+)H/.exec(iso);
  const minMatch = /(\d+)M/.exec(iso);
  if (hourMatch !== null) minutes += parseInt(hourMatch[1]!, 10) * 60;
  if (minMatch !== null) minutes += parseInt(minMatch[1]!, 10);
  return minutes || 60;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function getMonthDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0 = Sunday

  const days: Date[] = [];

  // Leading days from previous month
  for (let i = startDow - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  // Days of current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, month, d));
  }

  // Trailing days to fill the last row (total should be multiple of 7)
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1]!;
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }

  return days;
}

function getWeekDays(date: Date): Date[] {
  const dow = date.getDay();
  const sunday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - dow);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i));
  }
  return days;
}

/** Max event chips rendered inside a month cell before falling back to
 *  a "+N more" row. Three keeps a 5-week month grid scannable; users
 *  who want every event click into day view. */
const MONTH_CHIP_LIMIT = 3;

/** Hour the week/day view auto-scrolls to on open. 8am is the
 *  conventional start-of-workday anchor that gets the user near "now"
 *  without forcing the viewport into late-evening dead space. */
const SCROLL_ANCHOR_HOUR = 8;

type CalendarViewMode = 'month' | 'week' | 'day';

const CALENDAR_VIEW_OPTIONS: ReadonlyArray<SegmentedOption<CalendarViewMode>> = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

/** Re-render every minute so the now-indicator slides without a refresh.
 *  Returns the current Date. Cheap; we only re-render the week/day
 *  views (the indicator + its position are the only dependents). */
function useNowTick(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(handle);
  }, []);
  return now;
}

function getEventsForDay(events: readonly CalendarViewEvent[], day: Date): CalendarViewEvent[] {
  return events.filter((evt) => {
    const evtDate = new Date(evt.start);
    return isSameDay(evtDate, day);
  });
}

// ── Duration helpers ──────────────────────────────────────────────

const DURATION_OPTIONS = [
  { label: '30 minutes', value: 'PT30M' },
  { label: '1 hour', value: 'PT1H' },
  { label: '2 hours', value: 'PT2H' },
  { label: 'All day', value: 'P1D' },
] as const;

function formatDurationLabel(iso: string | undefined): string {
  if (iso === undefined) return '1 hour';
  const found = DURATION_OPTIONS.find((opt) => opt.value === iso);
  if (found !== undefined) return found.label;
  return iso;
}

function formatEventTime(start: string, duration?: string): string {
  const d = new Date(start);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const time = `${h12}:${String(minutes).padStart(2, '0')} ${ampm}`;
  if (duration === 'P1D') return 'All day';
  return time;
}

// ── Component ─────────────────────────────────────────────────────

type DialogMode =
  | { readonly kind: 'closed' }
  | { readonly kind: 'form'; readonly editEvent?: CalendarViewEvent; readonly prefillDate?: string }
  | { readonly kind: 'detail'; readonly event: CalendarViewEvent }
  | { readonly kind: 'deleteConfirm'; readonly event: CalendarViewEvent };

export function CalendarView({
  events,
  view,
  onViewChange,
  currentDate,
  onDateChange,
  onEventClick,
  onCreateEvent,
  isLoading,
  calendars,
  hiddenCalendarIds,
  onToggleCalendar,
  onCreateCalendar,
  onEditCalendar,
  onDeleteCalendar,
  onSaveEvent,
  onUpdateEvent,
  onDeleteEvent,
}: CalendarViewProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>({ kind: 'closed' });
  const [saving, setSaving] = useState(false);

  // Open new-event form
  const openNewEventForm = useCallback((prefillDate?: string) => {
    if (prefillDate !== undefined) {
      setDialogMode({ kind: 'form', prefillDate });
    } else {
      setDialogMode({ kind: 'form' });
    }
  }, []);

  // Open new-event form for a specific date (from day cell click)
  const handleDayCellCreate = useCallback((day: Date) => {
    const dateStr = formatDateId(day);
    openNewEventForm(dateStr);
    onCreateEvent?.(day);
  }, [openNewEventForm, onCreateEvent]);

  // Handle clicking an event — open detail view
  const handleEventClick = useCallback((eventId: string) => {
    const evt = events.find((e) => e.id === eventId);
    if (evt !== undefined) {
      setDialogMode({ kind: 'detail', event: evt });
    }
    onEventClick?.(eventId);
  }, [events, onEventClick]);

  const closeDialog = useCallback(() => {
    setDialogMode({ kind: 'closed' });
  }, []);

  // Navigation helpers
  const navigatePrev = useCallback(() => {
    if (view === 'month') {
      onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (view === 'week') {
      onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 7));
    } else {
      onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 1));
    }
  }, [view, currentDate, onDateChange]);

  const navigateNext = useCallback(() => {
    if (view === 'month') {
      onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (view === 'week') {
      onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 7));
    } else {
      onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1));
    }
  }, [view, currentDate, onDateChange]);

  const navigateToday = useCallback(() => {
    const now = new Date();
    onDateChange(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }, [onDateChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const onKey = (e: KeyboardEvent) => {
      // Don't capture if focus is in an input or dialog is open
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          navigatePrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          navigateNext();
          break;
        case 't':
          e.preventDefault();
          navigateToday();
          break;
        case 'm':
          e.preventDefault();
          onViewChange('month');
          break;
        case 'w':
          e.preventDefault();
          onViewChange('week');
          break;
        case 'd':
          e.preventDefault();
          onViewChange('day');
          break;
      }
    };

    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [navigatePrev, navigateNext, navigateToday, onViewChange]);

  return (
    <section
      ref={containerRef}
      className={styles.calendar}
      aria-labelledby="calendar-heading"
      tabIndex={-1}
    >
      {/* Header — §8.4 reorganization: left = month label + ‹ Today ›
       *  nav; right = SegmentedControl + New Event (primary). Reads
       *  cleaner and matches the mail reading-pane bar. */}
      <div className={styles.header}>
        <h2 id="calendar-heading" className="sr-only">Calendar</h2>

        {/* Left cluster: label + nav */}
        <div className={styles.headerLeft}>
          <span className={styles.monthLabel}>
            {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
          <nav className={styles.nav} aria-label="Calendar navigation">
            <button
              type="button"
              className={styles.navBtn}
              onClick={navigatePrev}
              aria-label="Previous"
            >
              &lsaquo;
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={navigateToday}
              aria-label="Today"
            >
              Today
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={navigateNext}
              aria-label="Next"
            >
              &rsaquo;
            </button>
          </nav>
        </div>

        {/* Right cluster: view toggle + primary action */}
        <div className={styles.headerRight}>
          <SegmentedControl
            label="Calendar view"
            options={CALENDAR_VIEW_OPTIONS}
            value={view}
            onChange={onViewChange}
            size="sm"
          />
          {(onSaveEvent !== undefined || onUpdateEvent !== undefined) ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openNewEventForm(formatDateId(currentDate))}
              aria-label="New Event"
            >
              + New Event
            </Button>
          ) : null}
        </div>
      </div>

      {isLoading === true ? <p>Loading calendar...</p> : null}

      {/* Body: optional visibility rail (§8.4) + view */}
      <div className={styles.body}>
        {calendars !== undefined && calendars.length > 0 && onToggleCalendar !== undefined ? (
          <CalendarRail
            calendars={calendars}
            hiddenIds={hiddenCalendarIds ?? []}
            onToggle={onToggleCalendar}
            onCreateCalendar={onCreateCalendar}
            onEditCalendar={onEditCalendar}
            onDeleteCalendar={onDeleteCalendar}
          />
        ) : null}
        <div className={styles.viewArea}>
          {view === 'month' ? (
            <MonthView
              currentDate={currentDate}
              events={events}
              onDateChange={onDateChange}
              onEventClick={handleEventClick}
              onCreateEvent={handleDayCellCreate}
            />
          ) : view === 'week' ? (
            <WeekView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
              {...(onCreateEvent !== undefined ? { onCreateEvent } : {})}
            />
          ) : (
            <DayView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
              {...(onCreateEvent !== undefined ? { onCreateEvent } : {})}
            />
          )}
        </div>
      </div>

      {/* Event form dialog (create/edit) */}
      {dialogMode.kind === 'form' ? (
        <EventFormDialog
          open
          onClose={closeDialog}
          {...(dialogMode.editEvent !== undefined ? { editEvent: dialogMode.editEvent } : {})}
          {...(dialogMode.prefillDate !== undefined ? { prefillDate: dialogMode.prefillDate } : {})}
          saving={saving}
          onSave={async (data) => {
            setSaving(true);
            try {
              if (dialogMode.editEvent !== undefined && onUpdateEvent !== undefined) {
                await onUpdateEvent(dialogMode.editEvent.id, data);
              } else if (onSaveEvent !== undefined) {
                await onSaveEvent(data);
              }
              closeDialog();
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      {/* Event detail dialog */}
      {dialogMode.kind === 'detail' ? (
        <EventDetailDialog
          open
          event={dialogMode.event}
          onClose={closeDialog}
          onEdit={onUpdateEvent !== undefined ? () => {
            setDialogMode({ kind: 'form', editEvent: dialogMode.event });
          } : undefined}
          onDelete={onDeleteEvent !== undefined ? () => {
            setDialogMode({ kind: 'deleteConfirm', event: dialogMode.event });
          } : undefined}
        />
      ) : null}

      {/* Delete confirmation dialog */}
      {dialogMode.kind === 'deleteConfirm' ? (
        <DeleteConfirmDialog
          open
          eventTitle={dialogMode.event.title}
          saving={saving}
          onClose={closeDialog}
          onConfirm={async () => {
            if (onDeleteEvent !== undefined) {
              setSaving(true);
              try {
                await onDeleteEvent(dialogMode.event.id);
                closeDialog();
              } finally {
                setSaving(false);
              }
            }
          }}
        />
      ) : null}
    </section>
  );
}

// ── Month view ────────────────────────────────────────────────────

function MonthView({
  currentDate,
  events,
  onDateChange,
  onEventClick,
  onCreateEvent,
}: {
  readonly currentDate: Date;
  readonly events: readonly CalendarViewEvent[];
  readonly onDateChange: (date: Date) => void;
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getMonthDays(year, month);
  const today = new Date();

  // Roving focus state (§8.4): exactly one cell is in the tab order at
  // a time; arrow keys move focus cell-to-cell. Default to today when
  // it falls inside the visible grid, else fall back to currentDate.
  const initialFocus = useMemo(() => {
    const todayId = formatDateId(today);
    const inGrid = days.some((d) => formatDateId(d) === todayId);
    return inGrid ? todayId : formatDateId(currentDate);
    // Recompute on month change only; today.toISOString() shouldn't
    // tick mid-render — see Date.now() ban in skill docs, this is
    // unobserved-since-mount and acceptable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);
  const [focusedDateId, setFocusedDateId] = useState<string>(initialFocus);
  // When the month changes (Today nav, ‹ ›), pull the roving cursor
  // back to today / first of month so it doesn't stay on an old cell.
  useEffect(() => {
    setFocusedDateId(initialFocus);
  }, [initialFocus]);

  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // After state updates the focused id, actually move the DOM focus.
  // useEffect runs after the new tabIndex props are applied so the
  // target cell is focusable.
  const shouldRestoreFocusRef = useRef(false);
  useEffect(() => {
    if (!shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    const el = cellRefs.current.get(focusedDateId);
    if (el !== null && el !== undefined && typeof el.focus === 'function') {
      el.focus();
    }
  }, [focusedDateId]);

  const moveFocus = (delta: number): void => {
    const idx = days.findIndex((d) => formatDateId(d) === focusedDateId);
    if (idx === -1) return;
    const nextIdx = idx + delta;
    const next = days[nextIdx];
    if (next === undefined) {
      // Out of grid — page to prev/next month, the host's onDateChange
      // will rebuild the grid and the initial-focus effect will land
      // the cursor on the right cell. Day overshooting past Sat moves
      // to next month's first row; underflow to prev month's last row.
      const stepDate = new Date(
        days[idx]!.getFullYear(),
        days[idx]!.getMonth(),
        days[idx]!.getDate() + delta,
      );
      onDateChange(stepDate);
      shouldRestoreFocusRef.current = true;
      setFocusedDateId(formatDateId(stepDate));
      return;
    }
    shouldRestoreFocusRef.current = true;
    setFocusedDateId(formatDateId(next));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>, day: Date): void => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-7);
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(7);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onDateChange(day);
        return;
      default:
        return;
    }
  };

  return (
    <div className={styles.monthGrid} role="region" aria-label="Month calendar grid">
      {/* Day-of-week headers */}
      {DAY_NAMES.map((name) => (
        <div key={name} className={styles.dayHeader}>
          {name}
        </div>
      ))}

      {/* Day cells */}
      {days.map((day) => {
        const isCurrentMonth = day.getMonth() === month;
        const isToday = isSameDay(day, today);
        const dateId = formatDateId(day);
        const dayEvents = getEventsForDay(events, day);
        const isFocusable = dateId === focusedDateId;

        const cellClasses = [
          styles.dayCell,
          !isCurrentMonth ? styles.dayCellOffMonth : '',
          isToday ? styles.dayCellToday : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={dateId}
            ref={(el) => {
              if (el === null) cellRefs.current.delete(dateId);
              else cellRefs.current.set(dateId, el);
            }}
            className={cellClasses}
            data-testid={isToday ? 'calendar-day-today' : `calendar-day-${dateId}`}
            data-date={dateId}
            tabIndex={isFocusable ? 0 : -1}
            onClick={() => {
              setFocusedDateId(dateId);
              onDateChange(day);
            }}
            onDoubleClick={() => onCreateEvent?.(day)}
            onKeyDown={(e) => handleKey(e, day)}
            role="button"
            aria-label={`${DAY_NAMES_FULL[day.getDay()]}, ${MONTH_NAMES[day.getMonth()]} ${day.getDate()}`}
          >
            <span className={isToday ? styles.dayNumberToday : styles.dayNumber}>
              {day.getDate()}
            </span>

            {/* Event dots — mobile fallback (CSS hides above 640px). */}
            {dayEvents.length > 0 ? (
              <div className={styles.eventDots}>
                {dayEvents.slice(0, 3).map((evt) => (
                  <span
                    key={evt.id}
                    className={styles.eventDot}
                    data-testid="event-dot"
                    style={evt.calendarColor !== undefined ? { background: evt.calendarColor } : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(evt.id);
                    }}
                  />
                ))}
                {dayEvents.length > 3 ? (
                  <span className={styles.eventDotMore}>+{dayEvents.length - 3}</span>
                ) : null}
              </div>
            ) : null}

            {/* Event chips — primary surface ≥640px (§8.4). */}
            {dayEvents.length > 0 ? (
              <div className={styles.eventChips}>
                {dayEvents.slice(0, MONTH_CHIP_LIMIT).map((evt) => {
                  const allDay = evt.duration === 'P1D';
                  const chipColor = evt.calendarColor;
                  // Chips render as <span> (matching the dot variant) so
                  // they aren't a nested interactive inside the day
                  // cell's role="button". Roving keyboard focus across
                  // chips + cells is the P2 a11y follow-up.
                  return (
                    <span
                      key={evt.id}
                      className={styles.eventChip}
                      data-testid="event-chip"
                      style={
                        chipColor !== undefined
                          ? {
                              borderLeftColor: chipColor,
                              background: `color-mix(in srgb, ${chipColor} 12%, transparent)`,
                            }
                          : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick?.(evt.id);
                      }}
                      aria-label={`${evt.title}, ${formatEventTime(evt.start, evt.duration)}`}
                    >
                      <span
                        className={`${styles.eventChipTime} ${allDay ? styles.eventChipAllDay : ''}`}
                      >
                        {formatEventTime(evt.start, evt.duration)}
                      </span>
                      <span className={styles.eventChipTitle}>{evt.title}</span>
                    </span>
                  );
                })}
                {dayEvents.length > MONTH_CHIP_LIMIT ? (
                  <span className={styles.eventMore}>
                    +{dayEvents.length - MONTH_CHIP_LIMIT} more
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────

function WeekView({
  currentDate,
  events,
  onEventClick,
  onCreateEvent,
}: {
  readonly currentDate: Date;
  readonly events: readonly CalendarViewEvent[];
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
}) {
  const weekDays = getWeekDays(currentDate);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const now = useNowTick();
  const todayIndex = weekDays.findIndex((d) => isSameDay(d, now));

  const hasAllDay = weekDays.some(
    (day) => getAllDayEventsForDay(events, day).length > 0,
  );

  return (
    <div className={styles.weekGrid} role="region" aria-label="Week calendar grid">
      {/* Corner cell + day headers */}
      <div className={styles.weekDayHeader} />
      {weekDays.map((day) => (
        <div key={formatDateId(day)} className={styles.weekDayHeader}>
          {DAY_NAMES[day.getDay()]} {day.getDate()}
        </div>
      ))}

      {/* All-day strip — §8.4. Only renders when at least one day in
       *  the week has a P1D event, so empty weeks don't waste a row. */}
      {hasAllDay ? (
        <>
          <div className={styles.allDayLabel}>All-day</div>
          {weekDays.map((day) => (
            <div key={`allday-${formatDateId(day)}`} className={styles.allDayCell}>
              {getAllDayEventsForDay(events, day).map((evt) => (
                <AllDayChip key={evt.id} event={evt} onEventClick={onEventClick} />
              ))}
            </div>
          ))}
        </>
      ) : null}

      {/* Time rows */}
      {hours.map((hour) => (
        <WeekRow
          key={hour}
          hour={hour}
          weekDays={weekDays}
          events={events}
          onEventClick={onEventClick}
          onCreateEvent={onCreateEvent}
          now={now}
          todayIndex={todayIndex}
        />
      ))}
    </div>
  );
}

function WeekRow({
  hour,
  weekDays,
  events,
  onEventClick,
  onCreateEvent,
  now,
  todayIndex,
}: {
  readonly hour: number;
  readonly weekDays: Date[];
  readonly events: readonly CalendarViewEvent[];
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
  readonly now: Date;
  readonly todayIndex: number;
}) {
  const labelRef = useRef<HTMLDivElement | null>(null);
  // Anchor the 8am scroll-into-view on the time-label cell of the
  // 8am row — first DOM node in that row's tab order.
  useEffect(() => {
    if (hour !== SCROLL_ANCHOR_HOUR) return;
    // Feature-detect: jsdom (test env) doesn't implement scrollIntoView.
    const el = labelRef.current;
    if (el !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start' });
    }
  }, [hour]);

  return (
    <>
      <div
        className={styles.weekTimeLabel}
        ref={hour === SCROLL_ANCHOR_HOUR ? labelRef : undefined}
      >
        {formatHour(hour)}
      </div>
      {weekDays.map((day, idx) => {
        const dateId = formatDateId(day);
        const slotEvents = getEventsForHourSlot(events, day, hour);
        const isNowSlot = idx === todayIndex && now.getHours() === hour;

        return (
          <div
            key={`${dateId}-${hour}`}
            className={styles.weekSlot}
            onDoubleClick={() => {
              const eventDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
              onCreateEvent?.(eventDate);
            }}
          >
            {slotEvents.map((evt) => (
              <EventBlock
                key={evt.id}
                event={evt}
                slotHour={hour}
                onClick={onEventClick}
              />
            ))}
            {onCreateEvent !== undefined ? (
              <button
                type="button"
                className={styles.slotAddBtn}
                aria-label={`New event at ${formatHour(hour)} on ${DAY_NAMES_FULL[day.getDay()]} ${day.getDate()}`}
                data-testid="slot-add"
                onClick={(e) => {
                  e.stopPropagation();
                  const eventDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
                  onCreateEvent(eventDate);
                }}
              >
                +
              </button>
            ) : null}
            {isNowSlot ? (
              <div
                className={styles.nowIndicator}
                data-testid="now-indicator"
                aria-hidden="true"
                style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

// ── Day view ──────────────────────────────────────────────────────

function DayView({
  currentDate,
  events,
  onEventClick,
  onCreateEvent,
}: {
  readonly currentDate: Date;
  readonly events: readonly CalendarViewEvent[];
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
}) {
  const dayEvents = getEventsForDay(events, currentDate);
  const allDayEvents = getAllDayEventsForDay(events, currentDate);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const shortLabel = `${DAY_NAMES[currentDate.getDay()]}, ${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getDate()}`;
  const now = useNowTick();
  const isToday = isSameDay(now, currentDate);

  return (
    <div className={styles.dayGrid} role="region" aria-label="Day calendar grid">
      <div className={styles.dayHeaderFull} role="heading" aria-level={3}>
        {shortLabel}
      </div>

      {/* All-day strip — §8.4. */}
      {allDayEvents.length > 0 ? (
        <>
          <div className={styles.allDayLabel}>All-day</div>
          <div className={styles.allDayCell}>
            {allDayEvents.map((evt) => (
              <AllDayChip key={evt.id} event={evt} onEventClick={onEventClick} />
            ))}
          </div>
        </>
      ) : null}

      {hours.map((hour) => {
        const slotEvents = getEventsForHourSlot(dayEvents, currentDate, hour);

        return (
          <DayRow
            key={hour}
            hour={hour}
            currentDate={currentDate}
            slotEvents={slotEvents}
            onEventClick={onEventClick}
            onCreateEvent={onCreateEvent}
            now={now}
            isToday={isToday}
          />
        );
      })}
    </div>
  );
}

function DayRow({
  hour,
  currentDate,
  slotEvents,
  onEventClick,
  onCreateEvent,
  now,
  isToday,
}: {
  readonly hour: number;
  readonly currentDate: Date;
  readonly slotEvents: CalendarViewEvent[];
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
  readonly now: Date;
  readonly isToday: boolean;
}) {
  const labelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hour !== SCROLL_ANCHOR_HOUR) return;
    // Feature-detect: jsdom (test env) doesn't implement scrollIntoView.
    const el = labelRef.current;
    if (el !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start' });
    }
  }, [hour]);
  const isNowSlot = isToday && now.getHours() === hour;
  return (
    <>
      <div
        className={styles.dayTimeLabel}
        ref={hour === SCROLL_ANCHOR_HOUR ? labelRef : undefined}
      >
        {formatHour(hour)}
      </div>
      <div
        className={styles.daySlot}
        onDoubleClick={() => {
          const eventDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour);
          onCreateEvent?.(eventDate);
        }}
      >
        {slotEvents.map((evt) => (
          <EventBlock
            key={evt.id}
            event={evt}
            slotHour={hour}
            onClick={onEventClick}
          />
        ))}
        {onCreateEvent !== undefined ? (
          <button
            type="button"
            className={styles.slotAddBtn}
            aria-label={`New event at ${formatHour(hour)}`}
            data-testid="slot-add"
            onClick={(e) => {
              e.stopPropagation();
              const eventDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour);
              onCreateEvent(eventDate);
            }}
          >
            +
          </button>
        ) : null}
        {isNowSlot ? (
          <div
            className={styles.nowIndicator}
            data-testid="now-indicator"
            aria-hidden="true"
            style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
          />
        ) : null}
      </div>
    </>
  );
}

// ── Event block ───────────────────────────────────────────────────

function EventBlock({
  event,
  slotHour,
  onClick,
}: {
  readonly event: CalendarViewEvent;
  readonly slotHour: number;
  readonly onClick?: ((eventId: string) => void) | undefined;
}) {
  const evtDate = new Date(event.start);
  const startHour = evtDate.getHours();
  const startMinute = evtDate.getMinutes();
  const durationMinutes = parseDurationMinutes(event.duration);

  // Only render in the starting hour slot
  if (startHour !== slotHour) return null;

  // Calculate position and height relative to the slot
  const topOffset = (startMinute / 60) * 100;
  const heightPercent = (durationMinutes / 60) * 100;

  const borderColor = event.calendarColor ?? 'var(--accent)';
  const isAgent = event.createdBy === 'agent';

  const classes = [
    styles.eventBlock,
    event.status === 'tentative' ? styles.eventBlockTentative : '',
    event.status === 'cancelled' ? styles.eventBlockCancelled : '',
    isAgent ? styles.eventBlockAgent : '',
  ]
    .filter(Boolean)
    .join(' ');

  // aria-label folds in the status + provenance so screen-reader
  // users get the same "this is tentative / your agent booked it"
  // signal sighted users get from the hatched fill + agent dot.
  const tagBits: string[] = [];
  if (event.status === 'tentative') tagBits.push('tentative');
  if (event.status === 'cancelled') tagBits.push('cancelled');
  if (isAgent) tagBits.push('booked by agent');
  const ariaLabel = tagBits.length > 0
    ? `${event.title} (${tagBits.join(', ')})`
    : event.title;

  return (
    <div
      className={classes}
      style={{
        top: `${topOffset}%`,
        height: `${heightPercent}%`,
        minHeight: '1.2em',
        borderLeftColor: borderColor,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(event.id);
      }}
      title={event.title}
      role="button"
      aria-label={ariaLabel}
    >
      {isAgent ? (
        <span
          className={styles.eventBlockAgentDot}
          aria-hidden="true"
          title="Booked by agent"
        >
          ✦
        </span>
      ) : null}
      {event.title}
    </div>
  );
}

// ── Calendar visibility rail (§8.4) ──────────────────────────────

function CalendarRail({
  calendars,
  hiddenIds,
  onToggle,
  onCreateCalendar,
  onEditCalendar,
  onDeleteCalendar,
}: {
  readonly calendars: readonly CalendarInfo[];
  readonly hiddenIds: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly onCreateCalendar?: (() => void) | undefined;
  readonly onEditCalendar?: ((id: string) => void) | undefined;
  readonly onDeleteCalendar?: ((id: string) => void) | undefined;
}) {
  const hidden = new Set(hiddenIds);
  return (
    <aside
      className={styles.rail}
      aria-label="Calendars"
    >
      <div className={styles.railHeadingRow}>
        <h3 className={styles.railHeading}>Calendars</h3>
        {onCreateCalendar !== undefined ? (
          <button
            type="button"
            className={styles.railNewBtn}
            onClick={onCreateCalendar}
            aria-label="New calendar"
          >
            +
          </button>
        ) : null}
      </div>
      <ul className={styles.railList}>
        {calendars.map((c) => {
          const isHidden = hidden.has(c.id);
          const showMenu = onEditCalendar !== undefined || onDeleteCalendar !== undefined;
          const menuItems = [
            {
              key: 'edit',
              label: 'Edit…',
              onSelect: () => onEditCalendar?.(c.id),
            },
            ...(c.isDefault !== true
              ? [
                  {
                    key: 'delete',
                    label: 'Delete',
                    onSelect: () => onDeleteCalendar?.(c.id),
                  },
                ]
              : []),
          ];
          return (
            <li key={c.id} className={styles.railItem}>
              <label className={styles.railLabel}>
                <input
                  type="checkbox"
                  className={styles.railCheckbox}
                  checked={!isHidden}
                  onChange={() => onToggle(c.id)}
                  aria-label={`${isHidden ? 'Show' : 'Hide'} ${c.name}`}
                />
                <span
                  className={styles.railSwatch}
                  style={c.color !== undefined ? { background: c.color } : undefined}
                  aria-hidden="true"
                />
                <span className={styles.railName}>{c.name}</span>
              </label>
              {showMenu ? (
                <MenuButton
                  label={`${c.name} actions`}
                  size="sm"
                  align="end"
                  items={menuItems}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ── All-day chip (week + day all-day strip) ──────────────────────

function AllDayChip({
  event,
  onEventClick,
}: {
  readonly event: CalendarViewEvent;
  readonly onEventClick?: ((eventId: string) => void) | undefined;
}) {
  return (
    <span
      className={styles.allDayChip}
      data-testid="all-day-chip"
      style={
        event.calendarColor !== undefined
          ? {
              borderLeftColor: event.calendarColor,
              background: `color-mix(in srgb, ${event.calendarColor} 14%, transparent)`,
            }
          : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        onEventClick?.(event.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEventClick?.(event.id);
        }
      }}
      aria-label={`${event.title}, all day`}
    >
      {event.title}
    </span>
  );
}

// ── Slot filtering helper ─────────────────────────────────────────

function getEventsForHourSlot(
  events: readonly CalendarViewEvent[],
  day: Date,
  hour: number,
): CalendarViewEvent[] {
  return events.filter((evt) => {
    if (evt.duration === 'P1D') return false; // All-day → strip, not slot.
    const evtDate = new Date(evt.start);
    return isSameDay(evtDate, day) && evtDate.getHours() === hour;
  });
}

function getAllDayEventsForDay(
  events: readonly CalendarViewEvent[],
  day: Date,
): CalendarViewEvent[] {
  return events.filter((evt) => {
    if (evt.duration !== 'P1D') return false;
    const evtDate = new Date(evt.start);
    return isSameDay(evtDate, day);
  });
}

// ── Event form dialog ────────────────────────────────────────────

function EventFormDialog({
  open,
  onClose,
  editEvent,
  prefillDate,
  saving,
  onSave,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly editEvent?: CalendarViewEvent;
  readonly prefillDate?: string;
  readonly saving: boolean;
  readonly onSave: (data: EventFormData) => Promise<void>;
}) {
  // Derive initial values from editEvent or defaults
  const initialDate = editEvent !== undefined
    ? editEvent.start.slice(0, 10)
    : prefillDate ?? formatDateId(new Date());

  const initialTime = editEvent !== undefined
    ? editEvent.start.slice(11, 16) || '09:00'
    : '09:00';

  const initialDuration = editEvent?.duration ?? 'PT1H';

  const [title, setTitle] = useState(editEvent?.title ?? '');
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialTime);
  const [duration, setDuration] = useState(initialDuration);
  const [description, setDescription] = useState(editEvent?.description ?? '');
  const [location, setLocation] = useState(editEvent?.location ?? '');
  // PR 54 — attendees field. Seeds from `editEvent.participants` after
  // dropping the organizer entry (the host re-injects the organizer on
  // save, derived from the current identity).
  const [attendees, setAttendees] = useState<readonly EventFormAttendee[]>(
    () => seedAttendees(editEvent?.participants),
  );

  const isEditing = editEvent !== undefined;
  const titleValid = title.trim().length > 0;
  const dateValid = date.length > 0;

  const handleSubmit = () => {
    if (!titleValid || !dateValid) return;
    const data: EventFormData = {
      title: title.trim(),
      date,
      startTime,
      duration,
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
      ...(location.trim() !== '' ? { location: location.trim() } : {}),
      // Always pass `attendees` — empty array communicates "clear
      // existing invites" on edit. The host short-circuits the
      // organizer-injection when the array is empty AND the event
      // has no existing participants.
      attendees,
    };
    void onSave(data);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit Event' : 'New Event'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!titleValid || !dateValid || saving}
            onClick={handleSubmit}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <div className={styles.eventForm}>
        <div className={styles.formField}>
          <label htmlFor="event-title" className={styles.formLabel}>
            Title <span aria-hidden="true">*</span>
          </label>
          <input
            id="event-title"
            type="text"
            className={styles.formInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Event title"
            autoFocus
          />
        </div>

        <div className={styles.formRow}>
          <div className={styles.formField}>
            <label htmlFor="event-date" className={styles.formLabel}>
              Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="event-date"
              type="date"
              className={styles.formInput}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className={styles.formField}>
            <label htmlFor="event-time" className={styles.formLabel}>
              Start time
            </label>
            <input
              id="event-time"
              type="time"
              className={styles.formInput}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.formField}>
          <label htmlFor="event-duration" className={styles.formLabel}>
            Duration
          </label>
          <select
            id="event-duration"
            className={styles.formSelect}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formField}>
          <label htmlFor="event-description" className={styles.formLabel}>
            Description
          </label>
          <textarea
            id="event-description"
            className={styles.formTextarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add a description..."
          />
        </div>

        <div className={styles.formField}>
          <label htmlFor="event-location" className={styles.formLabel}>
            Location
          </label>
          <input
            id="event-location"
            type="text"
            className={styles.formInput}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add a location..."
          />
        </div>

        <AttendeesField attendees={attendees} onChange={setAttendees} />
      </div>
    </Dialog>
  );
}

/**
 * Compose the participants array sent to JMAP `event.create`/`event.update`
 * from the form's attendee list + the current user (organizer).
 *
 * Returns `undefined` when neither the organizer is known nor any
 * attendees are present — that case skips the participants field on
 * the wire entirely (server doesn't need to fire iTIP for a solo
 * event).
 *
 * Returns an empty array only when the caller explicitly wants to
 * clear participants (form attendees=[] + organizer unknown). Pure;
 * unit-tested.
 */
export function buildEventParticipants(
  attendees: readonly EventFormAttendee[] | undefined,
  organizer: { readonly email: string; readonly name?: string } | undefined,
): readonly {
  readonly email: string;
  readonly name?: string;
  readonly roles: Readonly<Record<string, boolean>>;
  readonly participationStatus?: 'needs-action' | 'accepted' | 'declined' | 'tentative' | 'delegated';
  readonly expectReply?: boolean;
}[] | undefined {
  const list = attendees ?? [];
  if (list.length === 0 && organizer === undefined) return undefined;
  const out: {
    email: string;
    name?: string;
    roles: Record<string, boolean>;
    participationStatus?: 'needs-action' | 'accepted' | 'declined' | 'tentative' | 'delegated';
    expectReply?: boolean;
  }[] = [];
  if (organizer !== undefined && list.length > 0) {
    // Only inject the organizer when there's at least one attendee —
    // a solo event doesn't need a participant entry for iTIP.
    out.push({
      email: organizer.email,
      ...(organizer.name !== undefined ? { name: organizer.name } : {}),
      roles: { owner: true, chair: true },
      participationStatus: 'accepted',
      expectReply: false,
    });
  }
  for (const a of list) {
    out.push({
      email: a.email,
      ...(a.name !== undefined ? { name: a.name } : {}),
      roles:
        a.optional === true
          ? { attendee: true, optional: true }
          : { attendee: true },
      participationStatus: 'needs-action',
      expectReply: true,
    });
  }
  return out;
}

/** Pure helper used by tests AND the form's initial-state seed. Drops
 *  the organizer (role.owner=true) so the user can't accidentally
 *  remove themselves; the host re-injects an organizer on save. */
export function seedAttendees(
  participants: readonly NonNullable<CalendarViewEvent['participants']>[number][] | undefined,
): readonly EventFormAttendee[] {
  if (participants === undefined) return [];
  const out: EventFormAttendee[] = [];
  for (const p of participants) {
    if (p.roles?.owner === true) continue;
    out.push({
      email: p.email,
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.roles?.optional === true ? { optional: true } : {}),
    });
  }
  return out;
}

/** Pure email shape check — sufficient for "you haven't typed gibberish"
 *  validation in the chip input. Server is the authority. */
export function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function AttendeesField({
  attendees,
  onChange,
}: {
  readonly attendees: readonly EventFormAttendee[];
  readonly onChange: (next: readonly EventFormAttendee[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    if (!isPlausibleEmail(trimmed)) {
      setError(`"${trimmed}" doesn't look like an email address.`);
      return;
    }
    if (attendees.some((a) => a.email.toLowerCase() === trimmed.toLowerCase())) {
      setError(`${trimmed} is already on the invite list.`);
      return;
    }
    onChange([...attendees, { email: trimmed }]);
    setDraft('');
    setError(null);
  }, [draft, attendees, onChange]);

  const remove = useCallback(
    (email: string) => {
      onChange(attendees.filter((a) => a.email !== email));
    },
    [attendees, onChange],
  );

  const toggleOptional = useCallback(
    (email: string) => {
      onChange(
        attendees.map((a) =>
          a.email === email ? { ...a, optional: a.optional !== true } : a,
        ),
      );
    },
    [attendees, onChange],
  );

  return (
    <div className={styles.formField}>
      <label htmlFor="event-attendees" className={styles.formLabel}>
        Attendees
      </label>
      {attendees.length > 0 ? (
        <ul
          className={styles.attendeeList}
          aria-label="Invited attendees"
        >
          {attendees.map((a) => (
            <li key={a.email} className={styles.attendeeChip}>
              <span className={styles.attendeeEmail}>{a.email}</span>
              <button
                type="button"
                className={styles.attendeeOptionalBtn}
                onClick={() => toggleOptional(a.email)}
                aria-pressed={a.optional === true}
                title={
                  a.optional === true
                    ? 'Marked optional — click to make required'
                    : 'Mark as optional attendee'
                }
              >
                {a.optional === true ? 'optional' : 'required'}
              </button>
              <button
                type="button"
                className={styles.attendeeRemoveBtn}
                onClick={() => remove(a.email)}
                aria-label={`Remove ${a.email}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.attendeeInputRow}>
        <input
          id="event-attendees"
          type="email"
          className={styles.formInput}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error !== null) setError(null);
          }}
          onKeyDown={(e) => {
            // Commit on Enter or comma; both are common in
            // invite-style fields (Gmail, GCal).
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            } else if (
              e.key === 'Backspace' &&
              draft === '' &&
              attendees.length > 0
            ) {
              // Backspace in an empty input removes the last chip,
              // matching mail-client convention.
              const last = attendees[attendees.length - 1];
              if (last !== undefined) remove(last.email);
            }
          }}
          onBlur={commit}
          placeholder="email@example.com (press Enter to add)"
        />
      </div>
      {error !== null ? (
        <p className={styles.attendeeError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Event detail dialog ──────────────────────────────────────────

function EventDetailDialog({
  open,
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  readonly open: boolean;
  readonly event: CalendarViewEvent;
  readonly onClose: () => void;
  readonly onEdit?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}) {
  const evtDate = new Date(event.start);
  const dateStr = `${DAY_NAMES_FULL[evtDate.getDay()]}, ${MONTH_NAMES[evtDate.getMonth()]} ${evtDate.getDate()}, ${evtDate.getFullYear()}`;
  const timeStr = formatEventTime(event.start, event.duration);
  const durationStr = formatDurationLabel(event.duration);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={event.title}
      footer={
        <>
          {onEdit !== undefined ? (
            <Button variant="secondary" onClick={onEdit} aria-label="Edit event">
              Edit
            </Button>
          ) : null}
          {onDelete !== undefined ? (
            <Button variant="destructive" onClick={onDelete} aria-label="Delete event">
              Delete
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.eventDetail} data-testid="event-detail">
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Date</span>
          <span>{dateStr}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Time</span>
          <span>{timeStr}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Duration</span>
          <span>{durationStr}</span>
        </div>
        {event.location !== undefined && event.location !== '' ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Location</span>
            <span>{event.location}</span>
          </div>
        ) : null}
        {event.description !== undefined && event.description !== '' ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Description</span>
            <span>{event.description}</span>
          </div>
        ) : null}
        {event.participants !== undefined && event.participants.length > 0 ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Attendees</span>
            <ul
              className={styles.participantList}
              aria-label={`${event.participants.length} attendee${
                event.participants.length === 1 ? '' : 's'
              }`}
            >
              {event.participants.map((p) => {
                const status = p.participationStatus ?? 'needs-action';
                return (
                  <li key={p.email} className={styles.participantRow}>
                    <span className={styles.participantName}>
                      {p.name !== undefined && p.name !== ''
                        ? `${p.name} <${p.email}>`
                        : p.email}
                    </span>
                    <ParticipantStatusBadge status={status} />
                    {p.roles?.optional === true ? (
                      <span
                        className={styles.participantOptional}
                        title="Optional attendee"
                      >
                        optional
                      </span>
                    ) : null}
                    {p.roles?.owner === true ? (
                      <span
                        className={styles.participantOrganizer}
                        title="Organizer"
                      >
                        organizer
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Pure mapping from PARTSTAT → human-facing label + visual treatment. */
export function partstatLabel(status: string): {
  readonly label: string;
  readonly tone: 'accepted' | 'declined' | 'tentative' | 'pending';
} {
  switch (status) {
    case 'accepted':
      return { label: 'Accepted', tone: 'accepted' };
    case 'declined':
      return { label: 'Declined', tone: 'declined' };
    case 'tentative':
      return { label: 'Tentative', tone: 'tentative' };
    case 'delegated':
      return { label: 'Delegated', tone: 'pending' };
    default:
      return { label: 'Awaiting reply', tone: 'pending' };
  }
}

function ParticipantStatusBadge({ status }: { readonly status: string }) {
  const { label, tone } = partstatLabel(status);
  // Tone selects a CSS class; never raw className concatenation off
  // user data, so axe-prone string ops stay simple.
  const cls =
    tone === 'accepted'
      ? styles.partstatAccepted
      : tone === 'declined'
        ? styles.partstatDeclined
        : tone === 'tentative'
          ? styles.partstatTentative
          : styles.partstatPending;
  return (
    <span className={`${styles.partstatBadge} ${cls}`} aria-label={label}>
      {label}
    </span>
  );
}

// ── Delete confirmation dialog ───────────────────────────────────

function DeleteConfirmDialog({
  open,
  eventTitle,
  saving,
  onClose,
  onConfirm,
}: {
  readonly open: boolean;
  readonly eventTitle: string;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete this event?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={saving} onClick={onConfirm}>
            {saving ? 'Deleting...' : 'Delete'}
          </Button>
        </>
      }
    >
      <p>
        Are you sure you want to delete <strong>{eventTitle}</strong>? This action cannot be undone.
      </p>
    </Dialog>
  );
}
