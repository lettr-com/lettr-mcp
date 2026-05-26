import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

type ContactStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'bounced'
  | 'complained'
  | 'unverified';

interface ContactRef {
  id: string;
  name: string;
}

interface AudienceContact {
  id: string;
  email: string;
  status: ContactStatus;
  properties: Record<string, unknown>;
  created_at: string;
  lists: ContactRef[];
  topics: ContactRef[];
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

// The API stores every custom property value as a string (max 1000 chars).
// On update, a null value removes the property from the contact.
const createPropertyValue = z.string().max(1000);
const updatePropertyValue = z.string().max(1000).nullable();

function formatContact(c: AudienceContact): string {
  const props = Object.entries(c.properties ?? {});
  const lines = [
    `ID: ${c.id}`,
    `Email: ${c.email}`,
    `Status: ${c.status}`,
    `Created: ${c.created_at}`,
    `Lists: ${c.lists.length > 0 ? c.lists.map((l) => `${l.name} (${l.id})`).join(', ') : 'none'}`,
    `Topics: ${c.topics.length > 0 ? c.topics.map((t) => `${t.name} (${t.id})`).join(', ') : 'none'}`,
  ];
  if (props.length > 0) {
    lines.push(
      `Properties:\n${props.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}`,
    );
  }
  return lines.join('\n');
}

export function addAudienceContactTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-audience-contacts',
    {
      title: 'List Audience Contacts',
      description:
        'List audience contacts with pagination and optional filters. Filter by free-text search (email or name), status, a specific list, or a specific segment.',
      inputSchema: {
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page (1-100, default 20)'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Page number (default 1)'),
        search: z
          .string()
          .max(255)
          .optional()
          .describe('Search by email address or contact name'),
        status: z
          .enum([
            'subscribed',
            'unsubscribed',
            'bounced',
            'complained',
            'unverified',
          ])
          .optional()
          .describe('Filter by contact status'),
        list_id: z
          .string()
          .optional()
          .describe(
            'Filter to contacts in a specific list (must belong to your team)',
          ),
        segment_id: z
          .string()
          .optional()
          .describe(
            'Filter to contacts matching a specific segment (must belong to your team)',
          ),
      },
    },
    async ({ per_page, page, search, status, list_id, segment_id }) => {
      const query: Record<string, string | number | undefined> = {};
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;
      if (search) query.search = search;
      if (status) query.status = status;
      if (list_id) query.list_id = list_id;
      if (segment_id) query.segment_id = segment_id;

      const response = await lettr.get<
        LettrResponse<{ contacts: AudienceContact[]; pagination: Pagination }>
      >('/audience/contacts', query);

      const { contacts, pagination } = response.data;
      if (contacts.length === 0) {
        return { content: [{ type: 'text', text: 'No contacts found.' }] };
      }

      const lines = contacts
        .map((c) => `- ${c.email} (id: ${c.id}, status: ${c.status})`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} contact(s) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-audience-contact',
    {
      title: 'Get Audience Contact',
      description:
        'Retrieve a single contact by ID, including status, custom properties, and the lists and topics it belongs to.',
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID'),
      },
    },
    async ({ contactId }) => {
      const response = await lettr.get<LettrResponse<AudienceContact>>(
        `/audience/contacts/${encodeURIComponent(contactId)}`,
      );

      return {
        content: [
          { type: 'text', text: 'Contact details:' },
          { type: 'text', text: formatContact(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'create-audience-contact',
    {
      title: 'Create Audience Contact',
      description: `Create a single audience contact.

- \`properties\` keys must match properties already defined for the team (use list-audience-properties).
- When \`double_opt_in\` is provided, the contact is created in \`unverified\` status and receives a confirmation email; all four of its fields (from, subject, template_slug, redirect_url) are required.`,
      inputSchema: {
        email: z.email().max(255).describe('Contact email address'),
        list_id: z
          .string()
          .optional()
          .describe('Optional list ID to add the contact to'),
        properties: z
          .record(z.string(), createPropertyValue)
          .optional()
          .describe(
            'Custom property values, each as a string (max 1000 chars). Each key must match a property defined for the team.',
          ),
        double_opt_in: z
          .object({
            from: z
              .email()
              .max(255)
              .describe('Sender email for the confirmation email'),
            from_name: z
              .string()
              .max(255)
              .optional()
              .describe('Sender display name'),
            subject: z
              .string()
              .max(998)
              .describe('Subject line of the confirmation email'),
            template_slug: z
              .string()
              .max(255)
              .describe('Template slug used for the confirmation email'),
            redirect_url: z
              .url()
              .max(2048)
              .describe('URL the contact is sent to after confirming'),
          })
          .optional()
          .describe(
            'Double opt-in configuration. When set, the contact is created unverified until they click the confirmation link.',
          ),
      },
    },
    async ({ email, list_id, properties, double_opt_in }) => {
      const body: Record<string, unknown> = { email };
      if (list_id) body.list_id = list_id;
      if (properties) body.properties = properties;
      if (double_opt_in) body.double_opt_in = double_opt_in;

      const response = await lettr.post<LettrResponse<AudienceContact>>(
        '/audience/contacts',
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Contact created successfully.' },
          { type: 'text', text: formatContact(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'bulk-create-audience-contacts',
    {
      title: 'Bulk Create Audience Contacts',
      description:
        'Create many contacts at once from a list of email addresses. Optionally add all of them to a list and/or apply the same custom properties to every contact in the batch. Already-existing emails are skipped (reported separately).',
      inputSchema: {
        emails: z
          .array(z.email().max(255))
          .min(1)
          .max(1000)
          .describe('Email addresses to create contacts for (max 1000)'),
        list_id: z
          .string()
          .optional()
          .describe('Optional list ID to add all contacts to'),
        properties: z
          .record(z.string(), createPropertyValue)
          .optional()
          .describe(
            'Custom property values applied to every contact created in this batch, each as a string (max 1000 chars). Each key must match a property defined for the team.',
          ),
      },
    },
    async ({ emails, list_id, properties }) => {
      const body: Record<string, unknown> = { emails };
      if (list_id) body.list_id = list_id;
      if (properties) body.properties = properties;

      const response = await lettr.post<
        LettrResponse<{ created: number; already_existed: number }>
      >('/audience/contacts/bulk', body);

      const { created, already_existed } = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Created ${created} contact(s); ${already_existed} already existed.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'update-audience-contact',
    {
      title: 'Update Audience Contact',
      description: `Update a contact. All fields are optional — only provided fields change.

- \`status\` may only be set to \`subscribed\` or \`unsubscribed\`.
- \`properties\` is a partial update: include only the keys you want to change. Setting a property to \`null\` removes it from the contact.`,
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID to update'),
        email: z
          .email()
          .max(255)
          .optional()
          .describe('New email address (must remain unique within the team)'),
        status: z
          .enum(['subscribed', 'unsubscribed'])
          .optional()
          .describe('New subscription status'),
        properties: z
          .record(z.string(), updatePropertyValue)
          .optional()
          .describe(
            'Partial property update; each value is a string (max 1000 chars). A property set to null is removed from the contact.',
          ),
      },
    },
    async ({ contactId, ...rest }) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }

      const response = await lettr.patch<LettrResponse<AudienceContact>>(
        `/audience/contacts/${encodeURIComponent(contactId)}`,
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Contact updated successfully.' },
          { type: 'text', text: formatContact(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'delete-audience-contact',
    {
      title: 'Delete Audience Contact',
      description:
        'Delete a contact. Before using this tool, you MUST double-check with the user that they want to delete this contact. Warn them that this action is irreversible and removes the contact from all lists and topics.',
      inputSchema: {
        contactId: z.string().nonempty().describe('The contact ID to delete'),
      },
    },
    async ({ contactId }) => {
      await lettr.delete<undefined>(
        `/audience/contacts/${encodeURIComponent(contactId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Contact "${contactId}" deleted successfully.`,
          },
        ],
      };
    },
  );
}
