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
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAxe } from '../../__tests__/util/axe.js';
import type { CalendarViewEvent } from '../calendar-view.js';
import { CalendarView } from '../calendar-view.js';

afterEach(cleanup);

const TEST_DATE = new Date(2026, 4, 15); // May 15, 2026 (Thursday)

const SAMPLE_EVENTS: readonly CalendarViewEvent[] = [
  {
    id: 'evt-1',
    title: 'Team Standup',
    start: '2026-05-15T09:00',
    duration: 'PT30M',
    calendarColor: '#3b82f6',
    status: 'confirmed',
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
});
