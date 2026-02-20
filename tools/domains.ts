import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

interface DomainListItem {
  domain: string;
  status: string;
  status_label: string;
  can_send: boolean;
  cname_status: string | null;
  dkim_status: string | null;
  created_at: string;
  updated_at: string;
}

interface DomainDetail {
  domain: string;
  status: string;
  status_label: string;
  can_send: boolean;
  tracking_domain: string | null;
  cname_status: string | null;
  dkim_status: string | null;
  dns_records: DnsRecord[];
  created_at: string;
  updated_at: string;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  status: string;
  ttl?: string;
  priority?: number;
}

interface CreatedDomain {
  domain: string;
  status: string;
  status_label: string;
  dns_records: DnsRecord[];
  created_at: string;
}

interface VerifyDomainResult {
  domain: string;
  status: string;
  status_label: string;
  cname_status: string | null;
  dkim_status: string | null;
  dns_records: DnsRecord[];
}

function formatDnsRecords(records: DnsRecord[]): string {
  if (!records || records.length === 0) return 'No DNS records.';

  return records
    .map(
      (r) =>
        `${r.type}:\n  Name: ${r.name}\n  Value: ${r.value}\n  Status: ${r.status}${r.priority !== undefined ? `\n  Priority: ${r.priority}` : ''}`,
    )
    .join('\n\n');
}

export function addDomainTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-domains',
    {
      title: 'List Domains',
      description:
        'List all sending domains registered with your Lettr account. Returns domain names, statuses, and verification state.',
      inputSchema: {},
    },
    async () => {
      console.error('Debug - Listing domains');

      const response =
        await lettr.get<LettrResponse<{ domains: DomainListItem[] }>>(
          '/domains',
        );

      const domains = response.data.domains;

      if (domains.length === 0) {
        return {
          content: [{ type: 'text', text: 'No domains found.' }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Found ${domains.length} domain${domains.length === 1 ? '' : 's'}:`,
          },
          ...domains.map((d) => ({
            type: 'text' as const,
            text: `Domain: ${d.domain}\nStatus: ${d.status_label}\nCan Send: ${d.can_send}\nCNAME: ${d.cname_status ?? 'not set'}\nDKIM: ${d.dkim_status ?? 'not set'}`,
          })),
        ],
      };
    },
  );

  server.registerTool(
    'create-domain',
    {
      title: 'Create Domain',
      description:
        'Register a new sending domain with Lettr. The domain will be in a pending state until DNS records are verified and the domain is approved. You MUST display the DNS records to the user so they can set them up.',
      inputSchema: {
        domain: z
          .string()
          .nonempty()
          .describe('The domain name to register (e.g., example.com)'),
      },
    },
    async ({ domain }) => {
      console.error(`Debug - Creating domain: ${domain}`);

      const response = await lettr.post<LettrResponse<CreatedDomain>>(
        '/domains',
        { domain },
      );

      const created = response.data;
      return {
        content: [
          { type: 'text', text: 'Domain created successfully.' },
          {
            type: 'text',
            text: `Domain: ${created.domain}\nStatus: ${created.status_label}`,
          },
          {
            type: 'text',
            text: `DNS Records to configure:\n\n${formatDnsRecords(created.dns_records)}`,
          },
          {
            type: 'text',
            text: 'IMPORTANT: Display the DNS records above to the user so they can configure them with their DNS provider. After configuration, use verify-domain to start verification.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-domain',
    {
      title: 'Get Domain',
      description:
        'Retrieve details of a sending domain including DNS records, verification status, and tracking domain configuration.',
      inputSchema: {
        domain: z
          .string()
          .nonempty()
          .describe('The domain name (e.g., example.com)'),
      },
    },
    async ({ domain }) => {
      console.error(`Debug - Getting domain: ${domain}`);

      const response = await lettr.get<LettrResponse<DomainDetail>>(
        `/domains/${encodeURIComponent(domain)}`,
      );

      const d = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Domain: ${d.domain}\nStatus: ${d.status_label}\nCan Send: ${d.can_send}\nCNAME: ${d.cname_status ?? 'not set'}\nDKIM: ${d.dkim_status ?? 'not set'}${d.tracking_domain ? `\nTracking Domain: ${d.tracking_domain}` : ''}`,
          },
          {
            type: 'text',
            text: `DNS Records:\n\n${formatDnsRecords(d.dns_records)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'delete-domain',
    {
      title: 'Delete Domain',
      description:
        'Delete a sending domain from Lettr. Before using this tool, you MUST double-check with the user that they want to delete this domain. Warn them that this action is irreversible and will stop all email sending for that domain.',
      inputSchema: {
        domain: z.string().nonempty().describe('The domain name to delete'),
      },
    },
    async ({ domain }) => {
      console.error(`Debug - Deleting domain: ${domain}`);

      await lettr.delete<LettrResponse<undefined>>(
        `/domains/${encodeURIComponent(domain)}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Domain "${domain}" deleted successfully.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'verify-domain',
    {
      title: 'Verify Domain',
      description:
        'Trigger DNS verification for a domain. This checks if the DKIM and CNAME records are correctly configured. The domain status will update once records are verified.',
      inputSchema: {
        domain: z.string().nonempty().describe('The domain name to verify'),
      },
    },
    async ({ domain }) => {
      console.error(`Debug - Verifying domain: ${domain}`);

      const response = await lettr.post<LettrResponse<VerifyDomainResult>>(
        `/domains/${encodeURIComponent(domain)}/verify`,
      );

      const result = response.data;

      return {
        content: [
          {
            type: 'text',
            text: `Domain verification triggered.\nDomain: ${result.domain}\nStatus: ${result.status_label}\nCNAME: ${result.cname_status ?? 'not set'}\nDKIM: ${result.dkim_status ?? 'not set'}`,
          },
          {
            type: 'text',
            text: `DNS Records:\n\n${formatDnsRecords(result.dns_records)}`,
          },
        ],
      };
    },
  );
}
