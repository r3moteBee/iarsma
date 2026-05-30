/**
 * ContactsView -- contact list + detail pane for Phase 4c.
 *
 * Desktop: two-column layout (scrollable list + detail pane).
 * Mobile: single column list; tap pushes to detail view.
 *
 * Purely presentational -- data fetching and search are delegated
 * to callback props.
 */

import { useState } from 'react';
import { Avatar, Button, Dialog, Input } from '../components/index.js';
import styles from './contacts-view.module.css';

// -- Types ---------------------------------------------------------------

export type Contact = {
  readonly id: string;
  readonly name?: { readonly full?: string; readonly given?: string; readonly surname?: string };
  readonly emails?: readonly { readonly address: string; readonly label?: string }[];
  readonly phones?: readonly { readonly number: string; readonly label?: string }[];
  readonly organizations?: readonly { readonly name?: string; readonly title?: string }[];
};

export type ContactFormData = {
  readonly givenName?: string;
  readonly surname?: string;
  readonly email: string;
  readonly phone?: string;
  readonly organization?: string;
  readonly title?: string;
};

export type ContactsViewProps = {
  readonly contacts: readonly Contact[];
  readonly selectedContact: Contact | null;
  readonly onSelect: (id: string) => void;
  readonly onSearch: (query: string) => void;
  readonly searchQuery: string;
  readonly isLoading?: boolean;
  // CRUD callbacks
  readonly onCreateContact?: (input: ContactFormData) => Promise<void>;
  readonly onUpdateContact?: (id: string, input: ContactFormData) => Promise<void>;
  readonly onDeleteContact?: (id: string) => Promise<void>;
};

// -- Helpers -------------------------------------------------------------

function displayName(contact: Contact): string {
  if (contact.name?.full) return contact.name.full;
  if (contact.name?.given && contact.name?.surname) {
    return `${contact.name.given} ${contact.name.surname}`;
  }
  if (contact.name?.given) return contact.name.given;
  if (contact.name?.surname) return contact.name.surname;
  if (contact.emails && contact.emails.length > 0) {
    return contact.emails[0]!.address;
  }
  return 'Unknown';
}

function primaryEmail(contact: Contact): string | undefined {
  return contact.emails?.[0]?.address;
}

function contactToFormData(contact: Contact): ContactFormData {
  return {
    givenName: contact.name?.given ?? '',
    surname: contact.name?.surname ?? '',
    email: contact.emails?.[0]?.address ?? '',
    phone: contact.phones?.[0]?.number ?? '',
    organization: contact.organizations?.[0]?.name ?? '',
    title: contact.organizations?.[0]?.title ?? '',
  };
}

// -- Component -----------------------------------------------------------

export function ContactsView({
  contacts,
  selectedContact,
  onSelect,
  onSearch,
  searchQuery,
  isLoading,
  onCreateContact,
  onUpdateContact,
  onDeleteContact,
}: ContactsViewProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function handleAddClick() {
    setEditingContact(null);
    setFormOpen(true);
  }

  function handleEditClick() {
    if (selectedContact !== null) {
      setEditingContact(selectedContact);
      setFormOpen(true);
    }
  }

  function handleDeleteClick() {
    setDeleteOpen(true);
  }

  async function handleFormSave(data: ContactFormData) {
    try {
      if (editingContact !== null && onUpdateContact !== undefined) {
        await onUpdateContact(editingContact.id, data);
      } else if (onCreateContact !== undefined) {
        await onCreateContact(data);
      }
      setFormOpen(false);
      setEditingContact(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[contacts] save failed:', err);
      throw err;
    }
  }

  function handleFormCancel() {
    setFormOpen(false);
    setEditingContact(null);
  }

  async function handleDeleteConfirm() {
    if (selectedContact !== null && onDeleteContact !== undefined) {
      await onDeleteContact(selectedContact.id);
    }
    setDeleteOpen(false);
  }

  function handleDeleteCancel() {
    setDeleteOpen(false);
  }

  return (
    <div className={styles['container']}>
      {/* Contact list pane */}
      <div className={`${styles['listPane']} ${selectedContact === null ? '' : ''}`}>
        {/* Search + Add */}
        <div className={styles['searchBar']}>
          <input
            type="search"
            className={styles['searchInput']}
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search contacts"
          />
          {onCreateContact !== undefined && (
            <Button variant="primary" size="sm" onClick={handleAddClick}>
              + Add Contact
            </Button>
          )}
        </div>

        {/* Loading */}
        {isLoading === true && (
          <div className={styles['emptyState']}>
            <p>Loading contacts...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && contacts.length === 0 && (
          <div className={styles['emptyState']}>
            <p>No contacts found.</p>
          </div>
        )}

        {/* Contact list */}
        {contacts.length > 0 && (
          <ul className={styles['contactList']} role="list">
            {contacts.map((contact) => {
              const name = displayName(contact);
              const email = primaryEmail(contact);
              const isSelected = selectedContact?.id === contact.id;
              return (
                <li key={contact.id}>
                  <button
                    type="button"
                    className={`${styles['contactItem']} ${isSelected ? styles['selected'] : ''}`}
                    onClick={() => onSelect(contact.id)}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <Avatar name={name} size="sm" />
                    <div className={styles['contactItemText']}>
                      <span className={styles['contactName']}>{name}</span>
                      {email !== undefined && (
                        <span className={styles['contactEmail']}>{email}</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Detail pane */}
      {selectedContact !== null ? (
        <ContactDetail
          contact={selectedContact}
          {...(onUpdateContact !== undefined ? { onEdit: handleEditClick } : {})}
          {...(onDeleteContact !== undefined ? { onDelete: handleDeleteClick } : {})}
        />
      ) : (
        <div className={styles['emptyDetail']}>
          Select a contact to view details
        </div>
      )}

      {/* Contact form dialog */}
      <ContactFormDialog
        open={formOpen}
        contact={editingContact}
        onSave={handleFormSave}
        onCancel={handleFormCancel}
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteOpen}
        onClose={handleDeleteCancel}
        title="Delete contact"
        footer={
          <div className={styles['dialogFooter']}>
            <Button variant="secondary" onClick={handleDeleteCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </div>
        }
      >
        <p>Delete this contact?</p>
      </Dialog>
    </div>
  );
}

// -- Contact form dialog -------------------------------------------------

type ContactFormDialogProps = {
  readonly open: boolean;
  readonly contact: Contact | null;
  readonly onSave: (data: ContactFormData) => Promise<void> | void;
  readonly onCancel: () => void;
};

function ContactFormDialog({ open, contact, onSave, onCancel }: ContactFormDialogProps) {
  const initial = contact !== null ? contactToFormData(contact) : {
    givenName: '',
    surname: '',
    email: '',
    phone: '',
    organization: '',
    title: '',
  };

  const [givenName, setGivenName] = useState(initial.givenName ?? '');
  const [surname, setSurname] = useState(initial.surname ?? '');
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [organization, setOrganization] = useState(initial.organization ?? '');
  const [title, setTitle] = useState(initial.title ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens or contact changes
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    const data = contact !== null ? contactToFormData(contact) : {
      givenName: '',
      surname: '',
      email: '',
      phone: '',
      organization: '',
      title: '',
    };
    setGivenName(data.givenName ?? '');
    setSurname(data.surname ?? '');
    setEmail(data.email);
    setPhone(data.phone ?? '');
    setOrganization(data.organization ?? '');
    setTitle(data.title ?? '');
    setErrors({});
  }
  if (open !== prevOpen) {
    setPrevOpen(open);
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!givenName.trim() && !surname.trim()) {
      newErrors['givenName'] = 'At least a given name or surname is required';
    }
    if (!email.trim()) {
      newErrors['email'] = 'Email is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    const data: ContactFormData = {
      email: email.trim(),
      ...(givenName.trim() ? { givenName: givenName.trim() } : {}),
      ...(surname.trim() ? { surname: surname.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(organization.trim() ? { organization: organization.trim() } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSave(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  const dialogTitle = contact !== null ? 'Edit Contact' : 'Add Contact';

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={dialogTitle}
      footer={
        <div className={styles['dialogFooter']}>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className={styles['contactForm']}>
        {submitError !== null && (
          <div role="alert" style={{ padding: '0.5em 0.75em', background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', color: 'var(--destructive)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)' }}>
            {submitError}
          </div>
        )}
        <Input
          label="Given name"
          value={givenName}
          onChange={setGivenName}
          {...(errors['givenName'] !== undefined ? { error: errors['givenName'] } : {})}
        />
        <Input
          label="Surname"
          value={surname}
          onChange={setSurname}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          {...(errors['email'] !== undefined ? { error: errors['email'] } : {})}
        />
        <Input
          label="Phone"
          value={phone}
          onChange={setPhone}
        />
        <Input
          label="Organization"
          value={organization}
          onChange={setOrganization}
        />
        <Input
          label="Title"
          value={title}
          onChange={setTitle}
        />
      </div>
    </Dialog>
  );
}

// -- Detail pane ---------------------------------------------------------

type ContactDetailProps = {
  readonly contact: Contact;
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
};

function ContactDetail({ contact, onEdit, onDelete }: ContactDetailProps) {
  const name = displayName(contact);
  return (
    <div className={styles['detailPane']} role="region" aria-label="Contact detail">
      {/* Header with avatar + name */}
      <div className={styles['detailHeader']}>
        <Avatar name={name} size="lg" />
        <h2 className={styles['detailName']}>{name}</h2>
        {(onEdit !== undefined || onDelete !== undefined) && (
          <div className={styles['detailActions']}>
            {onEdit !== undefined && (
              <Button variant="secondary" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
            {onDelete !== undefined && (
              <Button variant="destructive" size="sm" onClick={onDelete}>
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Emails */}
      {contact.emails && contact.emails.length > 0 && (
        <div className={styles['detailSection']}>
          <div className={styles['detailSectionTitle']}>Email</div>
          {contact.emails.map((email, i) => (
            <div key={i} className={styles['detailItem']}>
              {email.label && (
                <span className={styles['detailLabel']}>{email.label}</span>
              )}
              <span>{email.address}</span>
            </div>
          ))}
        </div>
      )}

      {/* Phones */}
      {contact.phones && contact.phones.length > 0 && (
        <div className={styles['detailSection']}>
          <div className={styles['detailSectionTitle']}>Phone</div>
          {contact.phones.map((phone, i) => (
            <div key={i} className={styles['detailItem']}>
              {phone.label && (
                <span className={styles['detailLabel']}>{phone.label}</span>
              )}
              <span>{phone.number}</span>
            </div>
          ))}
        </div>
      )}

      {/* Organizations */}
      {contact.organizations && contact.organizations.length > 0 && (
        <div className={styles['detailSection']}>
          <div className={styles['detailSectionTitle']}>Organization</div>
          {contact.organizations.map((org, i) => (
            <div key={i} className={styles['detailItem']}>
              {org.name && <span>{org.name}</span>}
              {org.title && <span>{org.title}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
