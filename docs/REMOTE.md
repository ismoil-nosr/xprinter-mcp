# Remote access

The USB printer stays attached to a Mac. An AI client anywhere can use the same MCP tools; it does not need a USB driver. Keep the Mac awake and reachable, choose the actual loaded stock, and grant access only to people allowed to print on that device.

## SSH: simplest private connection

Use macOS Remote Login only if you choose to enable it, an SSH key, and a restricted account allowed to access the configured CUPS queue. Test a normal SSH login and `xprinter-mcp doctor` before configuring your AI client. This project does not enable Remote Login, modify firewall settings or install a VPN.

The same client configuration works with OpenSSH on Windows, Linux and macOS:

```json
{
  "mcpServers": {
    "xprinter": {
      "command": "ssh",
      "args": [
        "-T", "-o", "BatchMode=yes", "printer-user@printer-mac.local",
        "/usr/bin/env XPRINTER_ALLOW_PRINT=1 XPRINTER_LANGUAGE=en /absolute/path/to/node /absolute/path/to/xprinter-mcp/dist/cli.js stdio"
      ]
    }
  }
}
```

Replace the host/account and both paths with values from your server Mac. For paths with spaces, quote them in the remote command. On Windows, `command` can be the absolute path to `ssh.exe`; no Node installation is needed on the client for this SSH transport. Configure/verify SSH host keys interactively beforehand; never disable host-key checking. The server Mac needs Node. Disable login-banner output on stdout for this command because stdout carries MCP JSON. Other messages belong on stderr.

Omit the print environment flag for preparation/preview only. SSH authenticates a **Mac account**, so all AI clients using that account share its MCP identity and prepared artifacts. Use separate accounts when that boundary matters. SSH/VPN/network permissions remain the operator's responsibility.

## HTTPS: OAuth resource server

HTTP mode requires an external OAuth provider and an HTTPS reverse proxy. It always listens on `127.0.0.1`, with no anonymous HTTP option. No secrets/tokens are put in command arguments.

Example server environment (replace the placeholder URLs with your provider's actual values):

```sh
export XPRINTER_PUBLIC_URL=https://printer.example.com/mcp
export XPRINTER_OAUTH_ISSUER=https://identity.example.com
export XPRINTER_OAUTH_JWKS_URL=https://identity.example.com/jwks
export XPRINTER_PORT=8787
export XPRINTER_ALLOW_PRINT=1
xprinter-mcp http
```

Configure the provider as described in [OAUTH.md](OAUTH.md). The JWT audience must equal the public `/mcp` URL exactly. For a browser-based client, set `XPRINTER_ALLOWED_ORIGINS` to its exact HTTPS origins, comma-separated. Native clients typically send no Origin header. Wildcards, `null` origins and plaintext origins are rejected. Tokens are sent only in `Authorization: Bearer …`, never in a query string.

Terminate TLS in a reverse proxy on the same Mac and forward `/mcp` and `/.well-known/oauth-protected-resource[/mcp]` to port 8787. Preserve method, request body, authorization and `MCP-*` headers, allow streamed responses, keep the original canonical public Host, and set a request body limit of 3 MiB. Do not expose port 8787 itself. The Node listener trusts neither forwarded addresses nor forwarded identity headers.

An example [Caddy configuration](../examples/Caddyfile) uses automatic HTTPS when the configured hostname resolves to the reachable proxy and certificate requirements are met. You must supply the real domain/network arrangement; behind NAT use a suitable private network or operator-managed relay. [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Check discovery and authentication:

```sh
curl https://printer.example.com/.well-known/oauth-protected-resource/mcp
curl -i -X POST https://printer.example.com/mcp \
  -H 'Content-Type: application/json' -d '{}'
```

The second request should return 401 with a `WWW-Authenticate` resource-metadata URL. Then add `https://printer.example.com/mcp` to your client's **Streamable HTTP MCP** settings and complete its OAuth flow. The exact settings and supported OAuth registration vary by client/provider; see their official documentation. For clients with no compatible OAuth support, use SSH rather than publishing an unauthenticated endpoint.

The service is intentionally a **resource server**, not a custom OAuth authorization server. It exposes RFC 9728 protected resource metadata, verifies configured issuer/JWKS and RFC 8707 audience, and issues per-operation scope challenges through the official SDK. It never forwards bearer credentials to CUPS.

## Keeping the service running

Stdio is started/stopped by the AI client. For a long-running HTTP listener, use an operator-owned LaunchAgent under the Mac user's account; [examples/com.ismoilnosr.xprinter-mcp.plist](../examples/com.ismoilnosr.xprinter-mcp.plist) is a template. Replace executable paths, URLs and log paths before loading it. It starts with printing disabled. Do not run it as root. Keep stderr logs private and rotate them; logs omit print content and tokens but still describe service events.

Do not share the state directory across machines or place it on network storage. Multiple local server processes can share it to enforce the same transactional print budget. All processes must use the same configured state path to share those safeguards. Stopping a process during submission can leave an uncertain receipt; inspect paper/CUPS before a new print intent.
