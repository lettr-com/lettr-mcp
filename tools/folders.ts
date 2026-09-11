import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface FolderView {
  id: number;
  name: string;
  project_id: number;
  purpose: string;
  templates_count: number;
  created_at: string;
  updated_at: string;
}

interface FoldersPagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export function addFolderTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-folders',
    {
      title: 'List Folders',
      description: `**Purpose:** List the folders templates are filed into, with each folder's purpose and template count.

**Returns:** Folder id, name, project, purpose (transactional or campaign) and how many templates are inside.

**When to use:**
- Before creating a template, to pick a folder id — nothing else in the API returns one, so without this you either omit folder_id and accept whichever folder the API picks, or guess an integer
- To find the campaign folder when the user asks for a marketing template
- To answer "where are my templates organised", "what folders do I have"

**Note:** A folder's purpose and a template's purpose are separate. Filing a template in a campaign folder does not make the template a campaign template — set purpose on the template itself.`,
      inputSchema: {
        project_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Project ID to list folders from. If not provided, uses the team's default project.",
          ),
        purpose: z
          .enum(['transactional', 'campaign'])
          .optional()
          .describe(
            'Only return folders of this purpose. Omit to return both.',
          ),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page (1-100, default 25)'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Page number (default 1)'),
      },
    },
    async ({ project_id, purpose, per_page, page }) => {
      const query: Record<string, string | number | undefined> = {};
      if (project_id) query.project_id = project_id;
      if (purpose) query.purpose = purpose;
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;

      const response = await lettr.get<
        LettrResponse<{
          folders: FolderView[];
          pagination: FoldersPagination;
        }>
      >('/folders', query);

      const folders = response.data.folders;
      const pagination = response.data.pagination;

      if (folders.length === 0) {
        return {
          content: [{ type: 'text', text: 'No folders found.' }],
        };
      }

      const folderList = folders
        .map(
          (f) =>
            `- ${f.name} (id: ${f.id}) | Purpose: ${f.purpose} | Templates: ${f.templates_count} | Project: ${f.project_id}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} folder(s) (page ${pagination.current_page}/${pagination.last_page}):\n\n${folderList}`,
          },
        ],
      };
    },
  );
}
