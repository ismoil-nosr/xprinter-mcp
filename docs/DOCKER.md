# Docker quick start

[English](DOCKER.md) · [Русский](DOCKER.ru.md) · [简体中文](DOCKER.zh-CN.md)

Image: **`ghcr.io/ismoil-nosr/xprinter-mcp:0.2.0`** (`linux/amd64` and `linux/arm64`). It includes Node 24, the compiled MCP server, locked production dependencies and OpenSSH. Docker Desktop on Windows/macOS and Docker Engine on Linux can run the same Linux image. Use the version tag or the release's image digest for repeatable deployments; `latest` follows releases.

The MCP server runs **inside Docker**. The printer stays connected by USB to a Mac running **[Open Xprinter 0.3.0+](https://github.com/ismoil-nosr/xprinter-macos/releases/latest)**. Docker uses SSH to invoke that Mac's native renderer and scoped CUPS tools. **Node and the MCP package do not need to be installed on the printer Mac in this mode.** The Mac needs the native app/driver, a configured `XP330B_OpenSource` queue and an awake, reachable SSH account. Direct USB hosting on Linux/Windows remains unimplemented.

Docker Desktop [does not provide direct USB passthrough](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/general/#can-i-pass-through-a-usb-device-to-a-container), and Linux containers cannot run macOS AppKit. No privileged container, Docker socket, USB passthrough, printer sharing or exposed CUPS port is needed. All eight MCP tools, three languages, OAuth scopes, private previews, print budgets and durable retry receipts use the same implementation as native hosting.

## 1. Set up the printer Mac once

1. Install the native app, configure its project queue and check a physical label using the actual loaded dimensions and gap.
2. Enable **System Settings → General → Sharing → Remote Login** for an authorized normal Mac account. Do not use root. Restrict network access to your trusted LAN/VPN; an internet-facing SSH service is not required. [Apple's Remote Login guide](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac).
3. Create a dedicated SSH key on the Docker host, not in the source repository or image:

```sh
mkdir -p secrets
chmod 700 secrets
ssh-keygen -t ed25519 -f secrets/id_ed25519 -N '' -C open-xprinter-docker
```

Authorize **only its public key** (`secrets/id_ed25519.pub`) for that Mac account. Add the `restrict` authorized_keys option to disable forwarding, agent forwarding and PTYs. For example, append `restrict ` followed by the complete public-key line to the account's `~/.ssh/authorized_keys`; keep that directory 0700 and file 0600. This key still permits command execution as that account: use a dedicated account where practical and protect the private key. The MCP protocol never accepts arbitrary command inputs, but a stolen SSH key is outside that boundary.

4. Pin the Mac's host key. On the **printer Mac itself**, read the public host key:

```sh
cat /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Create `secrets/known_hosts` on the Docker host with the verified key. For Docker Desktop running on that same Mac, a line looks like:

```text
host.docker.internal ssh-ed25519 REPLACE_WITH_VERIFIED_PUBLIC_HOST_KEY
```

Use the exact DNS/IP in `XPRINTER_SSH_HOST`; for a nondefault port use `[host]:port` in `known_hosts`. For a remote Mac, verify its fingerprint through a trusted channel. `ssh-keyscan` alone does not establish trust. The server uses strict host checking and never silently accepts or changes a host key. Keys requiring an interactive passphrase are not supported by this unattended key-file mode.

## 2. Download the ready configuration

Download **`xprinter-docker-0.2.0.zip`** and `SHA256SUMS.txt` from [the release](https://github.com/ismoil-nosr/xprinter-mcp/releases/tag/v0.2.0), verify the checksum and extract the ZIP. Alternatively clone this repository; Docker does not require Node/Git after you have the configuration files.

Copy `docker.env.example` to `docker.env`, then set:

- `XPRINTER_SSH_USER`: the authorized Mac account name.
- `XPRINTER_SSH_HOST`: `host.docker.internal` on the same Docker Desktop Mac; otherwise the reachable Mac IP/DNS name. `localhost` inside a container refers to that container, not the Mac.
- `XPRINTER_KEY_FILE` and `XPRINTER_KNOWN_HOSTS_FILE`: paths to your private key and pinned hosts file. Use absolute paths when calling Compose from another folder.
- `XPRINTER_LANGUAGE`: `en`, `ru` or `zh-Hans`.

Keep `XPRINTER_ALLOW_PRINT=0` while checking the connection. Private keys must be 0600 and the key/hosts files must be readable by the image's nonroot user **UID 1000**. Do not make the private key world-readable to solve an ownership error; see troubleshooting below. `docker.env`, `secrets/`, local state and fixtures are excluded from the production build context.

## 3. Check, then connect your AI client

```sh
docker compose --env-file docker.env pull xprinter
docker compose --env-file docker.env run --rm -T xprinter doctor
```

`doctor` reports `backend: "ssh"`, queue status and `rendering: true`; it never requests paper movement. A healthy queue does not prove a connected printer or correct physical stock. Then start stdio:

```sh
docker compose --env-file docker.env run --rm -T xprinter
```

For an AI client use [the Docker JSON template](../examples/docker.json): replace the absolute Docker executable/key/hosts paths and Mac username. Docker itself must be running. Use **`-i`**, without **`-t`**; a TTY corrupts the MCP stream. Stdout is the protocol; diagnostics go to stderr. The outer client configuration differs between AI applications.

After reviewing a preview and stock, set `XPRINTER_ALLOW_PRINT=1` in `docker.env` or the Docker client arguments to allow physical printing. Configure the AI client's own tool approvals too; a boolean supplied by an AI is not human consent. A missing persistent state mount makes printing startup fail before a printer command is dispatched.

The named **`xprinter-mcp-state`** volume stores private artifacts and retry receipts. All containers serving this one printer must share it and the same limits. Keep it across upgrades, restarts and `--rm` runs; do not remove it with `down -v`, volume pruning or an uninstall. One volume is bound to one backend host/port/account; changing those settings requires restoring the original target or deliberately provisioning a separate printer instance, after resolving pending/uncertain jobs. Separate native MCP servers or separate state volumes have independent budgets; run one authoritative deployment for this printer.

## Authenticated HTTP service

For a long-running endpoint set the actual HTTPS resource URL, OAuth issuer and JWKS URL in `docker.env`; follow [the OAuth provider contract](OAUTH.md) and [remote deployment guide](REMOTE.md). Then:

```sh
docker compose --env-file docker.env --profile http up -d xprinter-http
docker compose --env-file docker.env --profile http ps xprinter-http
```

The service listens on `0.0.0.0` **inside the container**. Compose publishes **only `127.0.0.1:8787` on the Docker host**, for an operator-configured HTTPS reverse proxy. OAuth/JWT validation remains mandatory; there is no anonymous HTTP mode. The healthcheck validates that the metadata endpoint responds, not that USB/paper or OAuth login works. Do not publish plaintext port 8787 to the internet. The stdio and HTTP services share the same volume/budget, but HTTP identities remain isolated by verified token subject.

## Ownership troubleshooting

The default image runs as `node` (UID/GID 1000), without root privileges. On Linux, bind-mounted key files owned by another UID may be unreadable. Docker Desktop file sharing also needs permission to access their location. Use a dedicated **credential volume**, populated once by an initialization container, rather than weakening the host key's permissions. The initialization container reads only your two mounted files, copies them and assigns the copies to UID 1000:

```sh
docker volume create xprinter-mcp-ssh
docker run --rm --user 0:0 --cap-drop=ALL --cap-add=CHOWN --cap-add=DAC_OVERRIDE \
  --security-opt=no-new-privileges \
  --mount type=volume,source=xprinter-mcp-ssh,target=/credentials \
  --mount "type=bind,source=$PWD/secrets/id_ed25519,target=/input/key,readonly" \
  --mount "type=bind,source=$PWD/secrets/known_hosts,target=/input/hosts,readonly" \
  --entrypoint sh ghcr.io/ismoil-nosr/xprinter-mcp:0.2.0 -ec \
  'umask 077; chown -R 0:0 /credentials; chmod 700 /credentials; cp /input/key /credentials/id_ed25519; cp /input/hosts /credentials/known_hosts; chmod 600 /credentials/*; chown -R 1000:1000 /credentials'
```

Replace the **two key-file bind mounts** in your Docker run arguments with **one** volume mount: `type=volume,source=xprinter-mcp-ssh,target=/run/secrets,readonly`. In Compose replace those two bind-volume entries with `- type: volume`, `source: ssh`, `target: /run/secrets`, `read_only: true`, and declare `ssh: { external: true, name: xprinter-mcp-ssh }` under top-level `volumes`. The MCP container continues to run as UID 1000; only this scoped initialization runs as root **inside a container**, with no host root or Docker socket access. Stop MCP clients/service before intentionally reinitializing this credential volume when rotating the key/host identity; do not erase the state volume. The container integration test exercises this initialization/rotation path too.

`native_failed`/`configured: false`: check SSH reachability, host key, key authorization, native app version, queue and Mac sleep. `persistent_state_required`: mount the state volume. `backend_changed`: restore that volume's original target. `uncertain`: inspect the Mac queue and paper, then reuse the same print key to inspect the existing receipt; never automatically retry printing under a new key.

## Build and validate in a repository checkout

```sh
docker build -t xprinter-mcp:docker-test .
npm ci --ignore-scripts
npm run test:docker
```

Node is needed only on the developer machine for this test runner. It runs the production image against an isolated SSH fixture with synthetic printer commands, verifies both protocol eras, volume persistence after container recreation, cancellation, lost responses, host-key rejection and OAuth-required HTTP startup. It cannot reach a physical printer. CI tests AMD64 and ARM64 images before publishing the multi-platform release with SBOM and build provenance. Native rendering is separately exercised on real macOS. See [validation](VALIDATION.md).
