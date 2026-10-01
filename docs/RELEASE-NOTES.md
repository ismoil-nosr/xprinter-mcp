# Open Xprinter MCP 0.2.1

- Remove unused npm/npx/Yarn/Corepack from the production runtime filesystem. The previous image scan found 19 advisories in npm's bundled packages; the rebuilt ARM64 runtime has zero known vulnerability advisories and zero secret findings as of 2026-10-01. Both release architectures are scanned again in CI before promotion.
- Require Open Xprinter 0.3.1+, whose native renderer independently exits after 25 seconds. This bounds remote rendering even if the SSH caller disconnects. The native app also fixes a local CSV import resource-consumption issue.
- Add complete npm dependency audits, PR dependency review, CodeQL for TypeScript/Actions, weekly image scans and Dependabot updates for npm, Docker base/scanner images and Actions. Security tools/actions are pinned; vulnerability databases stay current.
- Block high/critical advisories, any image secret findings and high/critical CodeQL findings. Publish images by digest, scan exact AMD64/ARM64 content, then promote the same manifest to release tags. Retain SBOM/provenance and release checksums/digest.
- Keep print-disabled defaults, OAuth scopes/owner isolation, SSH host checking, durable retry receipts and persistent-state enforcement. All 31 local MCP tests, native rendering, clean archive installation and Docker/SSH recreation tests pass without a physical printer operation.

Docker: `ghcr.io/ismoil-nosr/xprinter-mcp:0.2.1` for Linux AMD64 and ARM64. The printer Mac requires Open Xprinter 0.3.1+ and authorized SSH, but does not need Node/MCP in Docker mode. Windows/Linux direct USB hosting remains unimplemented. See [security policy](../SECURITY.md), [Docker guide](DOCKER.md), [Русский](DOCKER.ru.md) and [简体中文](DOCKER.zh-CN.md).
