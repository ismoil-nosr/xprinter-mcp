# Open Xprinter MCP

[![Test and release](https://github.com/ismoil-nosr/xprinter-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/ismoil-nosr/xprinter-mcp/actions/workflows/test.yml)

Let AI clients prepare, preview and print labels on an **Xprinter XP-330B** using the Model Context Protocol. Local clients use **stdio**; remote clients use **SSH** or **OAuth-authenticated HTTPS**. Windows, Linux and macOS clients use the same API. Host MCP on the printer Mac, or **run the ready Docker image anywhere and connect to that Mac over SSH**. The USB driver/native renderer stay on the Mac.

[Downloads](https://github.com/ismoil-nosr/xprinter-mcp/releases/latest) · [Docker quick start](docs/DOCKER.md) · [Русский](docs/README.ru.md) · [简体中文](docs/README.zh-CN.md) · [Remote access](docs/REMOTE.md) · [Security](SECURITY.md) · [Contribute](CONTRIBUTING.md)

## Ready Docker image

**`ghcr.io/ismoil-nosr/xprinter-mcp:0.2.0`** supports Intel/AMD and ARM. Download the release's Docker quick-start ZIP, set the Mac SSH account/key/verified host key in `docker.env`, then:

```sh
docker compose --env-file docker.env pull xprinter
docker compose --env-file docker.env run --rm -T xprinter doctor
docker compose --env-file docker.env run --rm -T xprinter
```

The last command starts MCP stdio; [the client JSON template](examples/docker.json) connects an AI app. Node and MCP dependencies are already in the image: **the printer Mac needs only Open Xprinter 0.3.0+ and SSH**, with its project queue configured. Printing starts disabled. The named state volume preserves retry receipts when containers are recreated; enabling printing without it is refused. An optional Compose HTTP profile retains mandatory OAuth and publishes only to host loopback. [English](docs/DOCKER.md) · [Русский](docs/DOCKER.ru.md) · [简体中文](docs/DOCKER.zh-CN.md).

## Install on the printer Mac

1. Install **[Open Xprinter 0.3.0 or newer](https://github.com/ismoil-nosr/xprinter-macos/releases/latest)**, connect USB, configure the `XP330B_OpenSource` queue and verify one label in the native app. The driver package is currently unsigned by Apple; follow its installation guide. Use the actual label dimensions and gap.
2. Install **[Node.js 24 LTS or newer](https://nodejs.org/en/download)** on the server Mac. The native app/driver themselves do not need Node.
3. Download the `.tgz` and `SHA256SUMS.txt` from this repository's release, verify the archive with `shasum -a 256`, then install the local archive:

```sh
npm install --global ./ismoil-nosr-xprinter-mcp-0.2.0.tgz
xprinter-mcp doctor
```

`doctor` checks the native renderer and printer queue without moving paper. Queue readiness does not prove that the physical USB device is connected. The runtime archive includes compiled JavaScript and a dependency shrinkwrap; npm fetches the pinned dependencies. No npm registry publication is required; the release archive is the distribution. Do not use `npx @ismoil-nosr/xprinter-mcp` until the package is actually published to npm.

For development:

```sh
git clone https://github.com/ismoil-nosr/xprinter-mcp.git
cd xprinter-mcp
npm ci --ignore-scripts
npm run build
node dist/cli.js doctor
```

## Connect locally

Use your MCP client's server configuration (the outer configuration shape varies by client):

```json
{
  "mcpServers": {
    "xprinter": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/xprinter-mcp/dist/cli.js", "stdio"],
      "env": {
        "XPRINTER_ALLOW_PRINT": "1",
        "XPRINTER_LANGUAGE": "en"
      }
    }
  }
}
```

Find the Node executable with `command -v node`; use absolute paths so GUI clients do not depend on shell startup files. With a global installation you can instead use the absolute path returned by `command -v xprinter-mcp` as `command`, with `args: ["stdio"]`, provided the GUI client's PATH also includes Node. Examples in [examples](examples) include stdio and SSH.

**Physical printing is disabled by default.** Omit `XPRINTER_ALLOW_PRINT=1` for preparation/preview only. Enabling it grants the MCP client the ability to spend paper; choose trusted clients and configure their own tool approval policy. `confirmed: true` and tool annotations help avoid accidents but are not an independent human approval mechanism. Read [the security boundary](SECURITY.md).

Tool titles/descriptions support `XPRINTER_LANGUAGE=en`, `ru` or `zh-Hans`. Tool names, JSON fields, dimensions and machine errors stay stable. Labels can contain Chinese/Russian text; Code 128 needs printable ASCII, while QR supports Unicode.

`xprinter-mcp config` prints client JSON with the actual absolute Node/module paths. It starts with printing disabled unless you explicitly set `XPRINTER_ALLOW_PRINT=1` when generating it. Copy that configuration into your client's MCP settings.

## Printing workflow

1. Read `printer_capabilities` and `printer_status`.
2. Confirm the stock actually loaded: width **across the roll**, height **along feed**, gap/mark height and stock type. The initial profile is 58×40 mm, 2 mm gap, darkness 7.
3. Call `prepare_labels` or `prepare_pdf`. It returns an expiring artifact ID, physical settings, page count and **a PNG of page 1 only**. Preparation does not move paper.
4. Review the preview and batch contents; obtain the user's explicit print instruction. Send `print_labels` with `confirmed: true` and a new UUID `idempotencyKey` for this intended print.
5. On a network retry, reuse exactly that UUID and the same artifact/copies. Read `job_status`. An **uncertain** receipt requires inspection of the Mac queue and paper; never automatically submit another key.

Example preparation:

```json
{
  "profile": {"widthMm": 58, "heightMm": 40, "stock": "gap", "gapMm": 2, "darkness": 7},
  "labels": [{"kind": "qr", "title": "商品 · Товар", "code": "TEST-123", "footer": "¥25", "quantity": 1}]
}
```

`quantity` expands each record into pages; `copies` repeats the resulting document. The limit applies to **pages × copies**. Supported input is Code 128, QR, text or a base64 PDF; arbitrary paths, URLs, raw printer commands and shell commands are never tool inputs. PDF fitting preserves aspect ratio and does not split A4 sheets containing multiple labels.

| Tool | Effect |
| --- | --- |
| `printer_status`, `printer_capabilities` | Read scoped queue state/settings |
| `prepare_labels`, `prepare_pdf` | Create private, expiring PDF and first-page preview |
| `preview_label` | Retrieve your own prepared artifact |
| `print_labels` | Submit physical printing with a durable retry receipt |
| `job_status` | Read your own MCP job |
| `cancel_job` | Cancel your own unfinished job after verifying its identity in CUPS |

Resources expose capabilities and `xprinter://labels/{artifactId}` PDFs for the authenticated owner. The `label_printing_workflow` prompt explains the preparation/confirmation flow. CUPS “completed” does not verify label alignment, paper movement or scanner readability. Cancellation cannot undo paper already printed.

## Remote clients and platform support

Windows and Linux clients do **not** need a macOS driver or a different MCP API. They connect to a native server Mac via SSH/HTTPS, or run the MCP server in Docker using the SSH printer backend. The printer Mac needs the native driver and renderer; only native MCP hosting also needs Node there. Direct USB hosting on Windows/Linux is **not implemented** in this release; the backend interfaces are separate from the MCP core so such backends can be added with their own validation. See [architecture](docs/ARCHITECTURE.md).

Start with SSH using key authentication; it needs no public HTTP service or OAuth provider. Native HTTP mode defaults to `127.0.0.1`; the Docker Compose HTTP profile listens inside the container and publishes only to host loopback. Both require an operator-configured HTTPS reverse proxy plus an OAuth provider issuing audience-bound JWT access tokens. There is no anonymous HTTP mode. [REMOTE.md](docs/REMOTE.md) covers setup and [OAuth configuration](docs/OAUTH.md) covers the provider contract.

The official TypeScript SDK v2 serving APIs support **MCP 2026-07-28** plus the **2025 compatibility handshake** on the same stdio/Streamable HTTP endpoints. Legacy HTTP+SSE transport is not provided. [Official SDK migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md).

## Configuration and limits

| Environment variable | Default / purpose |
| --- | --- |
| `XPRINTER_ALLOW_PRINT` | `0`; `1` enables print/cancel, still subject to scopes and budgets |
| `XPRINTER_LANGUAGE` | `en`; `ru`, `zh-Hans` |
| `XPRINTER_MAX_LABELS_PER_JOB` | `100`; operator may lower it, maximum 100 |
| `XPRINTER_MAX_LABELS_PER_HOUR` | `500` across identities/processes sharing the state directory; maximum 1000 |
| `XPRINTER_STATE_DIR` | `~/Library/Application Support/Open Xprinter/MCP`; local private storage |
| `XPRINTER_RENDERER` | Installed app executable; trusted operator override for development |
| `XPRINTER_BACKEND` | `local`; `ssh` invokes Mac printer tools remotely; Docker defaults to `ssh` |
| `XPRINTER_SSH_HOST`, `XPRINTER_SSH_USER` | Required for SSH backend; authorized normal Mac account |
| `XPRINTER_SSH_PORT` | `22` |
| `XPRINTER_SSH_KEY`, `XPRINTER_SSH_KNOWN_HOSTS` | Private key and verified host-key files; Docker mounts them read-only under `/run/secrets` |
| `XPRINTER_LISTEN_HOST` | `127.0.0.1`; Docker HTTP Compose sets `0.0.0.0` internally, keeps host publication on loopback |
| HTTP variables | See [REMOTE.md](docs/REMOTE.md) |

MCP limits: width 20–76 mm, feed height 10–200 mm, 50 records/100 pages, PDF input 2 MiB/100 pages, rendered PDF 6 MiB, 40 million batch pixels, 2 concurrent renders. Prepared data expires after 15 minutes, with a 64 MiB/128-artifact shared storage quota. Receipts remain 30 days; even uncertain/cancelled jobs count conservatively toward the hourly paper budget. Retrying a receipt after 30 days is outside the deduplication window. State is local SQLite through Node's built-in API; Node 24 may emit an experimental SQLite warning on **stderr**, which does not affect MCP stdout.

Keep the server Mac awake, its USB connection available and label stock unchanged while accepting remote jobs. Other native apps share the physical queue and are outside MCP authorization/budgets. The project currently addresses one configured XP-330B queue per Mac.

Use one authoritative deployment/state volume per printer. Different native/Docker installations with different state paths have separate budgets. A state directory is bound to its backend target; preserving receipts across a container upgrade is required, and changing the target silently is refused.

## Test, package and uninstall

```sh
npm ci --ignore-scripts
npm test
npm pack
```

Core tests run on Linux, Windows and macOS with synthetic printer adapters. Real native integration tests require a built/installed 0.3.0+ app and `XPRINTER_RENDERER` set to its executable. They consume no paper. CI also validates real rendering on macOS 14 ARM, macOS 15 Intel and macOS 26 ARM. See [validation and its limits](docs/VALIDATION.md).

To remove a global install: stop its MCP clients/service, run `npm uninstall --global @ismoil-nosr/xprinter-mcp`, and remove its client configuration. The native app/driver and private state are retained. If you choose to erase the state directory after stopping **all** server processes, you also erase retry receipts; inspect pending/uncertain jobs first. Never keep a state database on a network filesystem or share one HTTP service through untrusted local accounts.

[MIT](LICENSE), copyright Ismoil Nosr. Independent of Xprinter; no vendor binaries, PPDs or SDK source are bundled.
