# Changelog

All notable changes to the Lettr MCP project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-06-01

### Added

- `LettrClient` now sends a `User-Agent: lettr-mcp/<version>` header on every API request, letting Lettr attribute and debug traffic by client version

## [1.3.0] - 2026-05-27

### Added

- Campaign tools covering the Lettr campaigns API:
  - `list-campaigns` — paginated list with an optional `status` filter and embedded engagement stats
  - `get-campaign` — single campaign with stats and a truncated preview of the rendered HTML content
  - `list-campaign-events` — cursor-paginated engagement events (opens, clicks, bounces, etc.) with `event_type`, `email`, and date-range filters
  - `send-campaign` — send a draft campaign immediately
  - `schedule-campaign` — schedule a draft, or reschedule an already-scheduled campaign, to a future time
  - `unschedule-campaign` — cancel a scheduled send and return the campaign to draft

## [1.2.0] - 2026-05-26

### Added

- Audience management tools covering the Lettr audience API (every endpoint except the public double opt-in confirmation):
  - Lists: `list-audience-lists`, `create-audience-list`, `get-audience-list`, `update-audience-list`, `delete-audience-list`, `bulk-delete-audience-lists`
  - Contacts: `list-audience-contacts`, `get-audience-contact`, `create-audience-contact` (with double opt-in), `bulk-create-audience-contacts`, `update-audience-contact`, `delete-audience-contact`
  - Membership: `attach-contact-to-list`, `detach-contact-from-list`, `subscribe-contact-to-topic`, `unsubscribe-contact-from-topic`, `bulk-attach-contacts-to-lists`, `bulk-detach-contacts-from-lists`
  - Topics: `list-audience-topics`, `create-audience-topic`, `get-audience-topic`, `update-audience-topic`, `delete-audience-topic`
  - Properties: `list-audience-properties`, `create-audience-property`, `get-audience-property`, `update-audience-property`, `delete-audience-property`
  - Segments: `list-audience-segments`, `create-audience-segment`, `get-audience-segment`, `update-audience-segment`, `delete-audience-segment`
- `LettrClient` now supports `PATCH` requests and `DELETE` requests with a request body, used by the audience update and bulk-delete endpoints

## [1.1.0] - 2026-05-04

### Added

- `health-check` tool wrapping `GET /health` — verify Lettr API status without consuming quota
- `auth-check` tool wrapping `GET /auth/check` — validate the configured API key and return the team ID
- Project list tool (`list-projects`) and full webhook CRUD (`create-webhook`, `update-webhook`, `delete-webhook`) documented in the README

### Changed

- `update-webhook` now exposes the canonical `url` field instead of the deprecated `target` alias
- `create-webhook` validates the `events` array against the canonical fully-prefixed enum

### Fixed

- Webhook event-type enum: corrected `engagament.*` typos to the canonical `engagement.*` spelling
- Project and email list response types no longer assume a `success: true` envelope field that the API does not return

## [1.0.0] - 2026-02-20

### Added

- Initial release of Lettr MCP Server
- Send transactional emails with HTML, plain text, templates, and attachments
- Template management: list, create, get, update, delete
- Template merge tags: discover variables required for template-based sending
- Domain management: list, create, get, delete, verify
- Webhook management: list, get
- Support for template-based sending with substitution data
- Configurable default sender and reply-to addresses
