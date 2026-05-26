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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../components/index.js';
import styles from './calendar-view.module.css';

// ── Types ─────────────────────────────────────────────────────────

export type CalendarViewEvent = {
  readonly id: string;
  readonly title: string;
  readonly start: string; // ISO local datetime
  readonly duration?: string; // ISO duration "PT1H"
  readonly calendarColor?: string;
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
  readonly description?: string;
  readonly location?: string;
};

export type EventFormData = {
  readonly title: string;
  readonly date: string; // YYYY-MM-DD
  readonly startTime: string; // HH:MM
  readonly duration: string; // ISO duration "PT30M", "PT1H", "PT2H", "P1D"
  readonly description?: string;
  readonly location?: string;
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
      {/* Header */}
      <div className={styles.header}>
        <h2 id="calendar-heading" className="sr-only">Calendar</h2>

        {/* View toggle */}
        <div className={styles.viewToggle} role="group" aria-label="Calendar view">
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === 'month' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => onViewChange('month')}
            aria-pressed={view === 'month'}
            aria-label="Month"
          >
            Month
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === 'week' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => onViewChange('week')}
            aria-pressed={view === 'week'}
            aria-label="Week"
          >
            Week
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === 'day' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => onViewChange('day')}
            aria-pressed={view === 'day'}
            aria-label="Day"
          >
            Day
          </button>
        </div>

        {/* New Event button */}
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

        {/* Month/year label */}
        <span className={styles.monthLabel}>
          {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
        </span>

        {/* Navigation */}
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

      {isLoading === true ? <p>Loading calendar...</p> : null}

      {/* View body */}
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
          onCreateEvent={onCreateEvent}
        />
      ) : (
        <DayView
          currentDate={currentDate}
          events={events}
          onEventClick={handleEventClick}
          onCreateEvent={onCreateEvent}
        />
      )}

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
            className={cellClasses}
            data-testid={isToday ? 'calendar-day-today' : `calendar-day-${dateId}`}
            data-date={dateId}
            onClick={() => onDateChange(day)}
            onDoubleClick={() => onCreateEvent?.(day)}
            role="button"
            aria-label={`${DAY_NAMES_FULL[day.getDay()]}, ${MONTH_NAMES[day.getMonth()]} ${day.getDate()}`}
          >
            <span className={isToday ? styles.dayNumberToday : styles.dayNumber}>
              {day.getDate()}
            </span>

            {/* Event dots */}
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

  return (
    <div className={styles.weekGrid} role="region" aria-label="Week calendar grid">
      {/* Corner cell + day headers */}
      <div className={styles.weekDayHeader} />
      {weekDays.map((day) => (
        <div key={formatDateId(day)} className={styles.weekDayHeader}>
          {DAY_NAMES[day.getDay()]} {day.getDate()}
        </div>
      ))}

      {/* Time rows */}
      {hours.map((hour) => (
        <WeekRow
          key={hour}
          hour={hour}
          weekDays={weekDays}
          events={events}
          onEventClick={onEventClick}
          onCreateEvent={onCreateEvent}
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
}: {
  readonly hour: number;
  readonly weekDays: Date[];
  readonly events: readonly CalendarViewEvent[];
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
}) {
  return (
    <>
      <div className={styles.weekTimeLabel}>{formatHour(hour)}</div>
      {weekDays.map((day) => {
        const dateId = formatDateId(day);
        const slotEvents = getEventsForHourSlot(events, day, hour);

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
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const shortLabel = `${DAY_NAMES[currentDate.getDay()]}, ${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getDate()}`;

  return (
    <div className={styles.dayGrid} role="region" aria-label="Day calendar grid">
      <div className={styles.dayHeaderFull} role="heading" aria-level={3}>
        {shortLabel}
      </div>

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
}: {
  readonly hour: number;
  readonly currentDate: Date;
  readonly slotEvents: CalendarViewEvent[];
  readonly onEventClick?: ((eventId: string) => void) | undefined;
  readonly onCreateEvent?: ((date: Date) => void) | undefined;
}) {
  return (
    <>
      <div className={styles.dayTimeLabel}>{formatHour(hour)}</div>
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

  const borderColor = event.calendarColor ?? 'var(--accent, #3b82f6)';

  return (
    <div
      className={styles.eventBlock}
      style={{
        top: `${topOffset}%`,
        height: `${heightPercent}%`,
        minHeight: '1.2em',
        borderLeftColor: borderColor,
        opacity: event.status === 'cancelled' ? 0.5 : event.status === 'tentative' ? 0.75 : 1,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(event.id);
      }}
      title={event.title}
      role="button"
      aria-label={event.title}
    >
      {event.title}
    </div>
  );
}

// ── Slot filtering helper ─────────────────────────────────────────

function getEventsForHourSlot(
  events: readonly CalendarViewEvent[],
  day: Date,
  hour: number,
): CalendarViewEvent[] {
  return events.filter((evt) => {
    const evtDate = new Date(evt.start);
    return isSameDay(evtDate, day) && evtDate.getHours() === hour;
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
      </div>
    </Dialog>
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
      </div>
    </Dialog>
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
