import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

const SEGMENT_OPERATORS = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'starts_with',
  'not_starts_with',
  'ends_with',
  'not_ends_with',
  'is_true',
  'is_false',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'before',
  'after',
] as const;

interface SegmentCondition {
  field: string;
  operator: (typeof SEGMENT_OPERATORS)[number];
  value?: string | null;
}

interface SegmentConditionGroup {
  conditions: SegmentCondition[];
}

interface AudienceSegment {
  id: string;
  name: string;
  list_id: string | null;
  list_name: string | null;
  condition_groups: SegmentConditionGroup[];
  cached_contacts_count: number | null;
  created_at: string;
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

// Request shape: groups are nested under `conditions.groups`. Each group's
// `conditions` are ORed; groups are ANDed. `value` is omitted for the
// is_true / is_false operators.
const conditionsSchema = z
  .object({
    groups: z
      .array(
        z.object({
          conditions: z
            .array(
              z.object({
                field: z
                  .string()
                  .max(255)
                  .describe(
                    'Field to match against. Built-in fields: "email", "status", "created_at". For a custom property, use the "properties." prefix, e.g. "properties.age" (a bare property name will NOT work). You can also match "topics" or "lists" by name (equals/not_equals only). An unrecognized field is silently ignored, which makes the segment match every contact — double-check the field name.',
                  ),
                operator: z
                  .enum(SEGMENT_OPERATORS)
                  .describe('Comparison operator'),
                value: z
                  .string()
                  .max(1000)
                  .nullable()
                  .optional()
                  .describe(
                    'Value to compare against, as a string. Required for all operators except is_true and is_false, which take no value.',
                  ),
              }),
            )
            .min(1)
            .describe('Conditions within a group are ORed together'),
        }),
      )
      .min(1)
      .describe('Groups are ANDed together'),
  })
  .describe(
    'Segment match rules. `groups` are ANDed; conditions within a group are ORed.',
  );

type ConditionsInput = z.infer<typeof conditionsSchema>;

// Mirror the API contract: every operator except is_true/is_false needs a value.
// Surface a clear error before the request rather than a generic 422.
function assertConditionValues(conditions: ConditionsInput): void {
  for (const group of conditions.groups) {
    for (const c of group.conditions) {
      const valueless = c.operator === 'is_true' || c.operator === 'is_false';
      if (
        !valueless &&
        (c.value === undefined || c.value === null || c.value === '')
      ) {
        throw new Error(
          `Operator "${c.operator}" on field "${c.field}" requires a value.`,
        );
      }
    }
  }
}

function formatSegment(s: AudienceSegment): string {
  const groups = s.condition_groups
    .map((g, i) => {
      const conds = g.conditions
        .map(
          (c) =>
            `    ${c.field} ${c.operator}${c.value != null ? ` ${JSON.stringify(c.value)}` : ''}`,
        )
        .join('\n');
      return `  Group ${i + 1} (any of):\n${conds}`;
    })
    .join('\n');
  return [
    `ID: ${s.id}`,
    `Name: ${s.name}`,
    `List: ${s.list_name ? `${s.list_name} (${s.list_id})` : 'all contacts'}`,
    `Cached contacts: ${s.cached_contacts_count ?? 'not computed'}`,
    s.condition_groups.length > 0
      ? `Conditions:\n${groups}`
      : 'Conditions: none',
  ].join('\n');
}

export function addAudienceSegmentTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-audience-segments',
    {
      title: 'List Audience Segments',
      description:
        'List audience segments for your team, with pagination. Optionally filter to segments restricted to a specific list.',
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
        list_id: z
          .string()
          .optional()
          .describe(
            'Filter to segments restricted to a specific list (must belong to your team)',
          ),
      },
    },
    async ({ per_page, page, list_id }) => {
      const query: Record<string, string | number | undefined> = {};
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;
      if (list_id) query.list_id = list_id;

      const response = await lettr.get<
        LettrResponse<{ segments: AudienceSegment[]; pagination: Pagination }>
      >('/audience/segments', query);

      const { segments, pagination } = response.data;
      if (segments.length === 0) {
        return { content: [{ type: 'text', text: 'No segments found.' }] };
      }

      const lines = segments
        .map(
          (s) =>
            `- ${s.name} (id: ${s.id}${s.list_name ? `, list: ${s.list_name}` : ''}, contacts: ${s.cached_contacts_count ?? 'n/a'})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} segment(s) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'create-audience-segment',
    {
      title: 'Create Audience Segment',
      description: `Create an audience segment defined by match conditions.

Conditions are grouped: conditions within a group are ORed together, and groups are ANDed together. The is_true and is_false operators take no value; all other operators require a value. Optionally restrict the segment to a single list with list_id.`,
      inputSchema: {
        name: z.string().nonempty().max(255).describe('Segment name'),
        list_id: z
          .string()
          .optional()
          .describe(
            'Restrict the segment to a single list (must belong to your team)',
          ),
        conditions: conditionsSchema,
      },
    },
    async ({ name, list_id, conditions }) => {
      assertConditionValues(conditions);
      const body: Record<string, unknown> = { name, conditions };
      if (list_id) body.list_id = list_id;

      const response = await lettr.post<LettrResponse<AudienceSegment>>(
        '/audience/segments',
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Segment created successfully.' },
          { type: 'text', text: formatSegment(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'get-audience-segment',
    {
      title: 'Get Audience Segment',
      description:
        'Retrieve a single audience segment by its ID, including its condition groups and cached contact count.',
      inputSchema: {
        segmentId: z.string().nonempty().describe('The segment ID'),
      },
    },
    async ({ segmentId }) => {
      const response = await lettr.get<LettrResponse<AudienceSegment>>(
        `/audience/segments/${encodeURIComponent(segmentId)}`,
      );

      return {
        content: [
          { type: 'text', text: 'Segment details:' },
          { type: 'text', text: formatSegment(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'update-audience-segment',
    {
      title: 'Update Audience Segment',
      description:
        'Update an audience segment. All fields are optional — only provided fields change. Providing conditions replaces the entire condition set.',
      inputSchema: {
        segmentId: z.string().nonempty().describe('The segment ID to update'),
        name: z
          .string()
          .nonempty()
          .max(255)
          .optional()
          .describe('New segment name'),
        list_id: z
          .string()
          .nullable()
          .optional()
          .describe('New list restriction (null removes the restriction)'),
        conditions: conditionsSchema.optional(),
      },
    },
    async ({ segmentId, ...rest }) => {
      if (rest.conditions) assertConditionValues(rest.conditions);
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }

      const response = await lettr.patch<LettrResponse<AudienceSegment>>(
        `/audience/segments/${encodeURIComponent(segmentId)}`,
        body,
      );

      return {
        content: [
          { type: 'text', text: 'Segment updated successfully.' },
          { type: 'text', text: formatSegment(response.data) },
        ],
      };
    },
  );

  server.registerTool(
    'delete-audience-segment',
    {
      title: 'Delete Audience Segment',
      description:
        'Delete an audience segment. Before using this tool, you MUST double-check with the user that they want to delete this segment. Warn them that this action is irreversible. (Contacts themselves are not deleted.)',
      inputSchema: {
        segmentId: z.string().nonempty().describe('The segment ID to delete'),
      },
    },
    async ({ segmentId }) => {
      await lettr.delete<undefined>(
        `/audience/segments/${encodeURIComponent(segmentId)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Segment "${segmentId}" deleted successfully.`,
          },
        ],
      };
    },
  );
}
