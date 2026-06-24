/**
 * @vitest-environment jsdom
 *
 * Tests for CalendarView (Phase 4b).
 *
 * Covers:
 *   - Renders month view with day grid
 *   - Renders week view with time slots
 *   - Renders day view
 *   - View toggle changes view
 *   - Navigation buttons work (prev/next)
 *   - Today button jumps to current date
 *   - Events render in correct day cells
 *   - Today is highlighted with special class
 *   - Empty state when no events
 *   - Click on event calls onEventClick
 *   - CRUD: "+ New Event" button renders and opens form
 *   - CRUD: Form has title and date fields
 *   - CRUD: Clicking event opens detail with Edit/Delete
 *   - CRUD: onSaveEvent called with form data
 *   - CRUD: onDeleteEvent called on confirm
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAxe } from '../../__tests__/util/axe.js';
import type { CalendarViewEvent } from '../calendar-view.js';
import { CalendarView } from '../calendar-view.js';

afterEach(cleanup);

// jsdom does not implement HTMLDialogElement.showModal() natively.
// Polyfill the bare minimum so the Dialog component can call it.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const TEST_DATE = new Date(2026, 4, 15); // May 15, 2026 (Thursday)

const SAMPLE_EVENTS: readonly CalendarViewEvent[] = [
  {
    id: 'evt-1',
    title: 'Team Standup',
    start: '2026-05-15T09:00',
    duration: 'PT30M',
    calendarColor: '#3b82f6',
    status: 'confirmed',
    description: 'Daily sync',
    location: 'Room A',
  },
  {
    id: 'evt-2',
    title: 'Lunch Meeting',
    start: '2026-05-15T12:00',
    duration: 'PT1H',
    calendarColor: '#10b981',
    status: 'confirmed',
  },
  {
    id: 'evt-3',
    title: 'Design Review',
    start: '2026-05-16T14:00',
    duration: 'PT1H30M',
    calendarColor: '#f59e0b',
    status: 'tentative',
  },
];

function noop() {
  // no-op
}

describe('CalendarView', () => {
  describe('month view', () => {
    it('renders month view with day grid', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // Should show day-of-week headers
      expect(screen.getByText('Sun')).toBeInTheDocument();
      expect(screen.getByText('Mon')).toBeInTheDocument();
      expect(screen.getByText('Tue')).toBeInTheDocument();
      expect(screen.getByText('Wed')).toBeInTheDocument();
      expect(screen.getByText('Thu')).toBeInTheDocument();
      expect(screen.getByText('Fri')).toBeInTheDocument();
      expect(screen.getByText('Sat')).toBeInTheDocument();

      // Should show the current month label
      expect(screen.getByText('May 2026')).toBeInTheDocument();
    });

    it('renders day numbers for the month', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // May 2026 has 31 days — check a few using getAllByText since
      // trailing/leading days may share numbers
      expect(screen.getAllByText('15').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('31').length).toBeGreaterThanOrEqual(1);
    });

    it('highlights today with a special class', () => {
      // Use current real date so "today" logic fires
      const today = new Date();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={today}
          onDateChange={noop}
        />,
      );

      const todayCell = screen.getByTestId('calendar-day-today');
      expect(todayCell).toBeInTheDocument();
    });

    it('renders event dots in month view', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // May 15 has 2 events — should show dots
      const day15 = screen.getByTestId('calendar-day-2026-05-15');
      const dots = day15.querySelectorAll('[data-testid="event-dot"]');
      expect(dots.length).toBe(2);
    });

    it('clicking a day calls onDateChange', () => {
      const onDateChange = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={onDateChange}
        />,
      );

      const day20 = screen.getByTestId('calendar-day-2026-05-20');
      fireEvent.click(day20);

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const calledDate = onDateChange.mock.calls[0]![0] as Date;
      expect(calledDate.getFullYear()).toBe(2026);
      expect(calledDate.getMonth()).toBe(4); // May
      expect(calledDate.getDate()).toBe(20);
    });
  });

  describe('week view', () => {
    it('renders week view with time slots', () => {
      render(
        <CalendarView
          events={[]}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // Should show hourly time labels
      expect(screen.getByText('12 AM')).toBeInTheDocument();
      expect(screen.getByText('9 AM')).toBeInTheDocument();
      expect(screen.getByText('12 PM')).toBeInTheDocument();
      expect(screen.getByText('5 PM')).toBeInTheDocument();
    });

    it('renders events as blocks in week view', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      expect(screen.getByText('Team Standup')).toBeInTheDocument();
      expect(screen.getByText('Lunch Meeting')).toBeInTheDocument();
    });

    it('renders all-day events in a dedicated strip (PR 13, §8.4)', () => {
      const allDay: CalendarViewEvent = {
        id: 'evt-ad',
        title: 'Company Holiday',
        start: '2026-05-15T00:00',
        duration: 'P1D',
        status: 'confirmed',
      };
      render(
        <CalendarView
          events={[...SAMPLE_EVENTS, allDay]}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // All-day strip label visible.
      expect(screen.getByText(/all-day/i)).toBeInTheDocument();
      // The chip renders the title and is in the strip (data-testid).
      const chips = screen.getAllByTestId('all-day-chip');
      expect(chips).toHaveLength(1);
      expect(chips[0]!.textContent).toBe('Company Holiday');
    });

    it('omits the all-day strip when the week has no P1D events', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      expect(screen.queryByText(/all-day/i)).not.toBeInTheDocument();
    });
  });

  describe('day view', () => {
    it('renders day view with time slots', () => {
      render(
        <CalendarView
          events={[]}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // Should show the day header (May 15, 2026 is a Friday)
      expect(screen.getByText(/Fri.*May 15/)).toBeInTheDocument();

      // Should show hourly time labels
      expect(screen.getByText('12 AM')).toBeInTheDocument();
      expect(screen.getByText('6 AM')).toBeInTheDocument();
      expect(screen.getByText('12 PM')).toBeInTheDocument();
      expect(screen.getByText('11 PM')).toBeInTheDocument();
    });

    it('renders events in day view', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      expect(screen.getByText('Team Standup')).toBeInTheDocument();
      expect(screen.getByText('Lunch Meeting')).toBeInTheDocument();
      // evt-3 is on the 16th, should not show in day view for the 15th
      expect(screen.queryByText('Design Review')).not.toBeInTheDocument();
    });
  });

  describe('view toggle', () => {
    it('calls onViewChange when toggling views', () => {
      const onViewChange = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={onViewChange}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Week' }));
      expect(onViewChange).toHaveBeenCalledWith('week');

      fireEvent.click(screen.getByRole('button', { name: 'Day' }));
      expect(onViewChange).toHaveBeenCalledWith('day');

      fireEvent.click(screen.getByRole('button', { name: 'Month' }));
      expect(onViewChange).toHaveBeenCalledWith('month');
    });
  });

  describe('navigation', () => {
    it('previous button navigates to previous period', () => {
      const onDateChange = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={onDateChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /previous/i }));

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const calledDate = onDateChange.mock.calls[0]![0] as Date;
      // Previous month from May = April
      expect(calledDate.getMonth()).toBe(3);
    });

    it('next button navigates to next period', () => {
      const onDateChange = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={onDateChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const calledDate = onDateChange.mock.calls[0]![0] as Date;
      // Next month from May = June
      expect(calledDate.getMonth()).toBe(5);
    });

    it('today button jumps to current date', () => {
      const onDateChange = vi.fn();
      // Start on a date far from today
      const farDate = new Date(2025, 0, 1);
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={farDate}
          onDateChange={onDateChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /today/i }));

      expect(onDateChange).toHaveBeenCalledTimes(1);
      const calledDate = onDateChange.mock.calls[0]![0] as Date;
      const now = new Date();
      expect(calledDate.getFullYear()).toBe(now.getFullYear());
      expect(calledDate.getMonth()).toBe(now.getMonth());
      expect(calledDate.getDate()).toBe(now.getDate());
    });
  });

  describe('event interaction', () => {
    it('clicking an event calls onEventClick', () => {
      const onEventClick = vi.fn();
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onEventClick={onEventClick}
        />,
      );

      fireEvent.click(screen.getByText('Team Standup'));
      expect(onEventClick).toHaveBeenCalledWith('evt-1');
    });
  });

  describe('empty state', () => {
    it('renders empty state when no events', () => {
      render(
        <CalendarView
          events={[]}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      // Day view with no events should still show time slots (not crash)
      expect(screen.getByText('12 AM')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          isLoading={true}
        />,
      );

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations in month view', async () => {
      const { container } = render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      expect(await runAxe(container)).toEqual([]);
    });

    it('has no axe violations in week view', async () => {
      const { container } = render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      expect(await runAxe(container)).toEqual([]);
    });

    it('has no axe violations in day view', async () => {
      const { container } = render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      expect(await runAxe(container)).toEqual([]);
    });
  });

  describe('roving keyboard focus (PR 17, §8.4)', () => {
    it('moves focus cell-to-cell with arrow keys', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      // Initial focus defaults to today when today falls in the
      // visible grid, otherwise the currentDate — either way, click
      // the test target to put the cursor where we expect it.
      const start = screen.getByTestId('calendar-day-2026-05-15');
      fireEvent.click(start);
      expect(start).toHaveAttribute('tabindex', '0');

      // ArrowRight → 16 May becomes focusable.
      fireEvent.keyDown(start, { key: 'ArrowRight' });
      const next = screen.getByTestId('calendar-day-2026-05-16');
      expect(next).toHaveAttribute('tabindex', '0');
      expect(start).toHaveAttribute('tabindex', '-1');
    });

    it('ArrowDown moves a week ahead', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      const start = screen.getByTestId('calendar-day-2026-05-15');
      fireEvent.click(start);
      fireEvent.keyDown(start, { key: 'ArrowDown' });
      // 15 May + 7 days = 22 May.
      expect(screen.getByTestId('calendar-day-2026-05-22')).toHaveAttribute(
        'tabindex',
        '0',
      );
    });

    it('Enter on a focused cell calls onDateChange with that day', () => {
      const onDateChange = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={onDateChange}
        />,
      );
      const cell = screen.getByTestId('calendar-day-2026-05-15');
      fireEvent.keyDown(cell, { key: 'Enter' });
      expect(onDateChange).toHaveBeenCalled();
      const got = onDateChange.mock.calls[0]![0] as Date;
      expect(got.getFullYear()).toBe(2026);
      expect(got.getMonth()).toBe(4);
      expect(got.getDate()).toBe(15);
    });

    it('only one cell is in the tab order at a time', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      const focusable = document.querySelectorAll<HTMLElement>(
        '[data-date][tabindex="0"]',
      );
      expect(focusable.length).toBe(1);
    });
  });

  describe('tentative / agent treatment (PR 15, §8.4)', () => {
    it('marks tentative status in the aria-label', () => {
      const tentative: CalendarViewEvent = {
        id: 'evt-t',
        title: 'Maybe Lunch',
        start: '2026-05-15T12:00',
        duration: 'PT1H',
        status: 'tentative',
      };
      render(
        <CalendarView
          events={[tentative]}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      const block = screen.getByRole('button', { name: /maybe lunch \(tentative\)/i });
      expect(block).toBeInTheDocument();
    });

    it('renders the agent dot + accent treatment for createdBy=agent', () => {
      const agentEvent: CalendarViewEvent = {
        id: 'evt-a',
        title: 'Scheduling hold',
        start: '2026-05-15T14:00',
        duration: 'PT1H',
        createdBy: 'agent',
      };
      render(
        <CalendarView
          events={[agentEvent]}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      // aria-label folds in the "booked by agent" tag so screen-reader
      // users get the same signal sighted users get from the dot.
      expect(
        screen.getByRole('button', { name: /scheduling hold \(booked by agent\)/i }),
      ).toBeInTheDocument();
    });
  });

  describe('slot + affordance (PR 15, §8.4)', () => {
    it('renders + buttons in week slots when onCreateEvent is provided', () => {
      const onCreateEvent = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onCreateEvent={onCreateEvent}
        />,
      );
      const buttons = screen.getAllByTestId('slot-add');
      // 24 hours × 7 days = 168 slots.
      expect(buttons.length).toBe(24 * 7);
    });

    it('omits + buttons when onCreateEvent is not provided', () => {
      render(
        <CalendarView
          events={[]}
          view="week"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      expect(screen.queryAllByTestId('slot-add')).toHaveLength(0);
    });

    it('clicking + calls onCreateEvent with the slot date/time', () => {
      const onCreateEvent = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onCreateEvent={onCreateEvent}
        />,
      );
      const buttons = screen.getAllByTestId('slot-add');
      // Day view: 24 hour slots; click the first one (00:00).
      fireEvent.click(buttons[0]!);
      expect(onCreateEvent).toHaveBeenCalled();
      const calledWith = onCreateEvent.mock.calls[0]![0] as Date;
      expect(calledWith.getHours()).toBe(0);
    });
  });

  describe('visibility rail (PR 14, §8.4)', () => {
    const SAMPLE_CALENDARS = [
      { id: 'cal-1', name: 'Personal', color: '#3b82f6', isDefault: true },
      { id: 'cal-2', name: 'Work', color: '#10b981', isDefault: false },
    ];

    it('renders one row per calendar with color swatch and checkbox', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          calendars={SAMPLE_CALENDARS}
          hiddenCalendarIds={[]}
          onToggleCalendar={noop}
        />,
      );
      expect(screen.getByRole('checkbox', { name: /hide personal/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /hide work/i })).toBeChecked();
    });

    it('renders hidden calendars with unchecked boxes', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          calendars={SAMPLE_CALENDARS}
          hiddenCalendarIds={['cal-2']}
          onToggleCalendar={noop}
        />,
      );
      expect(screen.getByRole('checkbox', { name: /hide personal/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /show work/i })).not.toBeChecked();
    });

    it('calls onToggleCalendar with the calendar id when clicked', () => {
      const onToggleCalendar = vi.fn();
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          calendars={SAMPLE_CALENDARS}
          hiddenCalendarIds={[]}
          onToggleCalendar={onToggleCalendar}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: /hide work/i }));
      expect(onToggleCalendar).toHaveBeenCalledWith('cal-2');
    });

    it('omits the rail when no calendars prop is passed', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );
      expect(screen.queryByRole('region', { name: /calendars/i })).not.toBeInTheDocument();
    });
  });

  describe('CRUD: create/edit/delete', () => {
    it('renders "+ New Event" button when onSaveEvent is provided', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
        />,
      );

      expect(screen.getByRole('button', { name: /new event/i })).toBeInTheDocument();
    });

    it('does not render "+ New Event" button without onSaveEvent', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
        />,
      );

      expect(screen.queryByRole('button', { name: /new event/i })).not.toBeInTheDocument();
    });

    it('clicking "+ New Event" opens the form dialog', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /new event/i }));

      // Dialog should be open with title and date fields
      expect(screen.getByText('New Event')).toBeInTheDocument();
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    });

    it('event form has all expected fields', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /new event/i }));

      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/start time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
    });

    it('clicking an event opens detail view with Edit and Delete buttons', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
          onUpdateEvent={async () => {}}
          onDeleteEvent={async () => {}}
        />,
      );

      // Click on an event block
      fireEvent.click(screen.getByText('Team Standup'));

      // Detail view should show event info
      expect(screen.getByTestId('event-detail')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /edit event/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /delete event/i })).toBeInTheDocument();
    });

    it('event detail shows description and location when present', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onUpdateEvent={async () => {}}
          onDeleteEvent={async () => {}}
        />,
      );

      fireEvent.click(screen.getByText('Team Standup'));

      expect(screen.getByText('Daily sync')).toBeInTheDocument();
      expect(screen.getByText('Room A')).toBeInTheDocument();
    });

    it('onSaveEvent is called with form data on save', async () => {
      const onSaveEvent = vi.fn().mockResolvedValue(undefined);

      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={onSaveEvent}
        />,
      );

      // Open form
      fireEvent.click(screen.getByRole('button', { name: /new event/i }));

      // Fill in title
      fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My New Event' } });

      // Fill in date
      fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-05-20' } });

      // Click save
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(onSaveEvent).toHaveBeenCalledTimes(1);
      });

      const callArg = onSaveEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArg.title).toBe('My New Event');
      expect(callArg.date).toBe('2026-05-20');
      expect(callArg.startTime).toBe('09:00');
      expect(callArg.duration).toBe('PT1H');
    });

    it('onDeleteEvent is called when delete is confirmed', async () => {
      const onDeleteEvent = vi.fn().mockResolvedValue(undefined);

      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onUpdateEvent={async () => {}}
          onDeleteEvent={onDeleteEvent}
        />,
      );

      // Click on event to open detail
      fireEvent.click(screen.getByText('Team Standup'));

      // Click delete button in detail view
      fireEvent.click(screen.getByRole('button', { name: /delete event/i }));

      // Confirmation dialog should appear
      expect(screen.getByText(/delete this event/i)).toBeInTheDocument();
      // "Team Standup" appears both in the event block and the confirmation text
      expect(screen.getAllByText(/team standup/i).length).toBeGreaterThanOrEqual(1);

      // Confirm the deletion
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => {
        expect(onDeleteEvent).toHaveBeenCalledWith('evt-1');
      });
    });

    it('clicking empty day cell opens form with that date pre-filled', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
        />,
      );

      // Double-click on May 20 cell to create an event
      const day20 = screen.getByTestId('calendar-day-2026-05-20');
      fireEvent.doubleClick(day20);

      // Form should open with date pre-filled
      expect(screen.getByText('New Event')).toBeInTheDocument();
      const dateInput = screen.getByLabelText(/date/i) as HTMLInputElement;
      expect(dateInput.value).toBe('2026-05-20');
    });

    it('clicking Edit in detail view opens the edit form', () => {
      render(
        <CalendarView
          events={SAMPLE_EVENTS}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
          onUpdateEvent={async () => {}}
          onDeleteEvent={async () => {}}
        />,
      );

      // Click event to open detail
      fireEvent.click(screen.getByText('Team Standup'));

      // Click Edit
      fireEvent.click(screen.getByRole('button', { name: /edit event/i }));

      // Edit form should show with pre-filled title
      expect(screen.getByText('Edit Event')).toBeInTheDocument();
      const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
      expect(titleInput.value).toBe('Team Standup');
    });
  });

  // PR 54 / CoWork #7 — attendees editor + participants display.
  describe('attendees editor (PR 54)', () => {
    it('add → chip appears; remove → chip disappears', () => {
      const onSaveEvent = vi.fn().mockResolvedValue(undefined);
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={onSaveEvent}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /new event/i }));
      const input = screen.getByLabelText(/attendees/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'alice@example.invalid' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      const chips = screen.getByRole('list', { name: /invited attendees/i });
      expect(chips.textContent).toContain('alice@example.invalid');

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove alice@example.invalid' }),
      );
      expect(
        screen.queryByRole('list', { name: /invited attendees/i }),
      ).toBeNull();
    });

    it('rejects an invalid email — chip is not created', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /new event/i }));
      const input = screen.getByLabelText(/attendees/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'not-an-email' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      // The chip list never materializes; an alert announces the error.
      expect(
        screen.queryByRole('list', { name: /invited attendees/i }),
      ).toBeNull();
      expect(screen.getByRole('alert').textContent).toMatch(/email/i);
    });

    it('toggle required ↔ optional on a chip', () => {
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={async () => {}}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /new event/i }));
      const input = screen.getByLabelText(/attendees/i);
      fireEvent.change(input, { target: { value: 'bob@example.invalid' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      const toggle = screen.getByRole('button', { name: 'required' });
      fireEvent.click(toggle);
      expect(screen.getByRole('button', { name: 'optional' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('save dispatches attendees in the EventFormData payload', async () => {
      const onSaveEvent = vi.fn().mockResolvedValue(undefined);
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onSaveEvent={onSaveEvent}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /new event/i }));
      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'Planning' },
      });
      fireEvent.change(screen.getByLabelText(/attendees/i), {
        target: { value: 'alice@example.invalid' },
      });
      fireEvent.keyDown(screen.getByLabelText(/attendees/i), { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(onSaveEvent).toHaveBeenCalledTimes(1));
      const arg = onSaveEvent.mock.calls[0]![0] as { attendees?: unknown[] };
      expect(arg.attendees).toEqual([{ email: 'alice@example.invalid' }]);
    });
  });

  describe('participants display in event detail (PR 54)', () => {
    it('renders attendee names + PARTSTAT badge', () => {
      const evt: CalendarViewEvent = {
        id: 'evt-9',
        title: 'Planning',
        start: '2026-05-15T10:00',
        duration: 'PT1H',
        participants: [
          {
            email: 'brent@r3motely.com',
            name: 'Brent',
            roles: { owner: true, chair: true },
            participationStatus: 'accepted',
          },
          {
            email: 'alice@example.invalid',
            roles: { attendee: true },
            participationStatus: 'tentative',
          },
          {
            email: 'bob@example.invalid',
            roles: { attendee: true, optional: true },
          },
        ],
      };
      render(
        <CalendarView
          events={[evt]}
          view="day"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          onUpdateEvent={async () => {}}
        />,
      );
      fireEvent.click(screen.getByText('Planning'));
      expect(screen.getByText('Brent <brent@r3motely.com>')).toBeInTheDocument();
      expect(screen.getByText('Accepted')).toBeInTheDocument();
      expect(screen.getByText('Tentative')).toBeInTheDocument();
      expect(screen.getByText('Awaiting reply')).toBeInTheDocument();
      expect(screen.getByText('organizer')).toBeInTheDocument();
      expect(screen.getByText('optional')).toBeInTheDocument();
    });
  });

  // ── Task 9: CalendarRail + / row menu ──────────────────────────
  describe('CalendarRail CRUD affordances (Task 9)', () => {
    function renderCalendarView(overrides: {
      calendars?: Array<{ id: string; name: string; color?: string; isDefault: boolean }>;
      onCreateCalendar?: () => void;
      onEditCalendar?: (id: string) => void;
      onDeleteCalendar?: (id: string) => void;
    }) {
      const {
        calendars = [{ id: 'b', name: 'Personal', isDefault: true }],
        onCreateCalendar,
        onEditCalendar,
        onDeleteCalendar,
      } = overrides;
      render(
        <CalendarView
          events={[]}
          view="month"
          onViewChange={noop}
          currentDate={TEST_DATE}
          onDateChange={noop}
          calendars={calendars}
          hiddenCalendarIds={[]}
          onToggleCalendar={noop}
          {...(onCreateCalendar !== undefined ? { onCreateCalendar } : {})}
          {...(onEditCalendar !== undefined ? { onEditCalendar } : {})}
          {...(onDeleteCalendar !== undefined ? { onDeleteCalendar } : {})}
        />,
      );
    }

    it('shows "+ New calendar" and fires onCreateCalendar', () => {
      const onCreateCalendar = vi.fn();
      renderCalendarView({
        calendars: [{ id: 'b', name: 'Personal', isDefault: true }],
        onCreateCalendar,
      });
      fireEvent.click(screen.getByRole('button', { name: /new calendar/i }));
      expect(onCreateCalendar).toHaveBeenCalled();
    });

    it('hides Delete on the default calendar row', () => {
      const onEditCalendar = vi.fn();
      const onDeleteCalendar = vi.fn();
      renderCalendarView({
        calendars: [{ id: 'b', name: 'Personal', isDefault: true }],
        onEditCalendar,
        onDeleteCalendar,
      });
      // Open the row menu for the default row
      fireEvent.click(screen.getByRole('button', { name: /personal actions/i }));
      // Edit should be present
      expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
      // Delete should be absent for the default row
      expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('shows Delete on non-default calendar row', () => {
      const onEditCalendar = vi.fn();
      const onDeleteCalendar = vi.fn();
      renderCalendarView({
        calendars: [
          { id: 'a', name: 'Work', isDefault: false },
        ],
        onEditCalendar,
        onDeleteCalendar,
      });
      fireEvent.click(screen.getByRole('button', { name: /work actions/i }));
      expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
    });

    it('Edit menu item fires onEditCalendar with the calendar id', () => {
      const onEditCalendar = vi.fn();
      renderCalendarView({
        calendars: [{ id: 'cal-work', name: 'Work', isDefault: false }],
        onEditCalendar,
      });
      fireEvent.click(screen.getByRole('button', { name: /work actions/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
      expect(onEditCalendar).toHaveBeenCalledWith('cal-work');
    });

    it('Delete menu item fires onDeleteCalendar with the calendar id', () => {
      const onDeleteCalendar = vi.fn();
      renderCalendarView({
        calendars: [{ id: 'cal-work', name: 'Work', isDefault: false }],
        onDeleteCalendar,
      });
      fireEvent.click(screen.getByRole('button', { name: /work actions/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
      expect(onDeleteCalendar).toHaveBeenCalledWith('cal-work');
    });
  });
});
