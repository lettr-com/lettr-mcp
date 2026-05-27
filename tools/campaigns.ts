import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'preparing',
  'in_review',
  'sending',
  'sent',
  'failed',
] as const;

const EVENT_TYPES = [
  'injection',
  'delivery',
  'bounce',
  'spam_complaint',
  'open',
  'click',
  'list_unsubscribe',
] as const;

type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
type EventType = (typeof EVENT_TYPES)[number];

interface CampaignStats {
  injections: number;
  deliveries: number;
  bounces: number;
  spam_complaints: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  unsubscribes: number;
}

interface CampaignSummary {
  id: string;
  name: string;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  reply_to: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  total_recipients: number | null;
  sent_count: number;
  sent_at: string | null;
  created_at: string;
  stats: CampaignStats;
}

interface CampaignDetail extends CampaignSummary {
  html_content: string | null;
}

interface CampaignEvent {
  event_id: string;
  event_type: EventType;
  email: string;
  timestamp: string;
  bounce_class?: string | null;
  reason?: string | null;
  target_link_url?: string | null;
  user_agent?: string | null;
}

interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

const HTML_PREVIEW_CHARS = 500;

function formatStats(s: CampaignStats): string {
  return `opens ${s.opens} (unique ${s.unique_opens}), clicks ${s.clicks} (unique ${s.unique_clicks}), deliveries ${s.deliveries}, bounces ${s.bounces}, spam ${s.spam_complaints}, unsubscribes ${s.unsubscribes}`;
}

function formatCampaign(c: CampaignSummary): string {
  const sender = c.from_email
    ? c.from_name
      ? `${c.from_name} <${c.from_email}>`
      : c.from_email
    : 'none';
  const lines = [
    `ID: ${c.id}`,
    `Name: ${c.name}`,
    `Status: ${c.status}`,
    `Subject: ${c.subject ?? 'none'}`,
    `From: ${sender}`,
    `Reply-to: ${c.reply_to ?? 'none'}`,
    `Recipients: ${c.total_recipients ?? 'not yet resolved'}`,
    `Sent count: ${c.sent_count}`,
    `Scheduled at: ${c.scheduled_at ?? 'not scheduled'}`,
    `Sent at: ${c.sent_at ?? 'not sent'}`,
    `Created: ${c.created_at}`,
    `Stats: ${formatStats(c.stats)}`,
  ];
  return lines.join('\n');
}

function formatEvent(e: CampaignEvent): string {
  const extras: string[] = [];
  if (e.reason) extras.push(`reason: ${e.reason}`);
  if (e.bounce_class) extras.push(`bounce_class: ${e.bounce_class}`);
  if (e.target_link_url) extras.push(`url: ${e.target_link_url}`);
  const suffix = extras.length > 0 ? ` — ${extras.join(', ')}` : '';
  return `- ${e.timestamp} ${e.event_type} ${e.email} (id: ${e.event_id})${suffix}`;
}

export function addCampaignTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-campaigns',
    {
      title: 'List Campaigns',
      description:
        'List campaigns for your team, with pagination and an optional status filter. Each campaign includes embedded engagement stats. Use this to discover campaign IDs for the other campaign tools.',
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
          .max(10000)
          .optional()
          .describe('Page number (default 1)'),
        status: z
          .enum(CAMPAIGN_STATUSES)
          .optional()
          .describe('Filter by campaign status'),
      },
    },
    async ({ per_page, page, status }) => {
      const query: Record<string, string | number | undefined> = {};
      if (per_page) query.per_page = per_page;
      if (page) query.page = page;
      if (status) query.status = status;

      const response = await lettr.get<
        LettrResponse<{ campaigns: CampaignSummary[]; pagination: Pagination }>
      >('/campaigns', query);

      const { campaigns, pagination } = response.data;
      if (campaigns.length === 0) {
        return { content: [{ type: 'text', text: 'No campaigns found.' }] };
      }

      const lines = campaigns
        .map(
          (c) =>
            `- ${c.name} (id: ${c.id}, status: ${c.status}, sent: ${c.sent_count})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${pagination.total} campaign(s) — page ${pagination.current_page}/${pagination.last_page}:\n\n${lines}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-campaign',
    {
      title: 'Get Campaign',
      description:
        'Retrieve a single campaign by its ID, including embedded engagement stats and a preview of its rendered HTML content.',
      inputSchema: {
        campaignId: z.string().nonempty().describe('The campaign ID'),
      },
    },
    async ({ campaignId }) => {
      const response = await lettr.get<LettrResponse<CampaignDetail>>(
        `/campaigns/${encodeURIComponent(campaignId)}`,
      );

      const campaign = response.data;
      const html = campaign.html_content;
      const htmlText =
        html == null
          ? 'HTML content: none'
          : `HTML content: ${html.length} chars\nPreview:\n${html.slice(0, HTML_PREVIEW_CHARS)}${html.length > HTML_PREVIEW_CHARS ? '…' : ''}`;

      return {
        content: [
          { type: 'text', text: 'Campaign details:' },
          { type: 'text', text: formatCampaign(campaign) },
          { type: 'text', text: htmlText },
        ],
      };
    },
  );

  server.registerTool(
    'list-campaign-events',
    {
      title: 'List Campaign Events',
      description: `List engagement events (opens, clicks, bounces, etc.) for a campaign, with optional filters. Uses cursor-based pagination: this tool returns one page plus a \`next_cursor\`. Keep calling it with \`cursor\` set to the returned \`next_cursor\` until \`next_cursor\` is null. Note: when a filter is applied, a page can come back with no events but a non-null \`next_cursor\` — that means more pages remain, so keep paginating until \`next_cursor\` is null.`,
      inputSchema: {
        campaignId: z.string().nonempty().describe('The campaign ID'),
        event_type: z
          .enum(EVENT_TYPES)
          .optional()
          .describe('Filter by event type'),
        email: z
          .string()
          .optional()
          .describe('Filter by recipient email address'),
        start_date: z
          .string()
          .optional()
          .describe(
            'Only events at or after this time (ISO 8601). A date-only value (e.g. 2026-05-01) is treated as start of day in UTC.',
          ),
        end_date: z
          .string()
          .optional()
          .describe(
            'Only events at or before this time (ISO 8601, inclusive). A date-only value covers the whole day in UTC.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max events per page (1-100, default 25)'),
        cursor: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response'),
      },
    },
    async ({
      campaignId,
      event_type,
      email,
      start_date,
      end_date,
      limit,
      cursor,
    }) => {
      const query: Record<string, string | number | undefined> = {};
      if (event_type) query.event_type = event_type;
      if (email) query.email = email;
      if (start_date) query.start_date = start_date;
      if (end_date) query.end_date = end_date;
      if (limit) query.limit = limit;
      if (cursor) query.cursor = cursor;

      const response = await lettr.get<
        LettrResponse<{ events: CampaignEvent[]; next_cursor: string | null }>
      >(`/campaigns/${encodeURIComponent(campaignId)}/events`, query);

      const { events, next_cursor } = response.data;
      const cursorNote =
        next_cursor == null
          ? 'No more pages (next_cursor is null).'
          : `More pages remain — call again with cursor: ${next_cursor}`;

      if (events.length === 0) {
        return {
          content: [
            { type: 'text', text: `No events on this page. ${cursorNote}` },
          ],
        };
      }

      const lines = events.map(formatEvent).join('\n');
      return {
        content: [
          {
            type: 'text',
            text: `${events.length} event(s) on this page:\n\n${lines}\n\n${cursorNote}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'send-campaign',
    {
      title: 'Send Campaign',
      description:
        'Immediately send a draft campaign to its recipients. Before using this tool, you MUST double-check with the user that they want to send now. Warn them that this is irreversible and outward-facing — it dispatches real emails to recipients that cannot be recalled. The campaign must be a draft with a subject, sender, and content; on success it transitions to "preparing".',
      inputSchema: {
        campaignId: z.string().nonempty().describe('The campaign ID to send'),
      },
    },
    async ({ campaignId }) => {
      const response = await lettr.post<LettrResponse<CampaignSummary>>(
        `/campaigns/${encodeURIComponent(campaignId)}/send`,
      );

      const status = response.data?.status;
      return {
        content: [
          {
            type: 'text',
            text: response.message ?? 'Campaign queued for sending.',
          },
          ...(status
            ? [{ type: 'text' as const, text: `Status is now: ${status}` }]
            : []),
        ],
      };
    },
  );

  server.registerTool(
    'schedule-campaign',
    {
      title: 'Schedule Campaign',
      description:
        'Schedule a draft campaign for future delivery, or reschedule an already-scheduled campaign to a new time. Before using this tool, you MUST confirm the time with the user and warn them that at the scheduled time this will dispatch real emails to recipients. The campaign must be a draft or already scheduled, with a subject, sender, and content.',
      inputSchema: {
        campaignId: z
          .string()
          .nonempty()
          .describe('The campaign ID to schedule'),
        scheduled_at: z
          .string()
          .nonempty()
          .describe(
            'Future delivery time (ISO 8601, e.g. 2026-06-01T09:00:00+02:00). Include a timezone offset or "Z"; a value without an offset is interpreted as UTC. Must be in the future.',
          ),
      },
    },
    async ({ campaignId, scheduled_at }) => {
      const response = await lettr.post<LettrResponse<CampaignSummary>>(
        `/campaigns/${encodeURIComponent(campaignId)}/schedule`,
        { scheduled_at },
      );

      const scheduledAt = response.data?.scheduled_at;
      return {
        content: [
          {
            type: 'text',
            text: response.message ?? 'Campaign scheduled for delivery.',
          },
          ...(scheduledAt
            ? [
                {
                  type: 'text' as const,
                  text: `Scheduled at: ${scheduledAt}`,
                },
              ]
            : []),
        ],
      };
    },
  );

  server.registerTool(
    'unschedule-campaign',
    {
      title: 'Unschedule Campaign',
      description:
        'Cancel a scheduled send, returning the campaign to draft. The campaign must currently be scheduled.',
      inputSchema: {
        campaignId: z
          .string()
          .nonempty()
          .describe('The campaign ID to unschedule'),
      },
    },
    async ({ campaignId }) => {
      const response = await lettr.post<LettrResponse<CampaignSummary>>(
        `/campaigns/${encodeURIComponent(campaignId)}/unschedule`,
      );

      return {
        content: [
          {
            type: 'text',
            text:
              response.message ?? 'Campaign unscheduled; returned to draft.',
          },
        ],
      };
    },
  );
}
