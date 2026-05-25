/**
 * Capability: contact.get
 *
 * Phase 4c work item 1. Fetches a single contact by ID.
 *
 * Wire shape: `ContactCard/get` with explicit ids under the
 * `urn:ietf:params:jmap:contacts` capability.
 *
 * Scope is `contact:read` — only callers permitted to read contact
 * data need to fetch individual contacts.
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

export const contactGet = capability({
  name: 'contact.get',
  version: '0.0.1',
  scopes: ['contact:read'],
  description:
    'Fetch a single contact by ID. Returns the full contact card record. ' +
    'JMAP method: ContactCard/get (RFC 9553).',
  input: z.object({
    contactId: z.string().describe('The ID of the contact to fetch.'),
  }),
  output: Contact,
  examples: [
    {
      title: 'Fetch a contact with all fields',
      input: { contactId: 'CC01' },
      output: {
        id: 'CC01',
        name: { full: 'Alice Smith', given: 'Alice', surname: 'Smith' },
        emails: [{ address: 'alice@example.com', label: 'work' }],
        phones: [{ number: '+1-555-0101', label: 'mobile' }],
        organizations: [{ name: 'Acme Corp', title: 'Engineer' }],
      },
    },
  ],
});
