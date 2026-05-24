/**
 * Capability: contact.list
 *
 * Phase 4c work item 1. Lists all contacts for the authenticated account.
 *
 * Wire shape: `AddressBook/get` → `ContactCard/query` → chained
 * `ContactCard/get` under the `urn:ietf:params:jmap:contacts` capability.
 * The response carries a flat list of contact card records.
 *
 * Scope is `contact:read` — only callers permitted to read contact
 * data need to enumerate contacts.
 *
 * JSContact (RFC 9553).
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const ContactName = z.object({
  full: z.string().optional().describe('Full display name.'),
  given: z.string().optional().describe('Given (first) name.'),
  surname: z.string().optional().describe('Family (last) name.'),
});

const ContactEmail = z.object({
  address: z.string().describe('Email address.'),
  label: z.string().optional().describe('Label (e.g., "work", "personal").'),
});

const ContactPhone = z.object({
  number: z.string().describe('Phone number.'),
  label: z.string().optional().describe('Label (e.g., "mobile", "home").'),
});

const ContactOrganization = z.object({
  name: z.string().optional().describe('Organization name.'),
  title: z.string().optional().describe('Job title within the organization.'),
});

const Contact = z.object({
  id: z.string().describe('Server-issued stable contact identifier.'),
  name: ContactName.optional().describe('Structured name of the contact.'),
  emails: z.array(ContactEmail).optional().describe('Email addresses.'),
  phones: z.array(ContactPhone).optional().describe('Phone numbers.'),
  organizations: z.array(ContactOrganization).optional().describe('Organizations.'),
});

const ContactList = z.object({
  contacts: z.array(Contact).describe('Flat array of contact records.'),
  total: z.number().optional().describe('Total number of contacts available.'),
});

export const contactList = capability({
  name: 'contact.list',
  version: '0.0.1',
  scopes: ['contact:read'],
  description:
    'List all contacts for the authenticated account. Returns a flat array of ' +
    'contact card records. JMAP methods: AddressBook/get → ContactCard/query → ' +
    'ContactCard/get (RFC 9553).',
  input: z.object({
    query: z.string().optional().describe('Optional text filter to search contacts by name or email.'),
  }),
  output: ContactList,
  examples: [
    {
      title: 'Account with two contacts',
      input: {},
      output: {
        contacts: [
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
        ],
        total: 2,
      },
    },
  ],
});
