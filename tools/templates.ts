import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface TemplateListItem {
  id: number;
  name: string;
  slug: string;
  project_id: number;
  folder_id: number;
  created_at: string;
  updated_at: string;
}

interface TemplateDetail extends TemplateListItem {
  active_version: number | null;
  versions_count: number;
  html?: string | null;
  json?: string | null;
}

interface CreatedTemplate {
  id: number;
  name: string;
  slug: string;
  project_id: number;
  folder_id: number;
  active_version: number;
  merge_tags: MergeTag[];
  created_at: string;
}

interface UpdatedTemplate extends CreatedTemplate {
  updated_at: string;
}

interface MergeTag {
  key: string;
  required: boolean;
  type?: string;
  children?: MergeTagChild[];
}

interface MergeTagChild {
  key: string;
  type?: string;
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export function addTemplateTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-templates',
    {
      title: 'List Templates',
      description: `**Purpose:** List email templates with pagination. Returns template names, slugs, and project info.

**Returns:** Paginated list of templates with id, name, slug, project_id, folder_id, timestamps.

**When to use:**
- User asks "show my templates", "what templates do I have?"
- Before sending a template-based email, to find the template slug
- Use get-template for full details of a specific template`,
      inputSchema: {
        project_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Project ID to filter templates. If not provided, uses the team's default project.",
          ),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Number of results per page (1-100). Default: 25'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Page number. Default: 1'),
      },
    },
    async ({ project_id, per_page, page }) => {
      const query: Record<string, string | number | undefined> = {};
      if (project_id) query.project_id = project_id;
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;

      const response = await lettr.get<
        LettrResponse<{
          templates: TemplateListItem[];
          pagination: Pagination;
        }>
      >('/templates', query);

      const templates = response.data.templates;
      const pagination = response.data.pagination;

      if (templates.length === 0) {
        return {
          content: [{ type: 'text', text: 'No templates found.' }],
        };
      }

      const templateList = templates
        .map(
          (t) =>
            `- ${t.name} (slug: ${t.slug}) | Project: ${t.project_id} | Updated: ${t.updated_at}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} template(s) (page ${pagination.current_page}/${pagination.last_page}):\n\n${templateList}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-template',
    {
      title: 'Get Template',
      description:
        'Retrieve full details of a template by its slug, including active version HTML/JSON content and version count.',
      inputSchema: {
        slug: z
          .string()
          .nonempty()
          .describe('The template slug (URL-friendly identifier)'),
        project_id: z
          .number()
          .optional()
          .describe(
            "Project ID to find the template in. If not provided, uses the team's default project.",
          ),
      },
    },
    async ({ slug, project_id }) => {
      const query: Record<string, string | number | undefined> = {};
      if (project_id) query.project_id = project_id;

      const response = await lettr.get<LettrResponse<TemplateDetail>>(
        `/templates/${encodeURIComponent(slug)}`,
        query,
      );

      const t = response.data;

      let details = 'Template Details:\n';
      details += `- Name: ${t.name}\n`;
      details += `- Slug: ${t.slug}\n`;
      details += `- Project ID: ${t.project_id}\n`;
      details += `- Folder ID: ${t.folder_id}\n`;
      details += `- Active Version: ${t.active_version ?? 'none'}\n`;
      details += `- Total Versions: ${t.versions_count}\n`;
      details += `- Created: ${t.created_at}\n`;
      details += `- Updated: ${t.updated_at}\n`;
      if (t.html) {
        details += `\n--- HTML Content ---\n${t.html}\n`;
      }

      return {
        content: [{ type: 'text', text: details }],
      };
    },
  );

  server.registerTool(
    'create-template',
    {
      title: 'Create Template',
      description:
        'Create a new email template with HTML or Topol editor JSON content. Provide either html or json — they are mutually exclusive. Merge tags are automatically extracted from the content.',
      inputSchema: {
        name: z
          .string()
          .nonempty()
          .max(255)
          .describe('Name of the template (max 255 characters)'),
        html: z
          .string()
          .optional()
          .describe(
            'HTML content for the template. Mutually exclusive with json. Use {{VARIABLE}} syntax for merge tags.',
          ),
        json: z
          .string()
          .optional()
          .describe(
            'JSON content for Topol visual editor templates. Mutually exclusive with html.',
          ),
        project_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Project ID to create the template in. If not provided, uses the team's default project.",
          ),
        folder_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Folder ID within the project. If not provided, uses the first folder.',
          ),
      },
    },
    async ({ name, html, json, project_id, folder_id }) => {
      if (html && json) {
        throw new Error(
          'html and json are mutually exclusive — provide only one.',
        );
      }

      const body: Record<string, unknown> = { name };
      if (html) body.html = html;
      if (json) body.json = json;
      if (project_id) body.project_id = project_id;
      if (folder_id) body.folder_id = folder_id;

      const response = await lettr.post<LettrResponse<CreatedTemplate>>(
        '/templates',
        body,
      );

      const t = response.data;
      const mergeTags =
        t.merge_tags.length > 0
          ? `\nMerge Tags: ${t.merge_tags.map((m) => `${m.key}${m.required ? ' (required)' : ''}`).join(', ')}`
          : '';

      return {
        content: [
          {
            type: 'text',
            text: `Template created successfully!\nName: ${t.name}\nSlug: ${t.slug}\nVersion: ${t.active_version}${mergeTags}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'update-template',
    {
      title: 'Update Template',
      description:
        "Update an existing template's name and/or content. Providing new html or json content creates a new version automatically. The html and json fields are mutually exclusive.",
      inputSchema: {
        slug: z.string().nonempty().describe('The template slug to update'),
        name: z
          .string()
          .max(255)
          .optional()
          .describe('New name for the template'),
        html: z
          .string()
          .optional()
          .describe(
            'New HTML content. Creates a new active version. Mutually exclusive with json.',
          ),
        json: z
          .string()
          .optional()
          .describe(
            'New JSON content for visual editor. Creates a new active version. Mutually exclusive with html.',
          ),
        project_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Project ID to find the template in. If not provided, uses the team's default project.",
          ),
      },
    },
    async ({ slug, name, html, json, project_id }) => {
      if (html && json) {
        throw new Error(
          'html and json are mutually exclusive — provide only one.',
        );
      }

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (html) body.html = html;
      if (json) body.json = json;
      if (project_id) body.project_id = project_id;

      const response = await lettr.put<LettrResponse<UpdatedTemplate>>(
        `/templates/${encodeURIComponent(slug)}`,
        body,
      );

      const t = response.data;
      const mergeTags =
        t.merge_tags.length > 0
          ? `\nMerge Tags: ${t.merge_tags.map((m) => `${m.key}${m.required ? ' (required)' : ''}`).join(', ')}`
          : '';

      return {
        content: [
          {
            type: 'text',
            text: `Template updated successfully!\nName: ${t.name}\nSlug: ${t.slug}\nActive Version: ${t.active_version}${mergeTags}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'delete-template',
    {
      title: 'Delete Template',
      description:
        'Permanently delete an email template and all its versions. Before using this tool, you MUST double-check with the user that they want to delete this template. Warn them that this action is irreversible and any emails referencing this template slug will fail.',
      inputSchema: {
        slug: z.string().nonempty().describe('The template slug to delete'),
        project_id: z
          .number()
          .optional()
          .describe(
            "Project ID to find the template in. If not provided, uses the team's default project.",
          ),
      },
    },
    async ({ slug, project_id }) => {
      const query: Record<string, string | number | undefined> = {};
      if (project_id) query.project_id = project_id;

      await lettr.delete<{ message: string }>(
        `/templates/${encodeURIComponent(slug)}`,
        query,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Template "${slug}" deleted successfully.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-merge-tags',
    {
      title: 'Get Template Merge Tags',
      description:
        'Retrieve the merge tags (variables) for a template. Use this to discover which substitution_data keys a template expects when sending an email. By default returns merge tags for the active version.',
      inputSchema: {
        slug: z.string().nonempty().describe('The template slug'),
        project_id: z
          .number()
          .optional()
          .describe(
            "Project ID to find the template in. If not provided, uses the team's default project.",
          ),
        version: z
          .number()
          .optional()
          .describe(
            'Template version number. If not provided, uses the active version.',
          ),
      },
    },
    async ({ slug, project_id, version }) => {
      const query: Record<string, string | number | undefined> = {};
      if (project_id) query.project_id = project_id;
      if (version) query.version = version;

      const response = await lettr.get<
        LettrResponse<{
          template_slug: string;
          version: number;
          merge_tags: MergeTag[];
        }>
      >(`/templates/${encodeURIComponent(slug)}/merge-tags`, query);

      const { template_slug, version: ver, merge_tags } = response.data;

      if (merge_tags.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Template "${template_slug}" (version ${ver}) has no merge tags.`,
            },
          ],
        };
      }

      const formatTag = (tag: MergeTag): string => {
        let line = `- ${tag.key}${tag.required ? ' (required)' : ' (optional)'}`;
        if (tag.type) line += ` [${tag.type}]`;
        if (tag.children && tag.children.length > 0) {
          line += ' (loop):';
          for (const child of tag.children) {
            line += `\n    - ${child.key}${child.type ? ` [${child.type}]` : ''}`;
          }
        }
        return line;
      };

      const tagList = merge_tags.map(formatTag).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Merge tags for "${template_slug}" (version ${ver}):\n\n${tagList}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-template-html',
    {
      title: 'Get Template HTML',
      description:
        'Retrieve a rendered template by project_id and slug. Returns the HTML body, the subject (if set) and the list of merge tags (each with key, name and required flag). This endpoint uses a non-standard {success, data} response envelope.',
      inputSchema: {
        project_id: z
          .number()
          .int()
          .min(1)
          .describe('Project ID containing the template. Required.'),
        slug: z
          .string()
          .nonempty()
          .max(255)
          .describe('Template slug. Required.'),
      },
    },
    async ({ project_id, slug }) => {
      const response = await lettr.get<{
        success: true;
        data: {
          html: string;
          merge_tags: Array<{ key: string; name: string; required: boolean }>;
          subject?: string | null;
        };
      }>('/templates/html', { project_id, slug });

      const { html, merge_tags, subject } = response.data;
      const tagLines = merge_tags
        .map(
          (m) =>
            `- ${m.key} (${m.name})${m.required ? ' [required]' : ' [optional]'}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Template "${slug}" — subject: ${subject ?? '(none)'}${merge_tags.length > 0 ? `\n\nMerge tags:\n${tagLines}` : ''}`,
          },
          { type: 'text', text: `--- HTML ---\n${html}` },
        ],
      };
    },
  );
}
