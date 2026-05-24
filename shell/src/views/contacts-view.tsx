/**
 * ContactsView -- contact list + detail pane for Phase 4c.
 *
 * Desktop: two-column layout (scrollable list + detail pane).
 * Mobile: single column list; tap pushes to detail view.
 *
 * Purely presentational -- data fetching and search are delegated
 * to callback props.
 */

import { Avatar } from '../components/index.js';
import styles from './contacts-view.module.css';

// -- Types ---------------------------------------------------------------

export type Contact = {
  readonly id: string;
  readonly name?: { readonly full?: string; readonly given?: string; readonly surname?: string };
  readonly emails?: readonly { readonly address: string; readonly label?: string }[];
  readonly phones?: readonly { readonly number: string; readonly label?: string }[];
  readonly organizations?: readonly { readonly name?: string; readonly title?: string }[];
};

export type ContactsViewProps = {
  readonly contacts: readonly Contact[];
  readonly selectedContact: Contact | null;
  readonly onSelect: (id: string) => void;
  readonly onSearch: (query: string) => void;
  readonly searchQuery: string;
  readonly isLoading?: boolean;
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

// -- Component -----------------------------------------------------------

export function ContactsView({
  contacts,
  selectedContact,
  onSelect,
  onSearch,
  searchQuery,
  isLoading,
}: ContactsViewProps) {
  return (
    <div className={styles['container']}>
      {/* Contact list pane */}
      <div className={`${styles['listPane']} ${selectedContact === null ? '' : ''}`}>
        {/* Search */}
        <div className={styles['searchBar']}>
          <input
            type="search"
            className={styles['searchInput']}
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search contacts"
          />
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
        <ContactDetail contact={selectedContact} />
      ) : (
        <div className={styles['emptyDetail']}>
          Select a contact to view details
        </div>
      )}
    </div>
  );
}

// -- Detail pane ---------------------------------------------------------

function ContactDetail({ contact }: { readonly contact: Contact }) {
  const name = displayName(contact);
  return (
    <div className={styles['detailPane']} role="region" aria-label="Contact detail">
      {/* Header with avatar + name */}
      <div className={styles['detailHeader']}>
        <Avatar name={name} size="lg" />
        <h2 className={styles['detailName']}>{name}</h2>
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
