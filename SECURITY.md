# Security boundary

Printing spends physical resources. Only connect trusted AI clients/accounts and grant remote access to identities you authorize to use this printer. Native MCP runs as a normal Mac user; Docker MCP runs as nonroot UID 1000 and invokes the native Mac tools over SSH as an authorized normal Mac account. Neither runtime needs sudo. Queue installation/admin tasks belong to the separate native app and are not MCP tools.

Default stdio startup allows preparation and read-only inspection while print/cancel mutations are disabled. `XPRINTER_ALLOW_PRINT=1` is an operator grant, not a per-label approval. A client's tool policy and explicit user instruction must govern physical printing. The `confirmed: true` input and annotations are accidental-use guards; an AI or authorized client can set that field itself. They do not prove human approval or protect against a malicious authorized client.

## Enforced controls

- One fixed project queue; USB model/driver option checks; no arbitrary queue, shell, path, URL, raw TSPL, firmware, calibration or administrator tools.
- Strict bounded inputs; bounded subprocess time/output; limited rendering concurrency and storage; per-job and shared hourly label budgets.
- Durable reservation before print submission. Reusing a key returns its receipt even after uncertain submission. No automatic reprint after a crash. No exactly-once physical-output guarantee.
- Private local state (0700 directory/0600 database on macOS), owner-filtered artifacts/jobs and expiring prepared data. CUPS job-name/queue/ID verification before cancellation prevents acting on a recycled or foreign spooler job number.
- HTTP defaults to loopback; an explicit Docker listener override uses container networking, with Compose publishing only to host loopback. External TLS and OAuth are required. Tokens are signature/issuer/audience/lifetime validated. Per-operation scopes apply even if the operator enables printing. Client credentials are not passed downstream.
- SSH backend uses operator-selected normal Mac account, dedicated private key and verified known_hosts files, strict host-key checking, no interactive password fallback, no agent forwarding, no TTY, no forwarding or automatic command retry. Fixed macOS executable/argument streams are safely quoted for the remote POSIX shell. SSH target/credentials/executables never come from MCP tool input.
- Docker production context uses an allowlist; no credentials, state, fixture commands or proprietary driver binaries are bundled. Runtime supports read-only root filesystem and dropped capabilities. Printing requires mounted persistent state (not tmpfs), and each state directory is bound to one backend target/account.
- Exact Host/Origin allowlists, CORS without wildcard origins, body/header/time/rate/connection/concurrency limits, protected resource metadata and SDK scope challenges.
- stdout contains only the MCP protocol; stderr omits bearer tokens, label content, PDFs and USB identifiers. Native stderr is not forwarded.

## Limits

The dedicated SSH key grants command execution as its Mac account, independently of MCP's narrower tool surface. `restrict` in authorized_keys removes forwarding/PTY capabilities but is not a forced-command sandbox. Use a dedicated least-privileged Mac account where possible and protect/rotate the key. HTTP users remain separated by verified token subject; stdio clients sharing a container/state account share its local identity. One authoritative state volume serves one printer: separate volumes or native installations have independent budgets.

The local OS account can inspect/control its files, printer queue and MCP process. All local/SSH clients under that account share one identity. A database or token/identity-provider compromise, a deliberate new print key, receipt expiry (30 days) or database loss can permit repeat printing. Separate processes using different state paths have separate budgets. Direct prints from other Mac apps bypass MCP policies.

Open Xprinter 0.3.1+ has its own 25-second renderer deadline in addition to the MCP caller timeout. Native PDF parsing has size/time/pixel limits but no operating-system sandbox in this release. Do not expose the service to arbitrary untrusted people; keep macOS, Node and dependencies updated. Prepared data becomes inaccessible after 15 minutes and is periodically removed; SQLite checkpoints reduce WAL retention but backups, filesystem snapshots and SSD behavior are outside erasure guarantees. CUPS separately controls its spool retention.

TLS termination, OAuth issuance, client registration, network exposure, Mac account permissions and service lifecycle are operator responsibilities. No public endpoint or authentication provider is set up automatically. Windows/Linux direct USB hosting is not implemented. Current HTTP authentication accepts JWT access tokens, not opaque token introspection or a custom authorization server.

## Report a vulnerability

Use this repository's GitHub **Security → Report a vulnerability** if available. Do not publish tokens, credentials, private labels or actionable exploit data in a public issue. If private reporting is unavailable, open a minimal issue asking the maintainer for a private channel without including exploit or personal data. Fixes need a regression test covering the affected boundary.

## Dependency and release maintenance

The runtime image has no global npm/npx/Yarn/Corepack; builder package managers are not available in its running filesystem. Application packages use exact versions and shrinkwrap integrity hashes; installs disable lifecycle scripts. CI audits runtime and development npm dependencies, runs PR dependency review and CodeQL, and scans both image architectures with Trivy. High/critical vulnerability or CodeQL findings and any image secret findings block publication. Scan failures also block the release. Raw secret matches are never logged or uploaded.

Image publication first uploads immutable content by digest, scans AMD64/ARM64 and only then assigns version tags to the scanned manifest. SBOM/provenance describe build inputs; they are not independent publisher signatures. Actions, Node base and scanner image are pinned and maintained by weekly Dependabot PRs; automatic merging is disabled. Weekly scans use fresh vulnerability data for the current released image. A clean result is point-in-time, not a guarantee against future advisories or parser exploits.

The native companion uses Apple's system libraries. Keep macOS and Node patched. Windows filesystem ACL privacy is operator-controlled; POSIX mode checks do not establish equivalent Windows ACL isolation. Use a dedicated protected account/state directory. Only the latest release is maintained.
