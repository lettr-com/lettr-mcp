import fs from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface SendEmailResponse {
  request_id: string;
  accepted: number;
  rejected: number;
}

const EMAIL_EVENT_TYPES = [
  'injection',
  'delivery',
  'bounce',
  'delay',
  'out_of_band',
  'spam_complaint',
  'policy_rejection',
  'click',
  'open',
  'initial_open',
  'amp_click',
  'amp_open',
  'amp_initial_open',
  'generation_failure',
  'generation_rejection',
  'list_unsubscribe',
  'link_unsubscribe',
] as const;

interface EmailEvent {
  event_id: string;
  type: string;
  timestamp: string;
  request_id?: string | null;
  rcpt_to?: string | null;
  subject?: string | null;
  friendly_from?: string | null;
  [key: string]: unknown;
}

interface EventsBlock {
  data: EmailEvent[];
  total_count: number;
  from: string;
  to: string;
  pagination: { next_cursor: string | null; per_page: number };
}

interface EventsListResponse {
  message: string;
  data: { events: EventsBlock };
}

type EmailDetailState =
  | 'submitted'
  | 'generating'
  | 'scheduled'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'unknown';

interface EmailDetail {
  transmission_id: string;
  state: EmailDetailState;
  scheduled_at: string | null;
  from: string;
  from_name: string | null;
  subject: string;
  recipients: string[];
  num_recipients: number;
  events: EmailEvent[];
}

/**
 * Lifecycle of a scheduled email. Lettr holds the email until it is due, so
 * these are Lettr's own states — not the delivery states in EmailDetailState.
 */
type ScheduledEmailState =
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed';

/**
 * An email waiting to be sent.
 *
 * Two ids, and they are not interchangeable: `request_id` (`sch_…`) addresses
 * the scheduled email and is what get/cancel take, while `transmission_id` is
 * the provider's id — null until the email is actually sent, and the value
 * that appears on webhook events.
 */
interface ScheduledEmail {
  request_id: string;
  transmission_id: string | null;
  state: ScheduledEmailState;
  scheduled_at: string | null;
  from: string;
  from_name: string | null;
  subject: string | null;
  recipients: string[];
  num_recipients: number;
  accepted: number;
  rejected: number;
  tag: string | null;
  failure_reason: string | null;
  events: EmailEvent[];
}

interface ScheduledEmailsListResponse {
  message: string;
  data: {
    scheduled_emails: ScheduledEmail[];
    pagination: {
      total: number;
      per_page: number;
      current_page: number;
      last_page: number;
    };
  };
}

function formatScheduledEmail(d: ScheduledEmail): string {
  return [
    `Scheduled email: ${d.request_id}`,
    `State: ${d.state}`,
    d.scheduled_at ? `Scheduled for: ${d.scheduled_at}` : null,
    `From: ${d.from_name ? `${d.from_name} <${d.from}>` : d.from}`,
    d.subject ? `Subject: ${d.subject}` : null,
    `Recipients (${d.num_recipients}): ${d.recipients.join(', ')}`,
    d.tag ? `Tag: ${d.tag}` : null,
    // Only meaningful once sent — this is the id webhook events carry.
    d.transmission_id
      ? `Transmission: ${d.transmission_id}`
      : 'Transmission: not sent yet',
    d.failure_reason ? `Failure reason: ${d.failure_reason}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join('\n');
}

const sendEmailShape = (
  senderEmailAddress?: string,
  replierEmailAddress?: string,
) => ({
  to: z
    .array(z.email().max(255))
    .min(1)
    .max(50)
    .describe('Array of recipient email addresses (1-50 recipients)'),
  subject: z
    .string()
    .max(998)
    .optional()
    .describe(
      "Email subject line. Required unless template_slug is provided — templates supply their own subject as a default. If provided alongside a template, overrides the template's subject.",
    ),
  text: z
    .string()
    .optional()
    .describe(
      'Plain text email content. At least one of html, text or template_slug is required.',
    ),
  html: z
    .string()
    .optional()
    .describe(
      'HTML email content. At least one of html, text or template_slug is required.',
    ),
  amp_html: z
    .string()
    .optional()
    .describe('AMP HTML content for supported email clients.'),
  template_slug: z
    .string()
    .max(255)
    .optional()
    .describe(
      "Template slug to use for email content. When provided, the template's HTML is used. Use get-merge-tags to discover required substitution_data keys.",
    ),
  template_version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Specific template version to use. Defaults to the active version.',
    ),
  project_id: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Project ID containing the template. Defaults to the team's default project.",
    ),
  substitution_data: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Variables for template substitution (e.g. { "first_name": "John" }).',
    ),
  cc: z
    .array(z.email().max(255))
    .optional()
    .describe(
      'Optional array of CC email addresses. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
    ),
  bcc: z
    .array(z.email().max(255))
    .optional()
    .describe(
      'Optional array of BCC email addresses. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
    ),
  from_name: z
    .string()
    .max(255)
    .optional()
    .describe('Sender display name (e.g. "Acme Support")'),
  reply_to_name: z
    .string()
    .max(255)
    .optional()
    .describe('Reply-To display name'),
  tag: z
    .string()
    .max(64)
    .optional()
    .describe('Tag for tracking and analytics (max 64 characters)'),
  metadata: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Custom metadata for tracking (e.g. { "user_id": "123", "campaign": "onboarding" })',
    ),
  headers: z
    .record(z.string(), z.string().max(998))
    .optional()
    .describe(
      'Custom email headers (up to 10). Standard envelope headers (From, To, Subject, etc.), SparkPost internal headers (X-MSYS-API) and List-Unsubscribe headers are managed automatically and cannot be overridden.',
    ),
  options: z
    .object({
      click_tracking: z
        .boolean()
        .optional()
        .describe('Enable click tracking for links'),
      open_tracking: z
        .boolean()
        .optional()
        .describe('Enable open tracking via pixel'),
      transactional: z
        .boolean()
        .optional()
        .describe('Mark as transactional (not marketing)'),
      inline_css: z.boolean().optional().describe('Inline CSS styles in HTML'),
      perform_substitutions: z
        .boolean()
        .optional()
        .describe('Perform variable substitutions in content'),
    })
    .optional()
    .describe('Email delivery options'),
  attachments: z
    .array(
      z.object({
        name: z
          .string()
          .max(255)
          .describe('Filename with extension (e.g. "report.pdf")'),
        type: z
          .string()
          .max(255)
          .describe('MIME type (e.g. "application/pdf")'),
        data: z
          .string()
          .optional()
          .describe('Base64-encoded file content (no line breaks)'),
        filePath: z
          .string()
          .optional()
          .describe(
            'Local file path to read and attach (will be base64 encoded automatically)',
          ),
      }),
    )
    .optional()
    .describe(
      'Array of file attachments. Each needs name, type and either data (base64) or filePath.',
    ),
  ...(senderEmailAddress
    ? {}
    : {
        from: z
          .email()
          .max(255)
          .describe(
            'Sender email address. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
          ),
      }),
  ...(replierEmailAddress
    ? {}
    : {
        reply_to: z
          .email()
          .max(255)
          .optional()
          .describe(
            'Optional reply-to email address. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
          ),
      }),
});

async function buildSendEmailBody(
  input: {
    from?: string;
    to: string[];
    subject?: string;
    text?: string;
    html?: string;
    amp_html?: string;
    template_slug?: string;
    template_version?: number;
    project_id?: number;
    substitution_data?: Record<string, string>;
    cc?: string[];
    bcc?: string[];
    reply_to?: string;
    from_name?: string;
    reply_to_name?: string;
    tag?: string;
    metadata?: Record<string, string>;
    headers?: Record<string, string>;
    options?: Record<string, boolean | undefined>;
    attachments?: Array<{
      name: string;
      type: string;
      data?: string;
      filePath?: string;
    }>;
  },
  defaults: { senderEmailAddress?: string; replierEmailAddress?: string },
): Promise<Record<string, unknown>> {
  const fromAddress = input.from ?? defaults.senderEmailAddress;
  const replyToAddress = input.reply_to ?? defaults.replierEmailAddress;

  if (typeof fromAddress !== 'string') {
    throw new Error('from argument must be provided.');
  }

  if (!input.html && !input.text && !input.template_slug) {
    throw new Error(
      'At least one of html, text or template_slug must be provided.',
    );
  }

  if (!input.template_slug && !input.subject) {
    throw new Error(
      'subject is required unless template_slug is provided (templates supply a default subject).',
    );
  }

  if (input.headers && Object.keys(input.headers).length > 10) {
    throw new Error('headers supports a maximum of 10 entries.');
  }

  const body: Record<string, unknown> = {
    from: fromAddress,
    to: input.to,
  };
  if (input.subject !== undefined) body.subject = input.subject;
  if (input.from_name) body.from_name = input.from_name;
  if (input.text) body.text = input.text;
  if (input.html) body.html = input.html;
  if (input.amp_html) body.amp_html = input.amp_html;
  if (input.template_slug) body.template_slug = input.template_slug;
  if (input.template_version) body.template_version = input.template_version;
  if (input.project_id) body.project_id = input.project_id;
  if (input.substitution_data) body.substitution_data = input.substitution_data;
  if (input.cc) body.cc = input.cc;
  if (input.bcc) body.bcc = input.bcc;
  if (replyToAddress) body.reply_to = replyToAddress;
  if (input.reply_to_name) body.reply_to_name = input.reply_to_name;
  if (input.tag) body.tag = input.tag;
  if (input.metadata) body.metadata = input.metadata;
  if (input.headers) body.headers = input.headers;
  if (input.options) body.options = input.options;

  if (input.attachments && input.attachments.length > 0) {
    body.attachments = await Promise.all(
      input.attachments.map(async (att) => {
        let data = att.data;
        if (!data && att.filePath) {
          const fileBuffer = await fs.readFile(att.filePath);
          data = fileBuffer.toString('base64');
        }
        if (!data) {
          throw new Error(
            `Attachment "${att.name}" requires either data (base64) or filePath.`,
          );
        }
        return { name: att.name, type: att.type, data };
      }),
    );
  }

  return body;
}

function formatEvent(e: EmailEvent): string {
  const recipient = e.rcpt_to ? ` → ${e.rcpt_to}` : '';
  const subject = e.subject ? ` "${e.subject}"` : '';
  return `[${e.timestamp}] ${e.type}${recipient}${subject} (${e.event_id})`;
}

function formatEventsBlock(block: EventsBlock, heading: string): string {
  if (block.data.length === 0) {
    return `${heading} — no events in ${block.from} … ${block.to}.`;
  }
  const cursor = block.pagination.next_cursor
    ? `\nnext_cursor: ${block.pagination.next_cursor}`
    : '';
  return `${heading} (total ${block.total_count}, page size ${block.pagination.per_page}, range ${block.from} … ${block.to}):\n${block.data
    .map(formatEvent)
    .join('\n')}${cursor}`;
}

export function addEmailTools(
  server: McpServer,
  lettr: LettrClient,
  defaults: { senderEmailAddress?: string; replierEmailAddress?: string },
) {
  const { senderEmailAddress, replierEmailAddress } = defaults;

  server.registerTool(
    'send-email',
    {
      title: 'Send Email',
      description: `**Purpose:** Send a transactional email to one or more recipients. Supports HTML, plain text, AMP HTML, templates with merge tags, attachments, custom headers, tracking, and personalization.

**Returns:** Send confirmation with request ID and accepted/rejected counts.

**When to use:**
- User wants to "send an email" to specific people
- One-off messages: password reset, order confirmation, receipt, alert
- User says "email this to X", "notify them", "send a message to..."
- Sending with a template: use template_slug and substitution_data (subject is optional in this case)

**Key trigger phrases:** "Send an email", "Email this to", "Notify", "Send a message", "Reply to them"

**Retrying:** pass idempotency_key and reuse the same value on a retry. Without it, a retry after a timeout sends the email twice — the first attempt may well have succeeded and only the response was lost.`,
      inputSchema: {
        ...sendEmailShape(senderEmailAddress, replierEmailAddress),
        idempotency_key: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe(
            'Opaque key making this send safe to retry. Reuse the SAME value when retrying and the API returns the original result instead of delivering a second email. Derive it from what the send is about (e.g. "order-12345-receipt"), not from a timestamp or random value — a fresh key on a retry defeats the point. Keys are kept 24 hours and are scoped per team and API key.',
          ),
      },
    },
    async (input) => {
      const body = await buildSendEmailBody(input, defaults);

      // Keyless sends keep the plain path: with no key there is nothing to
      // replay, so there is no header worth reading back.
      if (!input.idempotency_key) {
        const response = await lettr.post<LettrResponse<SendEmailResponse>>(
          '/emails',
          body,
        );

        return {
          content: [
            {
              type: 'text',
              text: `Email sent successfully! Request ID: ${response.data.request_id}, Accepted: ${response.data.accepted}, Rejected: ${response.data.rejected}`,
            },
          ],
        };
      }

      const { data: response, replayed } = await lettr.postIdempotent<
        LettrResponse<SendEmailResponse>
      >('/emails', body, input.idempotency_key);

      const outcome = replayed
        ? 'Replayed an earlier send with this idempotency key — no second email went out.'
        : 'Email sent successfully!';

      return {
        content: [
          {
            type: 'text',
            text: `${outcome} Request ID: ${response.data.request_id}, Accepted: ${response.data.accepted}, Rejected: ${response.data.rejected}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'list-emails',
    {
      title: 'List Sent Emails',
      description:
        'List recently sent emails with pagination and optional filters. Returns injection events for each email so you can inspect subject, recipient and timestamp.',
      inputSchema: {
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page (1-100, default 25)'),
        cursor: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response'),
        recipients: z
          .email()
          .optional()
          .describe('Filter by recipient email address'),
        from: z
          .string()
          .optional()
          .describe(
            'ISO 8601 start date (defaults to 10 days ago if not provided)',
          ),
        to: z.string().optional().describe('ISO 8601 end date'),
      },
    },
    async (input) => {
      const response = await lettr.get<EventsListResponse>('/emails', input);
      return {
        content: [
          {
            type: 'text',
            text: formatEventsBlock(response.data.events, 'Sent emails'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list-email-events',
    {
      title: 'List Email Events',
      description:
        'List email events (delivery, bounce, click, open, …) across all sent messages, filtered by event type, recipient, date range, transmission ID or bounce class.',
      inputSchema: {
        events: z
          .array(z.enum(EMAIL_EVENT_TYPES))
          .optional()
          .describe('Filter by event type(s).'),
        recipients: z
          .array(z.email())
          .optional()
          .describe('Filter by recipient email address(es).'),
        from: z
          .string()
          .optional()
          .describe('ISO 8601 start date (defaults to 10 days ago).'),
        to: z.string().optional().describe('ISO 8601 end date.'),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page (1-100, default 25).'),
        cursor: z.string().optional().describe('Pagination cursor.'),
        transmissions: z
          .string()
          .optional()
          .describe('Filter by transmission ID (request_id).'),
        bounce_classes: z
          .string()
          .optional()
          .describe('Comma-separated bounce classification codes.'),
      },
    },
    async (input) => {
      const query: Record<string, string | number | undefined> = {};
      if (input.events) query.events = input.events.join(',');
      if (input.recipients) query.recipients = input.recipients.join(',');
      if (input.from) query.from = input.from;
      if (input.to) query.to = input.to;
      if (input.per_page) query.per_page = input.per_page;
      if (input.cursor) query.cursor = input.cursor;
      if (input.transmissions) query.transmissions = input.transmissions;
      if (input.bounce_classes) query.bounce_classes = input.bounce_classes;

      const response = await lettr.get<EventsListResponse>(
        '/emails/events',
        query,
      );
      return {
        content: [
          {
            type: 'text',
            text: formatEventsBlock(response.data.events, 'Email events'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-email-detail',
    {
      title: 'Get Email Detail',
      description:
        'Retrieve the full delivery timeline for a single transmission by request ID — returns derived state (scheduled/delivered/bounced/failed), recipients and all events.',
      inputSchema: {
        request_id: z
          .string()
          .nonempty()
          .describe('Transmission request ID returned by send-email'),
        from: z.string().optional().describe('ISO 8601 start date'),
        to: z.string().optional().describe('ISO 8601 end date'),
      },
    },
    async ({ request_id, from, to }) => {
      const response = await lettr.get<LettrResponse<EmailDetail>>(
        `/emails/${encodeURIComponent(request_id)}`,
        { from, to },
      );
      const d = response.data;
      const eventLines =
        d.events.length === 0
          ? '(no events yet)'
          : d.events.map(formatEvent).join('\n');
      return {
        content: [
          {
            type: 'text',
            text: [
              `Transmission: ${d.transmission_id}`,
              `State: ${d.state}`,
              d.scheduled_at ? `Scheduled for: ${d.scheduled_at}` : null,
              `From: ${d.from_name ? `${d.from_name} <${d.from}>` : d.from}`,
              `Subject: ${d.subject}`,
              `Recipients (${d.num_recipients}): ${d.recipients.join(', ')}`,
            ]
              .filter((x): x is string => x !== null)
              .join('\n'),
          },
          { type: 'text', text: `Events:\n${eventLines}` },
        ],
      };
    },
  );

  server.registerTool(
    'schedule-email',
    {
      title: 'Schedule Email',
      description: `Schedule an email for future delivery. Accepts the same fields as send-email plus a required scheduled_at (ISO 8601, UTC) that is at least 5 minutes in the future and at most 30 days out.

**Returns:** The scheduled email, including the \`sch_\` request ID that get-scheduled-email and cancel-scheduled-email take.`,
      inputSchema: {
        ...sendEmailShape(senderEmailAddress, replierEmailAddress),
        scheduled_at: z
          .string()
          .describe(
            'ISO 8601 UTC datetime (e.g. 2024-01-16T10:00:00Z). Must be 5+ minutes in the future and within 30 days.',
          ),
      },
    },
    async (input) => {
      const { scheduled_at, ...sendInput } = input;
      const body = await buildSendEmailBody(sendInput, defaults);
      body.scheduled_at = scheduled_at;
      const response = await lettr.post<LettrResponse<ScheduledEmail>>(
        '/emails/scheduled',
        body,
      );
      return {
        content: [{ type: 'text', text: formatScheduledEmail(response.data) }],
      };
    },
  );

  server.registerTool(
    'get-scheduled-email',
    {
      title: 'Get Scheduled Email',
      description:
        'Retrieve details of a scheduled email, including its state, scheduled_at timestamp, recipients and any events collected so far. Works for every state, not only pending ones — a cancelled or sent email is still readable.',
      inputSchema: {
        request_id: z
          .string()
          .nonempty()
          .describe('The `sch_` request ID returned by schedule-email'),
      },
    },
    async ({ request_id }) => {
      const response = await lettr.get<LettrResponse<ScheduledEmail>>(
        `/emails/scheduled/${encodeURIComponent(request_id)}`,
      );
      const d = response.data;
      const eventLines =
        d.events.length === 0
          ? '(no events yet)'
          : d.events.map(formatEvent).join('\n');
      return {
        content: [
          { type: 'text', text: formatScheduledEmail(d) },
          { type: 'text', text: `Events:\n${eventLines}` },
        ],
      };
    },
  );

  server.registerTool(
    'cancel-scheduled-email',
    {
      title: 'Cancel Scheduled Email',
      description:
        'Cancel a scheduled email before it is sent. Before using this tool, you MUST confirm with the user that they really want to cancel this email — this action cannot be undone. Only an email still in the `scheduled` state can be cancelled.',
      inputSchema: {
        request_id: z
          .string()
          .nonempty()
          .describe('The `sch_` request ID to cancel'),
      },
    },
    async ({ request_id }) => {
      // Cancelling answers with the cancelled email, so report its real state
      // rather than asserting success.
      const response = await lettr.delete<LettrResponse<ScheduledEmail>>(
        `/emails/scheduled/${encodeURIComponent(request_id)}`,
      );
      return {
        content: [{ type: 'text', text: formatScheduledEmail(response.data) }],
      };
    },
  );

  server.registerTool(
    'list-scheduled-emails',
    {
      title: 'List Scheduled Emails',
      description:
        'List emails waiting to be sent, soonest delivery time first. Use this to find the `sch_` request ID of an email the user describes but cannot name, before getting or cancelling it.',
      inputSchema: {
        status: z
          .enum(['scheduled', 'sending', 'sent', 'cancelled', 'failed'])
          .optional()
          .describe(
            'Only return emails in this state. Omit to see every state.',
          ),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page (1-100, default 25)'),
        page: z.number().int().min(1).optional().describe('Page number'),
      },
    },
    async (input) => {
      const response = await lettr.get<ScheduledEmailsListResponse>(
        '/emails/scheduled',
        input,
      );
      const { scheduled_emails, pagination } = response.data;

      if (scheduled_emails.length === 0) {
        return {
          content: [{ type: 'text', text: 'No scheduled emails found.' }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Scheduled emails (total ${pagination.total}, page ${pagination.current_page} of ${pagination.last_page}, page size ${pagination.per_page}):\n\n${scheduled_emails
              .map(formatScheduledEmail)
              .join('\n\n')}`,
          },
        ],
      };
    },
  );
}
