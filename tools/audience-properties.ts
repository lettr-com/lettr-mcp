import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'json';

interface AudienceProperty {
  id: string;
  name: string;
  type: PropertyType;
  fallback_value: string | null;
  created_at: string;
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

function formatProperty(p: AudienceProperty): string {
  return [
    `ID: ${p.id}`,
    `Name: ${p.name}`,
    `Type: ${p.type}`,
    `Fallback: ${p.fallback_value ?? '(none)'}`,
  ].join('\n');
}

export function addAudiencePropertyTools(
  server: McpServer,
  lettr: LettrClient,
) {
  server.registerTool(
    'list-audience-properties',
    {
      title: 'List Audience Properties',
      description:
        'List the custom contact properties defined for your team, with pagination. Use this to discover which property keys are valid when creating or updating contacts.',
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
        LettrResponse<{
          properties: AudienceProperty[];
          pagination: Pagination;
        }>
      >('/audience/properties', query);

      const { properties, pagination } = response.data;
      if (properties.length === 0) {
        return { content: [{ type: 'text', text: 'No properties found.' }] };
      }

      const lines = properties
        .map(
          (p) =>
            `- ${p.name} (id: ${p.id}, type: ${p.type}${p.fallback_value !== null ? `, fallback: ${p.fallback_value}` : ''})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} property(ies) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'create-audience-property',
    {
      title: 'Create Audience Property',
      description:
        'Define a new custom contact property. The name must start with a lowercase letter and contain only lowercase letters, numbers, and underscores. The type fixes how values are stored and cannot be changed later.',
      inputSchema: {
        name: z
          .string()
          .nonempty()
          .max(255)
          .regex(
            /^[a-z][a-z0-9_]*$/,
            'Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.',
          )
          .describe(
            'Property name. Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.',
          ),
        type: z
          .enum(['string', 'number', 'boolean', 'date', 'json'])
          .describe('Value type for the property'),
        fallback_value: z
          .string()
          .max(255)
          .nullable()
          .optional()
          .describe(
            'Optional default value used when a contact has no value set',
          ),
      },
    },
    async ({ name, type, fallback_value }) => {
      const body: Record<string, unknown> = { name, type };
      if (fallback_value !== undefined) body.fallback_value = fallback_value;

      const response = await lettr.post<LettrResponse<AudienceProperty>>(
        '/audience/properties',
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Property created successfully.' },
          { type: 'text', text: formatProperty(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'get-audience-property',
    {
      title: 'Get Audience Property',
      description: 'Retrieve a single custom contact property by its ID.',
      inputSchema: {
        propertyId: z.string().nonempty().describe('The property ID'),
      },
    },
    async ({ propertyId }) => {
      const response = await lettr.get<LettrResponse<AudienceProperty>>(
        `/audience/properties/${encodeURIComponent(propertyId)}`,
      );

      return {
        content: [
          { type: 'text', text: 'Property details:' },
          { type: 'text', text: formatProperty(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'update-audience-property',
    {
      title: 'Update Audience Property',
      description:
        "Update a property's fallback value. The name and type are fixed at creation and cannot be changed. Set fallback_value to null to clear it.",
      inputSchema: {
        propertyId: z.string().nonempty().describe('The property ID to update'),
        fallback_value: z
          .string()
          .max(255)
          .nullable()
          .optional()
          .describe(
            'New fallback value. Set to null to clear it; omit to leave it unchanged.',
          ),
      },
    },
    async ({ propertyId, fallback_value }) => {
      const body: Record<string, unknown> = {};
      if (fallback_value !== undefined) body.fallback_value = fallback_value;

      const response = await lettr.patch<LettrResponse<AudienceProperty>>(
        `/audience/properties/${encodeURIComponent(propertyId)}`,
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Property updated successfully.' },
          { type: 'text', text: formatProperty(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'delete-audience-property',
    {
      title: 'Delete Audience Property',
      description:
        'Delete a custom contact property. Before using this tool, you MUST double-check with the user that they want to delete this property. Warn them that this action is irreversible and removes the property value from every contact.',
      inputSchema: {
        propertyId: z.string().nonempty().describe('The property ID to delete'),
      },
    },
    async ({ propertyId }) => {
      await lettr.delete<undefined>(
        `/audience/properties/${encodeURIComponent(propertyId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Property "${propertyId}" deleted successfully.`,
          },
        ],
      };
    },
  );
}
