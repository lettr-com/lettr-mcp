import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface AudienceTopic {
  id: string;
  name: string;
  description: string | null;
  default_subscription: 'opt_in' | 'opt_out';
  visibility: 'private' | 'public';
  contacts_count: number;
  created_at: string | null;
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

function formatTopic(t: AudienceTopic): string {
  return [
    `ID: ${t.id}`,
    `Name: ${t.name}`,
    `Description: ${t.description || '(none)'}`,
    `Default subscription: ${t.default_subscription}`,
    `Visibility: ${t.visibility}`,
    `Contacts: ${t.contacts_count}`,
  ].join('\n');
}

export function addAudienceTopicTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-audience-topics',
    {
      title: 'List Audience Topics',
      description:
        'List subscription topics for your team, with pagination. Use this to discover topic IDs to subscribe contacts to.',
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
      },
    },
    async ({ per_page, page }) => {
      const query: Record<string, string | number | undefined> = {};
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;

      const response = await lettr.get<
        LettrResponse<{ topics: AudienceTopic[]; pagination: Pagination }>
      >('/audience/topics', query);

      const { topics, pagination } = response.data;
      if (topics.length === 0) {
        return { content: [{ type: 'text', text: 'No topics found.' }] };
      }

      const lines = topics
        .map(
          (t) =>
            `- ${t.name} (id: ${t.id}, ${t.visibility}, default ${t.default_subscription}, contacts: ${t.contacts_count})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} topic(s) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'create-audience-topic',
    {
      title: 'Create Audience Topic',
      description:
        'Create a subscription topic. default_subscription controls whether contacts are opted in or out by default (defaults to opt_in); visibility controls whether the topic is shown on public preference pages (defaults to private).',
      inputSchema: {
        name: z.string().nonempty().max(255).describe('Topic name'),
        description: z
          .string()
          .max(1000)
          .optional()
          .describe('Optional description of the topic'),
        default_subscription: z
          .enum(['opt_in', 'opt_out'])
          .optional()
          .describe('Default subscription state for contacts (default opt_in)'),
        visibility: z
          .enum(['private', 'public'])
          .optional()
          .describe('Topic visibility (default private)'),
      },
    },
    async ({ name, description, default_subscription, visibility }) => {
      const body: Record<string, unknown> = { name };
      if (description !== undefined) body.description = description;
      if (default_subscription)
        body.default_subscription = default_subscription;
      if (visibility) body.visibility = visibility;

      const response = await lettr.post<LettrResponse<AudienceTopic>>(
        '/audience/topics',
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Topic created successfully.' },
          { type: 'text', text: formatTopic(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'get-audience-topic',
    {
      title: 'Get Audience Topic',
      description: 'Retrieve a single subscription topic by its ID.',
      inputSchema: {
        topicId: z.string().nonempty().describe('The topic ID'),
      },
    },
    async ({ topicId }) => {
      const response = await lettr.get<LettrResponse<AudienceTopic>>(
        `/audience/topics/${encodeURIComponent(topicId)}`,
      );

      return {
        content: [
          { type: 'text', text: 'Topic details:' },
          { type: 'text', text: formatTopic(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'update-audience-topic',
    {
      title: 'Update Audience Topic',
      description:
        'Update a subscription topic. All fields are optional — only provided fields change. Note that default_subscription cannot be changed after creation.',
      inputSchema: {
        topicId: z.string().nonempty().describe('The topic ID to update'),
        name: z
          .string()
          .nonempty()
          .max(255)
          .optional()
          .describe('New topic name'),
        description: z
          .string()
          .max(1000)
          .nullable()
          .optional()
          .describe('New description (null clears it)'),
        visibility: z
          .enum(['private', 'public'])
          .optional()
          .describe('New visibility'),
      },
    },
    async ({ topicId, ...rest }) => {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }

      const response = await lettr.patch<LettrResponse<AudienceTopic>>(
        `/audience/topics/${encodeURIComponent(topicId)}`,
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Topic updated successfully.' },
          { type: 'text', text: formatTopic(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'delete-audience-topic',
    {
      title: 'Delete Audience Topic',
      description:
        'Delete a subscription topic. Before using this tool, you MUST double-check with the user that they want to delete this topic. Warn them that this action is irreversible and removes all contact subscriptions to it.',
      inputSchema: {
        topicId: z.string().nonempty().describe('The topic ID to delete'),
      },
    },
    async ({ topicId }) => {
      await lettr.delete<undefined>(
        `/audience/topics/${encodeURIComponent(topicId)}`,
      );

      return {
        content: [
          { type: 'text', text: `Topic "${topicId}" deleted successfully.` },
        ],
      };
    },
  );
}
