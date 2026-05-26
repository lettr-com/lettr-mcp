import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface AudienceList {
  id: string;
  name: string;
  contacts_count: number;
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

function formatList(l: AudienceList): string {
  return `ID: ${l.id}\nName: ${l.name}\nContacts: ${l.contacts_count}`;
}

export function addAudienceListTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-audience-lists',
    {
      title: 'List Audience Lists',
      description:
        'List the audience (contact) lists for your team, with pagination. Use this to discover list IDs to pass to contact and segment tools.',
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
        LettrResponse<{ lists: AudienceList[]; pagination: Pagination }>
      >('/audience/lists', query);

      const { lists, pagination } = response.data;
      if (lists.length === 0) {
        return {
          content: [{ type: 'text', text: 'No audience lists found.' }],
        };
      }

      const lines = lists
        .map((l) => `- ${l.name} (id: ${l.id}, contacts: ${l.contacts_count})`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} list(s) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'create-audience-list',
    {
      title: 'Create Audience List',
      description:
        'Create a new audience list. The name must be unique within the team.',
      inputSchema: {
        name: z
          .string()
          .nonempty()
          .max(255)
          .describe('List name (must be unique within the team)'),
      },
    },
    async ({ name }) => {
      const response = await lettr.post<LettrResponse<AudienceList>>(
        '/audience/lists',
        { name },
      );

      return {
        content: [
          { type: 'text', text: 'Audience list created successfully.' },
          { type: 'text', text: formatList(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'get-audience-list',
    {
      title: 'Get Audience List',
      description:
        'Retrieve a single audience list by its ID, including its current contact count.',
      inputSchema: {
        listId: z.string().nonempty().describe('The list ID'),
      },
    },
    async ({ listId }) => {
      const response = await lettr.get<LettrResponse<AudienceList>>(
        `/audience/lists/${encodeURIComponent(listId)}`,
      );

      return {
        content: [
          { type: 'text', text: 'Audience list details:' },
          { type: 'text', text: formatList(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'update-audience-list',
    {
      title: 'Update Audience List',
      description:
        'Rename an audience list. The new name must remain unique within the team.',
      inputSchema: {
        listId: z.string().nonempty().describe('The list ID to update'),
        name: z
          .string()
          .nonempty()
          .max(255)
          .describe('New list name (must remain unique within the team)'),
      },
    },
    async ({ listId, name }) => {
      const response = await lettr.patch<LettrResponse<AudienceList>>(
        `/audience/lists/${encodeURIComponent(listId)}`,
        { name },
      );

      return {
        content: [
          { type: 'text', text: 'Audience list updated successfully.' },
          { type: 'text', text: formatList(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'delete-audience-list',
    {
      title: 'Delete Audience List',
      description:
        'Delete an audience list. Before using this tool, you MUST double-check with the user that they want to delete this list. Warn them that this action is irreversible — the list is removed and its contacts are detached from it.',
      inputSchema: {
        listId: z.string().nonempty().describe('The list ID to delete'),
      },
    },
    async ({ listId }) => {
      await lettr.delete<undefined>(
        `/audience/lists/${encodeURIComponent(listId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Audience list "${listId}" deleted successfully.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'bulk-delete-audience-lists',
    {
      title: 'Bulk Delete Audience Lists',
      description:
        'Delete between 1 and 50 audience lists in a single call. Before using this tool, you MUST double-check with the user. Warn them that this action is irreversible — every listed list is removed and its contacts detached. All IDs must belong to your team.',
      inputSchema: {
        list_ids: z
          .array(z.string().nonempty())
          .min(1)
          .max(50)
          .describe('1–50 list IDs to delete (all must belong to your team)'),
      },
    },
    async ({ list_ids }) => {
      const response = await lettr.delete<LettrResponse<{ deleted: number }>>(
        '/audience/lists/bulk',
        { list_ids },
      );

      return {
        content: [
          {
            type: 'text',
            text: `Deleted ${response.data.deleted} list(s).`,
          },
        ],
      };
    },
  );
}
