import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LettrClient, LettrResponse } from '../lettr.js';

type DomainStatus = 'pending' | 'approved' | 'blocked';
type DkimCnameStatus = 'valid' | 'unverified' | 'invalid' | 'not_applicable';
type DmarcSpfStatus = 'valid' | 'invalid' | 'missing' | 'unverified';

interface DomainListItem {
  domain: string;
  status: DomainStatus;
  status_label: string;
  can_send: boolean;
  cname_status: string | null;
  dkim_status: string | null;
  created_at: string;
  updated_at: string;
}

interface DkimDns {
  selector?: string;
  public?: string;
  headers?: string;
}

interface DomainDnsProvider {
  provider: string;
  provider_label: string;
  nameservers: string[];
  error: string | null;
}

interface DomainDetail {
  domain: string;
  status: DomainStatus;
  status_label: string;
  can_send: boolean;
  cname_status?: string | null;
  dkim_status?: string | null;
  dmarc_status?: DmarcSpfStatus | null;
  spf_status?: DmarcSpfStatus | null;
  is_primary_domain?: boolean;
  tracking_domain?: string | null;
  dns?: { dkim?: DkimDns } | null;
  dns_provider?: DomainDnsProvider | null;
  created_at: string;
  updated_at: string;
}

interface DomainView {
  domain: string;
  status: DomainStatus;
  status_label: string;
  dkim?: DkimDns | null;
}

interface DomainDnsVerification {
  dkim_record: string | null;
  cname_record: string | null;
  dmarc_record: string | null;
  spf_record: string | null;
  dkim_error: string | null;
  cname_error: string | null;
  dmarc_error: string | null;
  spf_error: string | null;
}

interface DmarcValidationResult {
  is_valid: boolean;
  status: DmarcSpfStatus;
  found_at_domain: string | null;
  record: string | null;
  policy: 'none' | 'quarantine' | 'reject' | null;
  subdomain_policy: 'none' | 'quarantine' | 'reject' | null;
  error: string | null;
  covered_by_parent_policy: boolean;
}

interface SpfValidationResult {
  is_valid: boolean;
  status: DmarcSpfStatus;
  record: string | null;
  error: string | null;
  includes_sparkpost: boolean;
}

interface DomainVerificationView {
  domain: string;
  dkim_status: DkimCnameStatus;
  cname_status: DkimCnameStatus;
  dmarc_status: DmarcSpfStatus;
  spf_status: DmarcSpfStatus;
  is_primary_domain: boolean;
  ownership_verified: string | null;
  dns?: DomainDnsVerification;
  dmarc?: DmarcValidationResult;
  spf?: SpfValidationResult;
}

function formatDkim(dkim: DkimDns | null | undefined): string {
  if (!dkim) return 'No DKIM details.';
  const rows: string[] = [];
  if (dkim.selector) rows.push(`  Selector: ${dkim.selector}`);
  if (dkim.public) rows.push(`  Public key: ${dkim.public}`);
  if (dkim.headers) rows.push(`  Signed headers: ${dkim.headers}`);
  return rows.length > 0 ? `DKIM:\n${rows.join('\n')}` : 'No DKIM details.';
}

function formatDnsProvider(p: DomainDnsProvider | null): string {
  if (!p) return '';
  const ns =
    p.nameservers.length > 0 ? p.nameservers.join(', ') : '(none detected)';
  const err = p.error ? `\n  Error: ${p.error}` : '';
  return `DNS provider: ${p.provider_label} (${p.provider})\n  Nameservers: ${ns}${err}`;
}

function formatVerificationDns(dns: DomainDnsVerification | undefined): string {
  if (!dns) return '';
  const rows: string[] = [];
  const pair = (label: string, record: string | null, err: string | null) => {
    if (record || err) {
      rows.push(
        `  ${label}: ${record ?? '(not found)'}${err ? ` — ${err}` : ''}`,
      );
    }
  };
  pair('DKIM', dns.dkim_record, dns.dkim_error);
  pair('CNAME', dns.cname_record, dns.cname_error);
  pair('DMARC', dns.dmarc_record, dns.dmarc_error);
  pair('SPF', dns.spf_record, dns.spf_error);
  return rows.length > 0 ? `DNS lookup:\n${rows.join('\n')}` : '';
}

function formatDmarc(r: DmarcValidationResult | undefined): string {
  if (!r) return '';
  const parts = [`DMARC: ${r.status} (${r.is_valid ? 'valid' : 'not valid'})`];
  if (r.found_at_domain) parts.push(`  Found at: ${r.found_at_domain}`);
  if (r.policy) parts.push(`  Policy: ${r.policy}`);
  if (r.subdomain_policy)
    parts.push(`  Subdomain policy: ${r.subdomain_policy}`);
  if (r.record) parts.push(`  Record: ${r.record}`);
  if (r.error) parts.push(`  Error: ${r.error}`);
  parts.push(`  Covered by parent policy: ${r.covered_by_parent_policy}`);
  return parts.join('\n');
}

function formatSpf(r: SpfValidationResult | undefined): string {
  if (!r) return '';
  const parts = [`SPF: ${r.status} (${r.is_valid ? 'valid' : 'not valid'})`];
  if (r.record) parts.push(`  Record: ${r.record}`);
  if (r.error) parts.push(`  Error: ${r.error}`);
  parts.push(`  Includes SparkPost: ${r.includes_sparkpost}`);
  return parts.join('\n');
}

export function addDomainTools(server: McpServer, lettr: LettrClient) {
  server.registerTool(
    'list-domains',
    {
      title: 'List Domains',
      description:
        'List all sending domains registered with your Lettr account. Returns domain names, statuses, and CNAME/DKIM verification state.',
      inputSchema: {},
    },
    async () => {
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
            text: `Domain: ${d.domain}\nStatus: ${d.status_label}\nCan send: ${d.can_send}\nCNAME: ${d.cname_status ?? 'not set'}\nDKIM: ${d.dkim_status ?? 'not set'}`,
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
        'Register a new sending domain with Lettr. The domain starts in pending status until its DKIM record is set up and it is verified. After creation you MUST display the returned DKIM selector/public key to the user so they can configure their DNS.',
      inputSchema: {
        domain: z
          .string()
          .nonempty()
          .max(255)
          .describe('The domain name to register (e.g., example.com)'),
      },
    },
    async ({ domain }) => {
      const response = await lettr.post<LettrResponse<DomainView>>('/domains', {
        domain,
      });

      const d = response.data;
      return {
        content: [
          { type: 'text', text: 'Domain created successfully.' },
          {
            type: 'text',
            text: `Domain: ${d.domain}\nStatus: ${d.status_label}`,
          },
          { type: 'text', text: formatDkim(d.dkim ?? null) },
          {
            type: 'text',
            text: 'IMPORTANT: Share the DKIM details above with the user so they can add the TXT record at their DNS provider. After configuration, call verify-domain to trigger verification.',
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
        'Retrieve full details of a sending domain including CNAME, DKIM, DMARC and SPF status, tracking domain configuration, and any detected DNS provider.',
      inputSchema: {
        domain: z
          .string()
          .nonempty()
          .describe('The domain name (e.g., example.com)'),
      },
    },
    async ({ domain }) => {
      const response = await lettr.get<LettrResponse<DomainDetail>>(
        `/domains/${encodeURIComponent(domain)}`,
      );

      const d = response.data;
      const summary = [
        `Domain: ${d.domain}`,
        `Status: ${d.status_label}`,
        `Can send: ${d.can_send}`,
        `Primary domain: ${d.is_primary_domain ?? 'unknown'}`,
        `CNAME: ${d.cname_status ?? 'not set'}`,
        `DKIM: ${d.dkim_status ?? 'not set'}`,
        `DMARC: ${d.dmarc_status ?? 'not set'}`,
        `SPF: ${d.spf_status ?? 'not set'}`,
        d.tracking_domain ? `Tracking domain: ${d.tracking_domain}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join('\n');

      const content = [
        { type: 'text' as const, text: summary },
        { type: 'text' as const, text: formatDkim(d.dns?.dkim ?? null) },
      ];
      const providerBlock = formatDnsProvider(d.dns_provider ?? null);
      if (providerBlock) {
        content.push({ type: 'text' as const, text: providerBlock });
      }
      return { content };
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
      await lettr.delete<undefined>(`/domains/${encodeURIComponent(domain)}`);

      return {
        content: [
          { type: 'text', text: `Domain "${domain}" deleted successfully.` },
        ],
      };
    },
  );

  server.registerTool(
    'verify-domain',
    {
      title: 'Verify Domain',
      description:
        'Trigger DNS verification for a domain. Checks DKIM, CNAME (when applicable), DMARC and SPF records and returns the full validation report.',
      inputSchema: {
        domain: z.string().nonempty().describe('The domain name to verify'),
      },
    },
    async ({ domain }) => {
      const response = await lettr.post<LettrResponse<DomainVerificationView>>(
        `/domains/${encodeURIComponent(domain)}/verify`,
      );

      const v = response.data;
      const content = [
        {
          type: 'text' as const,
          text: [
            `Verification report for ${v.domain}:`,
            `  DKIM: ${v.dkim_status}`,
            `  CNAME: ${v.cname_status}`,
            `  DMARC: ${v.dmarc_status}`,
            `  SPF: ${v.spf_status}`,
            `  Primary domain: ${v.is_primary_domain}`,
            `  Ownership verified: ${v.ownership_verified ?? 'n/a'}`,
          ].join('\n'),
        },
      ];
      const dnsBlock = formatVerificationDns(v.dns);
      if (dnsBlock) content.push({ type: 'text' as const, text: dnsBlock });
      const dmarcBlock = formatDmarc(v.dmarc);
      if (dmarcBlock) content.push({ type: 'text' as const, text: dmarcBlock });
      const spfBlock = formatSpf(v.spf);
      if (spfBlock) content.push({ type: 'text' as const, text: spfBlock });
      return { content };
    },
  );
}
