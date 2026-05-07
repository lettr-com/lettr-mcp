# Changelog

All notable changes to the Lettr MCP project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
