# Changelog

All notable changes to the Lettr MCP project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-09-11

Brings the MCP server level with the SDKs: template purpose, the folders
endpoint, preparation status, folder filtering and idempotent sends (TPL-2459,
TPL-2539). Everything is additive — existing tool calls keep working and send
identical requests.

### Added

- **`purpose` on `create-template`** — `transactional` (the default) or
  `campaign`. This is the one that matters: a campaign can only send a template
  whose purpose is `campaign`, and the purpose cannot be changed afterwards, so
  an agent that took the default for a newsletter had to rebuild it from
  scratch. The tool description explains the split rather than just naming the
  enum, because an agent has no other way to know a campaign needs a marketing
  template. The created-template output now states the purpose, so a wrong one
  is visible immediately instead of at send time.
- **`list-folders` tool** — the folders templates are filed into, each with its
  purpose and template count. Nothing else in the API returns a folder id, so
  before this the only options were to omit `folder_id` and accept whichever
  folder the API picked, or to hardcode an integer read out of an app URL.
  Read-only, because deleting a folder moves or deletes the templates inside it.
- **`purpose` and `folder_id` filters on `list-templates`** — one
  `per_page: 100` call reconciles a whole bulk import, instead of a
  `get-template` per template each dragging the full HTML payload against the
  same rate limit. A folder outside the resolved project is an error rather than
  an empty list, so a typo cannot be misread as "nothing there yet".
- **Preparation status on template reads** — `pending`, `ready` or `failed`,
  shown by `get-template` and by `list-templates` when a template is not ready.
  Settled templates are left unannotated: that is the uninteresting case and
  would only add noise to every row.
- **`idempotency_key` on `send-email`** — reuse the same value on a retry and
  the API returns the original result instead of delivering a second email. The
  output says when a send was replayed, so an agent can tell "already sent" from
  "sent again". You supply the key; the server never invents one, and the
  description steers agents away from timestamps and random values, which defeat
  the purpose on a retry.

### Changed

- A 409 during an idempotent send now says which of the two cases happened.
  `idempotency_in_progress` is safe to retry with the *same* key and reports
  `Retry-After`; `idempotency_key_conflict` means the key was used with a
  different payload and will fail identically forever. They were previously
  indistinguishable, which is the difference between waiting and giving up.

## [1.5.0] - 2026-08-14

Covers the reworked bulk contact import (TPL-2105) and the duplicate-create fix.
Everything here is additive — existing tool calls keep working and send the same
request bodies.

### Added

- `bulk-subscribe-contacts-to-topics` and `bulk-unsubscribe-contacts-from-topics`
  tools, covering `POST` and `DELETE /audience/contacts/topics/bulk` over the
  cartesian product of contact IDs × topic IDs (max 1000 × 50). The unsubscribe
  tool carries the same "double-check with the user first" instruction as the
  other bulk-removal tools
- `bulk-create-audience-contacts` accepts a `contacts` array — one row per
  contact, each with its own `properties`, `list_ids` and `topics` — as an
  alternative to the flat `emails` list, plus batch-wide `list_ids`, `topics`
  and `update_existing`. Row values stack on top of the batch-wide ones, except
  that a row-level topic `opt_out` beats a batch-level `opt_in`, which is how a
  topic that auto-subscribes new contacts is suppressed for specific people in
  the same request

### Changed

- `bulk-create-audience-contacts` reports the full result — `updated`,
  `error_count`, per-row `errors` and the returned `contacts` with their ids.
  Two things the tool now states explicitly in its output, because a model
  reading only the counters would get them wrong: skipped rows do **not** fail
  the call (the rest of the batch commits, so a successful response is not proof
  every row landed), and `already_existed` and `updated` overlap by design, so
  they never sum to the number of rows submitted
- `create-audience-contact` documents that a duplicate email now fails with HTTP
  `409` / `resource_already_exists` rather than the misleading `500` /
  `send_error`, that it must not be retried, and what to do instead
- A row of `contacts` no longer has its email address validated before the
  request is sent. The API skips a malformed row and commits the rest of the
  batch, so validating here rejected the whole import over a single bad address
  — the one case the per-row shape exists to handle. The address is now checked
  by the API and comes back as an `invalid_email` entry in `errors`. The flat
  `emails` list is still validated up front, because there the API rejects the
  whole request too

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
