# Lettr MCP Server

The official [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [Lettr](https://lettr.com) — the email API for developers. Send transactional emails, manage templates with merge tags, configure domains, and monitor webhooks — directly from any MCP client like [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.com), or [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Why Lettr?

[Lettr](https://lettr.com) is a modern email sending platform built for developers. It offers a clean REST API, a powerful drag-and-drop template editor, merge tag personalization, open and click tracking, and best-in-class deliverability. Whether you're sending password resets, order confirmations, or onboarding sequences, Lettr makes it simple and reliable.

- **[API Reference](https://docs.lettr.com/api-reference/introduction)** — Full REST API documentation
- **[Templates](https://docs.lettr.com/learn/templates/introduction)** — Visual email editor with merge tags
- **[Domains](https://docs.lettr.com/learn/domains/introduction)** — Domain verification and DNS setup
- **[Webhooks](https://docs.lettr.com/learn/webhooks/introduction)** — Real-time event notifications
- **[Quickstart Guides](https://docs.lettr.com/quickstart/nodejs/introduction)** — Node.js, PHP, Laravel, Python, Go, Rust, and more

## Features

- **Send Emails** — Send transactional emails with HTML, plain text, CC/BCC, attachments, tracking options, metadata, and tags. Supports [template-based sending](https://docs.lettr.com/learn/templates/introduction) with merge tag substitution, scheduled delivery, and inspecting sent messages and events.
- **Templates** — List, create, get, update, and delete email templates. Retrieve rendered HTML and [merge tags](https://docs.lettr.com/learn/templates/template-language) to discover which variables a template expects before sending.
- **Domains** — List, create, get, delete, and [verify sending domains](https://docs.lettr.com/learn/domains/sending-domains). View DNS records required for SPF, DKIM, and DMARC authentication.
- **Webhooks** — List, create, get, update, and delete [webhook configurations](https://docs.lettr.com/learn/webhooks/introduction) for real-time email event notifications.
- **Projects** — List the projects available to your team so you can target template and email tools at a specific project.
- **System** — Health check and API key validation for client setup and diagnostics.

## Setup

1. Create a free [Lettr account](https://app.lettr.com/register)
2. [Create an API key](https://docs.lettr.com/learn/api-keys/introduction) in your dashboard
3. [Verify your domain](https://docs.lettr.com/learn/domains/sending-domains) to send emails to any recipient

## Usage

### Claude Code

```bash
claude mcp add lettr -e LETTR_API_KEY=lttr_xxxxxxxxx -- npx -y lettr-mcp
```

### Cursor

Open the command palette and choose "Cursor Settings" > "MCP" > "Add new global MCP server".

```json
{
  "mcpServers": {
    "lettr": {
      "command": "npx",
      "args": ["-y", "lettr-mcp"],
      "env": {
        "LETTR_API_KEY": "lttr_xxxxxxxxx"
      }
    }
  }
}
```

### Claude Desktop

Open Claude Desktop settings > "Developer" tab > "Edit Config".

```json
{
  "mcpServers": {
    "lettr": {
      "command": "npx",
      "args": ["-y", "lettr-mcp"],
      "env": {
        "LETTR_API_KEY": "lttr_xxxxxxxxx"
      }
    }
  }
}
```

### Options

You can pass additional arguments to configure the server:

- `--key`: Your Lettr API key (alternative to `LETTR_API_KEY` env var)
- `--sender`: Default sender email address from a [verified domain](https://docs.lettr.com/learn/domains/sending-domains)
- `--reply-to`: Default reply-to email address

Environment variables:

- `LETTR_API_KEY`: Your Lettr API key (required)
- `SENDER_EMAIL_ADDRESS`: Default sender email address from a verified domain (optional)
- `REPLY_TO_EMAIL_ADDRESS`: Default reply-to email address (optional)

> **Note:** If you don't provide a sender email address, the MCP server will ask for one each time you send an email.

## Available Tools

### Emails

| Tool | Description |
|------|-------------|
| `send-email` | Send a transactional email with HTML, plain text, templates, attachments, tracking, and personalization |
| `list-emails` | List recently sent emails (cursor-paginated, with recipient and date filters) |
| `list-email-events` | List email events (delivery, bounce, click, open, …) with filters by type, recipient, transmission, and date range |
| `get-email-detail` | Retrieve the full delivery timeline for a single transmission by request ID |
| `schedule-email` | Schedule a transactional email for future delivery (5+ minutes ahead, within 3 days) |
| `get-scheduled-email` | Get the state and events of a scheduled transmission |
| `cancel-scheduled-email` | Cancel a scheduled transmission before it is sent |

### Templates

| Tool | Description |
|------|-------------|
| `list-templates` | List email templates with pagination |
| `get-template` | Get full template details including HTML content |
| `create-template` | Create a new template with HTML or visual editor JSON |
| `update-template` | Update template name and/or content (creates new version) |
| `delete-template` | Permanently delete a template and all versions |
| `get-merge-tags` | Discover merge tag variables a template expects |
| `get-template-html` | Retrieve a template's rendered HTML, subject, and merge tags by project ID and slug |

### Domains

| Tool | Description |
|------|-------------|
| `list-domains` | List all sending domains and their verification status |
| `create-domain` | Register a new sending domain |
| `get-domain` | Get domain details with DNS records |
| `delete-domain` | Remove a sending domain |
| `verify-domain` | Trigger DNS verification for a domain |

### Webhooks

| Tool | Description |
|------|-------------|
| `list-webhooks` | List all webhook configurations |
| `get-webhook` | Get webhook details and delivery status |
| `create-webhook` | Create a new webhook subscription with auth and event-type selection |
| `update-webhook` | Update an existing webhook (name, URL, auth, events, active flag) |
| `delete-webhook` | Delete a webhook subscription |

### Projects

| Tool | Description |
|------|-------------|
| `list-projects` | List projects owned by the team — useful for discovering project IDs |

### System

| Tool | Description |
|------|-------------|
| `health-check` | Check the Lettr API health status |
| `auth-check` | Validate the configured API key and return the team ID |

## Local Development

1. Clone and build:

```bash
git clone https://github.com/nicholasgriffintn/lettr-mcp.git
cd lettr-mcp
pnpm install
pnpm run build
```

2. Use the local build in your MCP client:

```json
{
  "mcpServers": {
    "lettr": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_PROJECT/dist/index.js"],
      "env": {
        "LETTR_API_KEY": "lttr_xxxxxxxxx"
      }
    }
  }
}
```

### Testing with MCP Inspector

> Make sure you've built the project first (see [Local Development](#local-development) above).

1. Set your API key:

   ```bash
   export LETTR_API_KEY=lttr_your_key_here
   ```

2. Start the inspector:

   ```bash
   pnpm inspector
   ```

3. In the browser (Inspector UI):

   - Choose **stdio** (launch a process).
   - **Command:** `node`
   - **Args:** `dist/index.js`
   - **Env:** `LETTR_API_KEY=lttr_your_key_here`
   - Click **Connect**, then use "List tools" to verify the server is working.

## Resources

- [Lettr Website](https://lettr.com)
- [API Documentation](https://docs.lettr.com/api-reference/introduction)
- [MCP Setup Guide](https://docs.lettr.com/learn/mcp/setup)
- [MCP Tools Reference](https://docs.lettr.com/learn/mcp/tools-reference)
- [Template Language](https://docs.lettr.com/learn/templates/template-language)
- [DNS Setup Guides](https://docs.lettr.com/knowledge-base/dns-guides/cloudflare)
- [Knowledge Base](https://docs.lettr.com/knowledge-base/introduction)

## License

MIT
