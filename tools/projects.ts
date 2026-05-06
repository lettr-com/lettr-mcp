import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface ProjectView {
  id: number;
  name: string;
  emoji: string | null;
  team_id: number;
  created_at: string;
  updated_at: string;
}

interface ProjectsPagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export function addProjectTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-projects',
    {
      title: 'List Projects',
      description:
        'List projects owned by the team, with pagination. Use this to discover project IDs to pass to template and email tools.',
      inputSchema: {
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
    async ({ per_page, page }) => {
      const query: Record<string, string | number | undefined> = {};
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;

      const response = await lettr.get<
        LettrResponse<{
          projects: ProjectView[];
          pagination: ProjectsPagination;
        }>
      >('/projects', query);

      const { projects, pagination } = response.data;
      if (projects.length === 0) {
        return { content: [{ type: 'text', text: 'No projects found.' }] };
      }

      const lines = projects
        .map(
          (p) =>
            `- ${p.emoji ?? ''}${p.emoji ? ' ' : ''}${p.name} (id: ${p.id}, team: ${p.team_id})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} project(s) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );
}
