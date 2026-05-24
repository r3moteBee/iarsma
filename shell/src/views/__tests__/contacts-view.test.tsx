/**
 * @vitest-environment jsdom
 *
 * Tests for ContactsView (Phase 4c).
 *
 * Covers:
 *   - Renders contact list with names and emails.
 *   - Search input filters contacts.
 *   - Click selects a contact.
 *   - Detail pane shows selected contact info.
 *   - Empty state when no contacts.
 *   - Avatar shows initials.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Contact, ContactsViewProps } from '../contacts-view.js';
import { ContactsView } from '../contacts-view.js';

afterEach(cleanup);

const SAMPLE_CONTACTS: readonly Contact[] = [
  {
    id: 'CC01',
    name: { full: 'Alice Smith', given: 'Alice', surname: 'Smith' },
    emails: [{ address: 'alice@example.com', label: 'work' }],
    phones: [{ number: '+1-555-0101', label: 'mobile' }],
    organizations: [{ name: 'Acme Corp', title: 'Engineer' }],
  },
  {
    id: 'CC02',
    name: { full: 'Bob Jones', given: 'Bob', surname: 'Jones' },
    emails: [{ address: 'bob@example.com' }],
  },
  {
    id: 'CC03',
    name: { full: 'Charlie Brown' },
    phones: [{ number: '+1-555-0303' }],
    organizations: [{ name: 'Peanuts Inc', title: 'Philosopher' }],
  },
];

function renderView(overrides: Partial<ContactsViewProps> = {}) {
  const props: ContactsViewProps = {
    contacts: SAMPLE_CONTACTS,
    selectedContact: null,
    onSelect: vi.fn(),
    onSearch: vi.fn(),
    searchQuery: '',
    ...overrides,
  };
  return { ...render(<ContactsView {...props} />), props };
}

describe('ContactsView', () => {
  it('renders contact list with names and emails', () => {
    renderView();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
  });

  it('search input calls onSearch', () => {
    const { props } = renderView();
    const input = screen.getByPlaceholderText('Search contacts...');
    fireEvent.change(input, { target: { value: 'alice' } });
    expect(props.onSearch).toHaveBeenCalledWith('alice');
  });

  it('click selects a contact', () => {
    const { props } = renderView();
    const aliceRow = screen.getByText('Alice Smith').closest('button, [role="button"], li');
    expect(aliceRow).not.toBeNull();
    fireEvent.click(aliceRow!);
    expect(props.onSelect).toHaveBeenCalledWith('CC01');
  });

  it('detail pane shows selected contact info', () => {
    renderView({ selectedContact: SAMPLE_CONTACTS[0]! });
    // Detail pane should show the full info
    const detailRegion = screen.getByRole('region', { name: /contact detail/i });
    expect(within(detailRegion).getByText('Alice Smith')).toBeInTheDocument();
    expect(within(detailRegion).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(detailRegion).getByText('+1-555-0101')).toBeInTheDocument();
    expect(within(detailRegion).getByText('Acme Corp')).toBeInTheDocument();
    expect(within(detailRegion).getByText('Engineer')).toBeInTheDocument();
  });

  it('empty state when no contacts', () => {
    renderView({ contacts: [] });
    expect(screen.getByText(/no contacts/i)).toBeInTheDocument();
  });

  it('avatar shows initials', () => {
    renderView();
    // Avatar for "Alice Smith" should show "AS"
    const avatar = screen.getByLabelText('Alice Smith');
    expect(avatar).toHaveTextContent('AS');
  });

  it('shows loading state', () => {
    renderView({ isLoading: true });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
