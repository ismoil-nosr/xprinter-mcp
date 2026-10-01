# Validation record

Initial development: October 2026. Tests are evidence for the tested configuration, not proof of every AI client, firmware, roll or identity provider.

## Automated coverage

`npm test` compiles with strict TypeScript and exercises:

- Input schemas, physical stock identifiers, Unicode/ASCII rules, gap settings, geometry and batch limits.
- Preparation without printer mutations, operator print enablement and required scopes.
- Owner isolation for artifacts, printing, job status, cancellation and PDF resources.
- Concurrent idempotent calls, changed-input conflicts, durable reservations across store instances, expiry, uncertain submission and conservative shared budgets.
- Private state permissions on POSIX, bounded storage and repeatable cancellation.
- Official SDK clients over stdio and authenticated HTTP, both 2026-07-28 and 2025 handshake modes; discovery, tools, resources, prompts and scoped errors.
- JWT signature/issuer/audience/expiration/issued-at/lifetime/subject checks; resource metadata and authentication challenges; Host/Origin/CORS/body guards.
- Real native 0.3.0+ renderer: multilingual QR, pages and PDF import; actual packaged CLI over both MCP eras. Printing is disabled for these native integration tests.
- SSH operator configuration rejects root/option/command injection; remote quoting preserves Unicode/metacharacters as data, private key permissions and output/time bounds remain enforced. CUPS PDF and fixed IPP tests use stdin, without shared temporary paths.
- Backend state binding persists across restart and refuses another host/account. Docker printing refuses an unmounted/ephemeral state path.

`npm run test:docker` separately builds an isolated synthetic SSH fixture and runs the **production image**, nonroot with read-only filesystem and dropped capabilities. It checks both MCP eras, discovery/preparation/PDF resources, synthetic CUPS submission and verified cancellation, receipt replay across container recreation, a lost SSH submission response with no repeat dispatch, strict host-key rejection, missing state-volume rejection, backend-target rejection and HTTP metadata/401 challenges. The fixture has no real printer or published SSH port, is excluded from the runtime image, and its UUID-scoped containers/network/volume are removed after the test. CI executes these image tests on native Linux AMD64 and ARM64 before the tag's multi-platform image/SBOM/provenance is published.

CI runs core tests on Windows and Linux plus macOS 14 ARM, macOS 15 Intel and macOS 26 ARM. Mac jobs build the pinned native companion and run renderer integration tests. The workflow's result for a commit is the authority; merely configuring CI is not evidence that it passed. The driver repository separately verifies physical PDF size, preview dots and barcode decoding through the native bridge and the CUPS-to-TSPL pipeline.

The downloadable archive is built only after all CI jobs pass, includes compiled runtime with a dependency shrinkwrap, and is tested after clean installation. Source fixtures, credentials, node_modules and build logs are excluded. SHA-256 checksums accompany releases. No npm registry publication or Apple notarization of the native driver is implied.

## Development Mac observations

Docker 0.2.0 was also connected over SSH to the real development Mac with Open Xprinter 0.3.0 and the existing XP-330B queue. The nonroot/read-only container served both MCP eras, Russian tool titles and a real 58×40 mm Unicode label with a 464×320 PNG/PDF, and verified a previously cancelled CUPS job through the streamed IPP test. MCP printing remained disabled. A separate explicit operator check streamed one PDF through SSH into `lp -H hold`, verified that the job was held, then verified its cancellation; it did not request paper movement. The temporary verification SSH key was removed and the original authorized_keys file preserved.

The real renderer produced a 58×40 mm Chinese QR label at 203 dpi; the native companion decoded its QR and Code 128 previews, verified 464×320 pixels and PDF dimensions, and reimported a two-page PDF. The existing project queue was enabled/idle and accepting jobs. These checks consumed no paper and do not prove a remote printer is physically online.

The native driver baseline was previously physically confirmed on XP-330B USB, Apple Silicon, 58×40 mm gap stock. That confirmation belongs to [xprinter-macos validation](https://github.com/ismoil-nosr/xprinter-macos/blob/main/docs/VALIDATION.md). No additional physical print is claimed for this MCP release. Test printer adapters simulate submission/cancellation; they validate policy and retries, not real spooler timing or paper movement.

A synthetic CUPS job was submitted with `-H hold` on the development Mac, verified as held with its opaque MCP title/queue/job ID, cancelled through the real backend, and then verified as cancelled. This validates local CUPS submission/identity/cancellation without requesting paper movement. `scripts/check-held-job.mjs --held-job` is an explicit operator check and is not part of automatic tests or the runtime archive.

## Requires operator verification

Actual public HTTPS/TLS, OAuth tenant/discovery/client registration/login, remote network access and each AI client's tool approval policy must be configured and tested by the operator. No public endpoint has been provisioned by this repository. Windows/Linux clients are protocol-compatible; direct USB hosting there is not implemented. Keep stock settings accurate, inspect/scan the first physical label, and never infer physical print success from a CUPS receipt alone.

## Security maintenance (0.2.1)

On 2026-10-01, all 31 local MCP tests passed with the native 0.3.1 renderer, including both protocol eras, OAuth/ownership, multilingual metadata, print/cancel scopes, retry/uncertain receipt behavior and persistent budgets. Clean archive installation and real Docker/SSH fixture recreation tests passed. Fixtures never access a physical printer. The rebuilt ARM64 production filesystem returned zero vulnerability advisories and zero secret matches with pinned Trivy 0.75.0. The application's full npm audit, including development dependencies, returned zero advisories. CI additionally scans both exact release architectures before promoting tags. Results reflect the vulnerability databases at scan time, not a permanent security guarantee.
