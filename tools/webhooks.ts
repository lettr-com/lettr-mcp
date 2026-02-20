import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface WebhookListItem {
  id: number;
  url: string;
  status: string;
  event_types: string[];
  created_at: string;
  updated_at: string;
}

interface WebhookDetail extends WebhookListItem {
  signing_secret?: string;
  last_delivery_at?: string | null;
  last_delivery_status?: string | null;
}

export function addWebhookTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-webhooks',
    {
      title: 'List Webhooks',
      description:
        'List all webhooks configured for your Lettr account. Returns webhook URLs, statuses, and subscribed event types.',
      inputSchema: {},
    },
    async () => {
      console.error('Debug - Listing webhooks');

      const response =
        await lettr.get<LettrResponse<{ webhooks: WebhookListItem[] }>>(
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
            text: `URL: ${w.url}\nStatus: ${w.status}\nEvents: ${w.event_types.join(', ')}\nID: ${w.id}`,
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
        'Retrieve details of a specific webhook including its status, event types, and delivery information.',
      inputSchema: {
        id: z.number().describe('The webhook ID'),
      },
    },
    async ({ id }) => {
      console.error(`Debug - Getting webhook: ${id}`);

      const response = await lettr.get<LettrResponse<WebhookDetail>>(
        `/webhooks/${id}`,
      );

      const w = response.data;

      let details = 'Webhook Details:\n';
      details += `- ID: ${w.id}\n`;
      details += `- URL: ${w.url}\n`;
      details += `- Status: ${w.status}\n`;
      details += `- Events: ${w.event_types.join(', ')}\n`;
      details += `- Created: ${w.created_at}\n`;
      details += `- Updated: ${w.updated_at}\n`;
      if (w.last_delivery_at) {
        details += `- Last Delivery: ${w.last_delivery_at} (${w.last_delivery_status})\n`;
      }

      return {
        content: [{ type: 'text', text: details }],
      };
    },
  );
}
