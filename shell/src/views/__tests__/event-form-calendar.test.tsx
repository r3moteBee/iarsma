/**
 * @vitest-environment jsdom
 *
 * Task 5: Calendar selector in EventFormDialog.
 *
 * Harness mirrors calendar-view.test.tsx:
 * - beforeEach polyfills HTMLDialogElement.showModal/close
 * - Renders <CalendarView> with required props
 * - Opens EventFormDialog via fireEvent.click on the "New Event" button
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAxe } from '../../__tests__/util/axe.js';
import type { CalendarViewEvent } from '../calendar-view.js';
import { CalendarView } from '../calendar-view.js';

afterEach(cleanup);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const TEST_DATE = new Date(2026, 6, 1); // July 1, 2026

const calendars = [
  { id: 'cal-default', name: 'Stalwart Calendar', isDefault: true },
  { id: 'cal-personal', name: 'Personal', color: '#ff6b35' },
];

describe('EventFormDialog — calendar selector', () => {
  it('create mode defaults the selector to the default calendar', async () => {
    const onSaveEvent = vi.fn().mockResolvedValue(undefined);
    render(
      <CalendarView
        events={[]}
        calendars={calendars}
        view="month"
        onViewChange={() => {}}
        currentDate={TEST_DATE}
        onDateChange={() => {}}
        onSaveEvent={onSaveEvent}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /new event/i }));

    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText(/calendar/i) as HTMLSelectElement;
    expect(select.value).toBe('cal-default');

    fireEvent.change(within(dialog).getByLabelText(/title/i), { target: { value: 'Lunch' } });
    fireEvent.change(select, { target: { value: 'cal-personal' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(onSaveEvent).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: 'cal-personal' }),
      );
    });
  });

  it('edit mode defaults the selector to the event calendarId', async () => {
    const onUpdateEvent = vi.fn().mockResolvedValue(undefined);
    const editableEvent: CalendarViewEvent = {
      id: 'evt-edit',
      title: 'Team Meeting',
      start: '2026-07-01T10:00',
      duration: 'PT1H',
      calendarId: 'cal-personal',
      status: 'confirmed',
    };

    render(
      <CalendarView
        events={[editableEvent]}
        calendars={calendars}
        view="day"
        onViewChange={() => {}}
        currentDate={TEST_DATE}
        onDateChange={() => {}}
        onSaveEvent={async () => {}}
        onUpdateEvent={onUpdateEvent}
        onDeleteEvent={async () => {}}
      />,
    );

    // Open the event detail, then click Edit
    fireEvent.click(screen.getByText('Team Meeting'));
    fireEvent.click(screen.getByRole('button', { name: /edit event/i }));

    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText(/calendar/i) as HTMLSelectElement;
    expect(select.value).toBe('cal-personal');

    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(onUpdateEvent).toHaveBeenCalledWith(
        'evt-edit',
        expect.objectContaining({ calendarId: 'cal-personal' }),
      );
    });
  });

  it('has zero axe-core violations with the Calendar select rendered', async () => {
    const { container } = render(
      <CalendarView
        events={[]}
        calendars={calendars}
        view="month"
        onViewChange={() => {}}
        currentDate={TEST_DATE}
        onDateChange={() => {}}
        onSaveEvent={async () => {}}
      />,
    );

    // Open the event form so the Calendar <select> is present in the DOM.
    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    screen.getByRole('dialog'); // assert dialog is open

    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
