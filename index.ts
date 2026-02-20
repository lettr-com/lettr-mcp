#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import minimist from 'minimist';
import { LettrClient } from './lettr.js';
import packageJson from './package.json' with { type: 'json' };
import {
  addDomainTools,
  addEmailTools,
  addTemplateTools,
  addWebhookTools,
} from './tools/index.js';

const argv = minimist(process.argv.slice(2));

const apiKey = argv.key || process.env.LETTR_API_KEY;

const senderEmailAddress = argv.sender || process.env.SENDER_EMAIL_ADDRESS;

const replierEmailAddress =
  typeof argv['reply-to'] === 'string'
    ? argv['reply-to']
    : process.env.REPLY_TO_EMAIL_ADDRESS || undefined;

if (!apiKey) {
  console.error(
    'No API key provided. Please set LETTR_API_KEY environment variable or use --key argument',
  );
  process.exit(1);
}

const lettr = new LettrClient(apiKey);

const server = new McpServer({
  name: 'lettr',
  version: packageJson.version,
});

addEmailTools(server, lettr, { senderEmailAddress, replierEmailAddress });
addTemplateTools(server, lettr);
addDomainTools(server, lettr);
addWebhookTools(server, lettr);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lettr MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
