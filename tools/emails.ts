import fs from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface SendEmailResponse {
  request_id: string;
  accepted: number;
  rejected: number;
}

export function addEmailTools(
  server: McpServer,
  lettr: LettrClient,
  {
    senderEmailAddress,
    replierEmailAddress,
  }: {
    senderEmailAddress?: string;
    replierEmailAddress?: string;
  },
) {
  server.registerTool(
    'send-email',
    {
      title: 'Send Email',
      description: `**Purpose:** Send a transactional email to one or more recipients. Supports HTML, plain text, templates with merge tags, attachments, tracking, and personalization.

**Returns:** Send confirmation with request ID and accepted/rejected counts.

**When to use:**
- User wants to "send an email" to specific people
- One-off messages: password reset, order confirmation, receipt, alert
- User says "email this to X", "notify them", "send a message to..."
- Sending with a template: use template_slug and substitution_data

**Key trigger phrases:** "Send an email", "Email this to", "Notify", "Send a message", "Reply to them"`,
      inputSchema: {
        to: z
          .array(z.email())
          .min(1)
          .max(50)
          .describe('Array of recipient email addresses (1-50 recipients)'),
        subject: z.string().describe('Email subject line'),
        text: z
          .string()
          .optional()
          .describe(
            'Plain text email content. At least one of html, text, or template_slug is required.',
          ),
        html: z
          .string()
          .optional()
          .describe(
            'HTML email content. At least one of html, text, or template_slug is required.',
          ),
        template_slug: z
          .string()
          .optional()
          .describe(
            "Template slug to use for email content. When provided, the template's HTML will be used. Use get-merge-tags to discover required substitution_data keys.",
          ),
        template_version: z
          .number()
          .optional()
          .describe(
            'Specific template version to use. If not provided, the active version is used.',
          ),
        project_id: z
          .number()
          .optional()
          .describe(
            "Project ID containing the template. If not provided, the team's default project is used.",
          ),
        substitution_data: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Variables for template substitution (e.g. { "first_name": "John", "company": "Acme" }). Use with template_slug or inline {{variables}} in html/text.',
          ),
        cc: z
          .array(z.email())
          .optional()
          .describe(
            'Optional array of CC email addresses. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
          ),
        bcc: z
          .array(z.email())
          .optional()
          .describe(
            'Optional array of BCC email addresses. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
          ),
        from_name: z
          .string()
          .optional()
          .describe('Sender display name (e.g. "Acme Support")'),
        reply_to_name: z.string().optional().describe('Reply-To display name'),
        tag: z
          .string()
          .optional()
          .describe('Tag for tracking and analytics (max 64 characters)'),
        metadata: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Custom metadata for tracking (e.g. { "user_id": "123", "campaign": "onboarding" })',
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
            inline_css: z
              .boolean()
              .optional()
              .describe('Inline CSS styles in HTML'),
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
                .describe('Filename with extension (e.g. "report.pdf")'),
              type: z.string().describe('MIME type (e.g. "application/pdf")'),
              data: z
                .string()
                .optional()
                .describe('Base64-encoded file content'),
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
            'Array of file attachments. Each needs name, type, and either data (base64) or filePath.',
          ),
        ...(!senderEmailAddress
          ? {
              from: z
                .email()
                .nonempty()
                .describe(
                  'Sender email address. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
                ),
            }
          : {}),
        ...(!replierEmailAddress
          ? {
              reply_to: z
                .email()
                .optional()
                .describe(
                  'Optional reply-to email address. You MUST ask the user for this parameter. Under no circumstance provide it yourself',
                ),
            }
          : {}),
      },
    },
    async ({
      from,
      to,
      subject,
      text,
      html,
      template_slug,
      template_version,
      project_id,
      substitution_data,
      cc,
      bcc,
      reply_to,
      from_name,
      reply_to_name,
      tag,
      metadata,
      options,
      attachments,
    }) => {
      const fromAddress = from ?? senderEmailAddress;
      const replyToAddress = reply_to ?? replierEmailAddress;

      if (typeof fromAddress !== 'string') {
        throw new Error('from argument must be provided.');
      }

      console.error(`Debug - Sending email with from: ${fromAddress}`);

      const body: Record<string, unknown> = {
        from: fromAddress,
        to,
        subject,
      };

      if (from_name) body.from_name = from_name;
      if (text) body.text = text;
      if (html) body.html = html;
      if (template_slug) body.template_slug = template_slug;
      if (template_version) body.template_version = template_version;
      if (project_id) body.project_id = project_id;
      if (substitution_data) body.substitution_data = substitution_data;
      if (cc) body.cc = cc;
      if (bcc) body.bcc = bcc;
      if (replyToAddress) body.reply_to = replyToAddress;
      if (reply_to_name) body.reply_to_name = reply_to_name;
      if (tag) body.tag = tag;
      if (metadata) body.metadata = metadata;
      if (options) body.options = options;

      if (attachments && attachments.length > 0) {
        body.attachments = await Promise.all(
          attachments.map(async (att) => {
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
    },
  );
}
