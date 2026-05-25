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
 *   - "Add Contact" button renders and opens form dialog.
 *   - Form has required fields (name, email).
 *   - "Edit" button in detail pane opens pre-filled form.
 *   - "Delete" button shows confirmation.
 *   - onCreateContact called with form data on save.
 *   - onDeleteContact called on confirm delete.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact, ContactsViewProps } from '../contacts-view.js';
import { ContactsView } from '../contacts-view.js';

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

describe('ContactsView CRUD', () => {
  it('"Add Contact" button renders when onCreateContact is provided', () => {
    renderView({ onCreateContact: vi.fn() });
    expect(screen.getByText('+ Add Contact')).toBeInTheDocument();
  });

  it('"Add Contact" button does not render when onCreateContact is not provided', () => {
    renderView();
    expect(screen.queryByText('+ Add Contact')).toBeNull();
  });

  it('clicking "Add Contact" opens the form dialog', () => {
    renderView({ onCreateContact: vi.fn() });
    fireEvent.click(screen.getByText('+ Add Contact'));
    expect(screen.getByText('Add Contact', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByLabelText('Given name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('form has required fields (given name / surname, email)', () => {
    renderView({ onCreateContact: vi.fn() });
    fireEvent.click(screen.getByText('+ Add Contact'));
    expect(screen.getByLabelText('Given name')).toBeInTheDocument();
    expect(screen.getByLabelText('Surname')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  it('form validation: shows error when name and email are empty', () => {
    renderView({ onCreateContact: vi.fn() });
    fireEvent.click(screen.getByText('+ Add Contact'));
    // Click Save without filling anything
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText(/at least a given name or surname is required/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
  });

  it('onCreateContact called with form data on save', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderView({ onCreateContact: onCreate });
    fireEvent.click(screen.getByText('+ Add Contact'));

    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+1-555-9999' } });
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'TestCorp' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Manager' } });

    fireEvent.click(screen.getByText('Save'));

    expect(onCreate).toHaveBeenCalledWith({
      givenName: 'Jane',
      surname: 'Doe',
      email: 'jane@example.com',
      phone: '+1-555-9999',
      organization: 'TestCorp',
      title: 'Manager',
    });
  });

  it('"Edit" button in detail pane opens pre-filled form', () => {
    renderView({
      selectedContact: SAMPLE_CONTACTS[0]!,
      onUpdateContact: vi.fn(),
    });
    const detailRegion = screen.getByRole('region', { name: /contact detail/i });
    const editBtn = within(detailRegion).getByText('Edit');
    fireEvent.click(editBtn);

    expect(screen.getByText('Edit Contact', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByLabelText('Given name')).toHaveValue('Alice');
    expect(screen.getByLabelText('Surname')).toHaveValue('Smith');
    expect(screen.getByLabelText('Email')).toHaveValue('alice@example.com');
    expect(screen.getByLabelText('Phone')).toHaveValue('+1-555-0101');
    expect(screen.getByLabelText('Organization')).toHaveValue('Acme Corp');
    expect(screen.getByLabelText('Title')).toHaveValue('Engineer');
  });

  it('"Delete" button shows confirmation dialog', () => {
    renderView({
      selectedContact: SAMPLE_CONTACTS[0]!,
      onDeleteContact: vi.fn(),
    });
    const detailRegion = screen.getByRole('region', { name: /contact detail/i });
    const deleteBtn = within(detailRegion).getByText('Delete');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Delete this contact?')).toBeInTheDocument();
  });

  it('onDeleteContact called on confirm delete', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderView({
      selectedContact: SAMPLE_CONTACTS[0]!,
      onDeleteContact: onDelete,
    });
    const detailRegion = screen.getByRole('region', { name: /contact detail/i });
    fireEvent.click(within(detailRegion).getByText('Delete'));

    // Confirmation dialog has a "Delete" button in the footer
    // Find the delete button in the dialog footer (not the detail pane one)
    const dialogs = document.querySelectorAll('dialog');
    // The delete confirmation dialog
    let confirmDeleteBtn: HTMLElement | null = null;
    dialogs.forEach((dialog) => {
      const btn = within(dialog as HTMLElement).queryByText('Delete this contact?');
      if (btn) {
        confirmDeleteBtn = within(dialog as HTMLElement).getByText('Delete', { selector: 'button' });
      }
    });
    expect(confirmDeleteBtn).not.toBeNull();
    fireEvent.click(confirmDeleteBtn!);

    expect(onDelete).toHaveBeenCalledWith('CC01');
  });

  it('cancel closes the form dialog without calling callback', () => {
    const onCreate = vi.fn();
    renderView({ onCreateContact: onCreate });
    fireEvent.click(screen.getByText('+ Add Contact'));
    expect(screen.getByText('Add Contact', { selector: 'h2' })).toBeInTheDocument();

    // Click Cancel in the dialog footer
    const dialogs = document.querySelectorAll('dialog');
    let cancelBtn: HTMLElement | null = null;
    dialogs.forEach((dialog) => {
      const heading = within(dialog as HTMLElement).queryByText('Add Contact', { selector: 'h2' });
      if (heading) {
        cancelBtn = within(dialog as HTMLElement).getByText('Cancel');
      }
    });
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn!);

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('"Edit" and "Delete" buttons do not render without callbacks', () => {
    renderView({ selectedContact: SAMPLE_CONTACTS[0]! });
    const detailRegion = screen.getByRole('region', { name: /contact detail/i });
    expect(within(detailRegion).queryByText('Edit')).toBeNull();
    expect(within(detailRegion).queryByText('Delete')).toBeNull();
  });
});
