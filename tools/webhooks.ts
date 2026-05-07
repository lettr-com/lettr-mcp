import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

type AuthType = 'none' | 'basic' | 'oauth2';
type LastStatus = 'success' | 'failure' | null;

interface WebhookView {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  event_types?: string[] | null;
  auth_type: AuthType;
  has_auth_credentials: boolean;
  last_successful_at?: string | null;
  last_failure_at?: string | null;
  last_status?: LastStatus;
}

const WEBHOOK_EVENT_TYPES = [
  'message.injection',
  'message.delivery',
  'message.bounce',
  'message.delay',
  'message.out_of_band',
  'message.spam_complaint',
  'message.policy_rejection',
  'engagement.click',
  'engagement.open',
  'engagement.initial_open',
  'engagement.amp_click',
  'engagement.amp_open',
  'engagement.amp_initial_open',
  'generation.generation_failure',
  'generation.generation_rejection',
  'unsubscribe.list_unsubscribe',
  'unsubscribe.link_unsubscribe',
  'relay.relay_injection',
  'relay.relay_rejection',
  'relay.relay_delivery',
  'relay.relay_tempfail',
  'relay.relay_permfail',
] as const;

function formatWebhook(w: WebhookView): string {
  const events = w.event_types == null ? 'all' : w.event_types.join(', ');
  const lines = [
    `ID: ${w.id}`,
    `Name: ${w.name}`,
    `URL: ${w.url}`,
    `Enabled: ${w.enabled}`,
    `Auth: ${w.auth_type}${w.has_auth_credentials ? ' (credentials set)' : ''}`,
    `Events: ${events}`,
  ];
  if (w.last_successful_at !== undefined) {
    lines.push(`Last success: ${w.last_successful_at ?? 'never'}`);
  }
  if (w.last_failure_at !== undefined) {
    lines.push(`Last failure: ${w.last_failure_at ?? 'never'}`);
  }
  if (w.last_status !== undefined) {
    lines.push(`Last status: ${w.last_status ?? 'n/a'}`);
  }
  return lines.join('\n');
}

export function addWebhookTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-webhooks',
    {
      title: 'List Webhooks',
      description:
        'List all webhooks configured for your Lettr account. Returns webhook URLs, enabled status, subscribed event types, and last delivery result.',
      inputSchema: {},
    },
    async () => {
      const response =
        await lettr.get<LettrResponse<{ webhooks: WebhookView[] }>>(
          '/webhooks',
        );

      const webhooks = response.data.webhooks;

      if (webhooks.length === 0) {
        return {
          content: [{ type: 'text', text: 'No webhooks found.' }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Found ${webhooks.length} webhook${webhooks.length === 1 ? '' : 's'}:`,
          },
          ...webhooks.map((w) => ({
            type: 'text' as const,
            text: formatWebhook(w),
          })),
        ],
      };
    },
  );

  server.registerTool(
    'get-webhook',
    {
      title: 'Get Webhook',
      description:
        'Retrieve details of a specific webhook by its string ID (e.g. "webhook-abc123"). Includes enabled state, event types, auth type, and last delivery timestamps.',
      inputSchema: {
        id: z
          .string()
          .nonempty()
          .describe('The webhook ID (e.g. "webhook-abc123")'),
      },
    },
    async ({ id }) => {
      const response = await lettr.get<LettrResponse<WebhookView>>(
        `/webhooks/${encodeURIComponent(id)}`,
      );

      return {
        content: [
          { type: 'text', text: 'Webhook details:' },
          { type: 'text', text: formatWebhook(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'create-webhook',
    {
      title: 'Create Webhook',
      description: `Create a new webhook subscription.

**Required:** name, url, auth_type, events_mode.
- When auth_type is "basic", auth_username and auth_password are required.
- When auth_type is "oauth2", oauth_client_id, oauth_client_secret and oauth_token_url are required.
- When events_mode is "selected", the events array is required and must contain only valid event type strings.
- When events_mode is "all", the webhook receives every event.`,
      inputSchema: {
        name: z
          .string()
          .nonempty()
          .max(255)
          .describe('Human-readable name (max 255 chars)'),
        url: z
          .url()
          .max(2048)
          .describe('HTTPS URL that will receive webhook POSTs'),
        auth_type: z
          .enum(['none', 'basic', 'oauth2'])
          .describe('Authentication scheme for delivery requests'),
        auth_username: z
          .string()
          .max(255)
          .optional()
          .describe('Basic auth username (required when auth_type=basic)'),
        auth_password: z
          .string()
          .max(255)
          .optional()
          .describe('Basic auth password (required when auth_type=basic)'),
        oauth_client_id: z
          .string()
          .max(255)
          .optional()
          .describe('OAuth2 client ID (required when auth_type=oauth2)'),
        oauth_client_secret: z
          .string()
          .max(255)
          .optional()
          .describe('OAuth2 client secret (required when auth_type=oauth2)'),
        oauth_token_url: z
          .url()
          .max(2048)
          .optional()
          .describe('OAuth2 token URL (required when auth_type=oauth2)'),
        events_mode: z
          .enum(['all', 'selected'])
          .describe('Subscribe to all events or an explicit subset'),
        events: z
          .array(z.enum(WEBHOOK_EVENT_TYPES))
          .min(1)
          .optional()
          .describe(
            'List of event types (required when events_mode=selected). Use the canonical fully-prefixed names (e.g. "message.delivery", "engagement.open").',
          ),
      },
    },
    async ({
      name,
      url,
      auth_type,
      auth_username,
      auth_password,
      oauth_client_id,
      oauth_client_secret,
      oauth_token_url,
      events_mode,
      events,
    }) => {
      if (auth_type === 'basic' && (!auth_username || !auth_password)) {
        throw new Error(
          'auth_username and auth_password are required when auth_type is "basic".',
        );
      }
      if (
        auth_type === 'oauth2' &&
        (!oauth_client_id || !oauth_client_secret || !oauth_token_url)
      ) {
        throw new Error(
          'oauth_client_id, oauth_client_secret and oauth_token_url are required when auth_type is "oauth2".',
        );
      }
      if (events_mode === 'selected' && (!events || events.length === 0)) {
        throw new Error(
          'events must be a non-empty array when events_mode is "selected".',
        );
      }

      const body: Record<string, unknown> = {
        name,
        url,
        auth_type,
        events_mode,
      };
      if (auth_username) body.auth_username = auth_username;
      if (auth_password) body.auth_password = auth_password;
      if (oauth_client_id) body.oauth_client_id = oauth_client_id;
      if (oauth_client_secret) body.oauth_client_secret = oauth_client_secret;
      if (oauth_token_url) body.oauth_token_url = oauth_token_url;
      if (events_mode === 'selected') body.events = events;

      const response = await lettr.post<LettrResponse<WebhookView>>(
        '/webhooks',
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Webhook created successfully.' },
          { type: 'text', text: formatWebhook(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'update-webhook',
    {
      title: 'Update Webhook',
      description: `Update an existing webhook. All fields are optional — only provided fields are changed.

Notes:
- The enabled flag is named \`active\` on update (the response field is \`enabled\`).
- The \`events\` array uses the canonical fully-prefixed event names (e.g. "message.delivery", "engagement.open").`,
      inputSchema: {
        id: z.string().nonempty().describe('The webhook ID to update'),
        name: z.string().max(255).optional().describe('New name'),
        url: z.url().max(2048).optional().describe('New delivery URL'),
        auth_type: z.enum(['none', 'basic', 'oauth2']).optional(),
        auth_username: z.string().max(255).optional(),
        auth_password: z.string().max(255).optional(),
        oauth_client_id: z.string().max(255).optional(),
        oauth_client_secret: z.string().max(255).optional(),
        oauth_token_url: z.url().max(2048).optional(),
        events: z
          .array(z.enum(WEBHOOK_EVENT_TYPES))
          .min(1)
          .optional()
          .describe('Replacement event subscription list'),
        active: z
          .boolean()
          .optional()
          .describe(
            'Enable/disable the webhook (request field name; response uses "enabled")',
          ),
      },
    },
    async ({ id, ...rest }) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }

      const response = await lettr.put<LettrResponse<WebhookView>>(
        `/webhooks/${encodeURIComponent(id)}`,
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Webhook updated successfully.' },
          { type: 'text', text: formatWebhook(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'delete-webhook',
    {
      title: 'Delete Webhook',
      description:
        'Delete a webhook subscription. Before using this tool, you MUST double-check with the user. Warn them that this action is irreversible and event delivery to the configured URL will stop immediately.',
      inputSchema: {
        id: z.string().nonempty().describe('The webhook ID to delete'),
      },
    },
    async ({ id }) => {
      await lettr.delete<{ message: string } | undefined>(
        `/webhooks/${encodeURIComponent(id)}`,
      );

      return {
        content: [
          { type: 'text', text: `Webhook "${id}" deleted successfully.` },
        ],
      };
    },
  );
}
