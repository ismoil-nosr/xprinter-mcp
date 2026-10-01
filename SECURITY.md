# Security boundary

Printing spends physical resources. Only connect trusted AI clients/accounts and grant remote access to identities you authorize to use this printer. The application runs as a normal Mac user; it does not need sudo. Queue installation/admin tasks belong to the separate native app and are not MCP tools.

Default stdio startup allows preparation and read-only inspection while print/cancel mutations are disabled. `XPRINTER_ALLOW_PRINT=1` is an operator grant, not a per-label approval. A client's tool policy and explicit user instruction must govern physical printing. The `confirmed: true` input and annotations are accidental-use guards; an AI or authorized client can set that field itself. They do not prove human approval or protect against a malicious authorized client.

## Enforced controls

- One fixed project queue; USB model/driver option checks; no arbitrary queue, shell, path, URL, raw TSPL, firmware, calibration or administrator tools.
- Strict bounded inputs; bounded subprocess time/output; limited rendering concurrency and storage; per-job and shared hourly label budgets.
- Durable reservation before print submission. Reusing a key returns its receipt even after uncertain submission. No automatic reprint after a crash. No exactly-once physical-output guarantee.
- Private local state (0700 directory/0600 database on macOS), owner-filtered artifacts/jobs and expiring prepared data. CUPS job-name/queue/ID verification before cancellation prevents acting on a recycled or foreign spooler job number.
- HTTP binds to loopback only; external TLS and OAuth are required. Tokens are signature/issuer/audience/lifetime validated. Per-operation scopes apply even if the operator enables printing. Credentials are not passed downstream.
- Exact Host/Origin allowlists, CORS without wildcard origins, body/header/time/rate/connection/concurrency limits, protected resource metadata and SDK scope challenges.
- stdout contains only the MCP protocol; stderr omits bearer tokens, label content, PDFs and USB identifiers. Native stderr is not forwarded.

## Limits

The local OS account can inspect/control its files, printer queue and MCP process. All local/SSH clients under that account share one identity. A database or token/identity-provider compromise, a deliberate new print key, receipt expiry (30 days) or database loss can permit repeat printing. Separate processes using different state paths have separate budgets. Direct prints from other Mac apps bypass MCP policies.

Native PDF parsing has size/time/pixel limits but no operating-system sandbox in this release. Do not expose the service to arbitrary untrusted people; keep macOS, Node and dependencies updated. Prepared data becomes inaccessible after 15 minutes and is periodically removed; SQLite checkpoints reduce WAL retention but backups, filesystem snapshots and SSD behavior are outside erasure guarantees. CUPS separately controls its spool retention.

TLS termination, OAuth issuance, client registration, network exposure, Mac account permissions and service lifecycle are operator responsibilities. No public endpoint or authentication provider is set up automatically. Windows/Linux direct USB hosting is not implemented. Current HTTP authentication accepts JWT access tokens, not opaque token introspection or a custom authorization server.

## Report a vulnerability

Use this repository's GitHub **Security → Report a vulnerability** if available. Do not publish tokens, credentials, private labels or actionable exploit data in a public issue. If private reporting is unavailable, open a minimal issue asking the maintainer for a private channel without including exploit or personal data. Fixes need a regression test covering the affected boundary.
