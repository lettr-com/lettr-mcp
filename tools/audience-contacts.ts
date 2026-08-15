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

const topicSubscription = z.object({
  id: z.string().nonempty().describe('The topic ID'),
  subscription: z
    .enum(['opt_in', 'opt_out'])
    .optional()
    .describe(
      'Defaults to opt_in. Use opt_out to keep the contact off a topic that would otherwise auto-subscribe them.',
    ),
});

type BulkContactErrorCode =
  | 'missing_email'
  | 'invalid_email'
  | 'invalid_property_value'
  | 'unknown_property_key'
  | 'unknown_list'
  | 'unknown_topic'
  | 'invalid_topic_subscription';

interface BulkContactError {
  index: number;
  email: string | null;
  error_code: BulkContactErrorCode;
  error: string;
}

interface BulkContactRef {
  id: string;
  email: string;
  created: boolean;
}

interface BulkImportResult {
  created: number;
  already_existed: number;
  // Absent when the API predates TPL-2105, hence optional here.
  updated?: number;
  error_count?: number;
  errors?: BulkContactError[];
  contacts?: BulkContactRef[];
}

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
- When \`double_opt_in\` is provided, the contact is created in \`unverified\` status and receives a confirmation email; all four of its fields (from, subject, template_slug, redirect_url) are required.
- If the email already exists for the team this fails with HTTP 409 (\`resource_already_exists\`). That is a client-correctable condition, not an outage — do NOT retry it. Update the existing contact with update-audience-contact, or use bulk-create-audience-contacts with \`update_existing\` set.`,
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
      description: `Create many contacts in one request (max 1000).

Provide exactly one of:
- \`emails\` — a flat list of addresses, when every contact gets the same treatment.
- \`contacts\` — one row per contact, when they differ. Each row takes its own \`properties\`, \`list_ids\` and \`topics\`, applied on top of the batch-wide \`list_ids\`, \`topics\` and \`properties\`.

A row-level topic \`opt_out\` beats a batch-level \`opt_in\`. That is how you keep specific people off a topic that auto-subscribes new contacts, without a second cleanup call.

\`update_existing\` (default false) controls only whether properties are merged into contacts that already exist — submitted keys overwrite, absent keys are preserved. Existing contacts are attached to the requested lists and topics either way.

IMPORTANT — this call can partially succeed. Rows that fail validation are skipped and the rest of the batch still commits, so a successful response does NOT mean every row landed. Always read the reported error count back to the user rather than claiming the whole batch was imported.

With \`contacts\`, pass rows through as the user gave them — a malformed address is reported back as a skipped row, so do not drop or "fix" entries yourself first. With \`emails\`, a single invalid address rejects the whole request, so check them before sending.`,
      inputSchema: {
        emails: z
          .array(z.email().max(255))
          .min(1)
          .max(1000)
          .optional()
          .describe(
            'Flat list of email addresses (max 1000). Mutually exclusive with `contacts`.',
          ),
        contacts: z
          .array(
            z.object({
              // Deliberately not z.email(): the API skips a malformed row and
              // commits the rest, reporting it as `invalid_email` in `errors`.
              // Validating the address here would reject the whole batch
              // instead, so one bad row in a pasted list would import nothing.
              // The flat `emails` field above stays strict because there the
              // API does reject the whole request (422).
              email: z
                .string()
                .nonempty()
                .max(255)
                .describe('Contact email address'),
              properties: z
                .record(z.string(), createPropertyValue)
                .optional()
                .describe(
                  'Property values for this contact only, each a string (max 1000 chars). Each key must match a property defined for the team.',
                ),
              list_ids: z
                .array(z.string().nonempty())
                .max(50)
                .optional()
                .describe(
                  'Lists for this contact only (max 50), on top of the batch-wide list_ids',
                ),
              topics: z
                .array(topicSubscription)
                .max(50)
                .optional()
                .describe('Topic subscriptions for this contact only (max 50)'),
            }),
          )
          .min(1)
          .max(1000)
          .optional()
          .describe(
            'One row per contact (max 1000), when contacts differ from each other. Mutually exclusive with `emails`.',
          ),
        list_id: z
          .string()
          .optional()
          .describe(
            'Single list ID applied to the whole batch. Kept for convenience; `list_ids` is the general form.',
          ),
        list_ids: z
          .array(z.string().nonempty())
          .max(50)
          .optional()
          .describe('List IDs applied to every contact in the batch (max 50)'),
        topics: z
          .array(topicSubscription)
          .max(50)
          .optional()
          .describe(
            'Topic subscriptions applied to every contact in the batch (max 50)',
          ),
        properties: z
          .record(z.string(), createPropertyValue)
          .optional()
          .describe(
            'Custom property values applied to every contact in this batch, each as a string (max 1000 chars). Each key must match a property defined for the team.',
          ),
        update_existing: z
          .boolean()
          .optional()
          .describe(
            'Whether to merge the submitted properties into contacts that already exist (default false)',
          ),
      },
    },
    async ({
      emails,
      contacts,
      list_id,
      list_ids,
      topics,
      properties,
      update_existing,
    }) => {
      if (!emails && !contacts) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Provide either `emails` (a flat list of addresses) or `contacts` (one row per contact).',
            },
          ],
        };
      }

      const body: Record<string, unknown> = {};
      if (emails) body.emails = emails;
      if (contacts) body.contacts = contacts;
      if (list_id) body.list_id = list_id;
      if (list_ids?.length) body.list_ids = list_ids;
      if (topics?.length) body.topics = topics;
      if (properties) body.properties = properties;
      if (update_existing !== undefined) body.update_existing = update_existing;

      const response = await lettr.post<LettrResponse<BulkImportResult>>(
        '/audience/contacts/bulk',
        body,
      );

      const data = response.data;
      const errors = data.errors ?? [];
      const errorCount = data.error_count ?? errors.length;

      const lines = [
        `Created ${data.created} contact(s); ${data.already_existed} already existed; ${data.updated ?? 0} updated.`,
        // These two counters answer different questions ("was it already
        // there?" vs "did we change it?") and overlap, so spelling that out
        // stops the model reporting a total that does not add up.
        'Note: `already existed` and `updated` overlap — a contact that existed and got a list or topic attached is counted in both, so they do not sum to the number of rows submitted.',
      ];

      if (errorCount > 0) {
        lines.push(
          `${errorCount} row(s) were SKIPPED and not imported. The rest of the batch did commit:`,
        );
        for (const e of errors) {
          lines.push(
            `  - row ${e.index} (${e.email ?? 'no email'}): [${e.error_code}] ${e.error}`,
          );
        }
      }

      const refs = data.contacts ?? [];
      if (refs.length > 0) {
        lines.push(
          `Contacts (${refs.length}):`,
          ...refs.map(
            (c) =>
              `  - ${c.email} (id: ${c.id}, ${c.created ? 'created' : 'existing'})`,
          ),
        );
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
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
