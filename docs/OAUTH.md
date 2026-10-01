# OAuth provider contract

HTTP mode implements an MCP **protected resource**. Use an existing OAuth provider; no home-grown login/password endpoint is shipped.

Configure the provider with the public resource identifier, for example `https://printer.example.com/mcp`, and these scopes:

| Scope | Access |
| --- | --- |
| `xprinter.read` | Capabilities, queue state, workflow prompt and the caller's own job status |
| `xprinter.prepare` | Prepare/preview labels and read the caller's own PDF resource |
| `xprinter.print` | Submit the caller's prepared artifact; operator must also enable printing |
| `xprinter.cancel` | Cancel the caller's verifiably matching unfinished MCP job |

Grant only the scopes the person/client needs. Read+prepare is useful without print permission. All clients sharing the same issuer+subject share a principal; client IDs do not create separate user identities. SSH/local stdio instead use the Mac account's trust boundary.

## Required access token

- JWT signed with RS256, ES256 or EdDSA and a key published at the configured HTTPS JWKS endpoint.
- `iss` exactly equals `XPRINTER_OAUTH_ISSUER`.
- `aud` contains the exact canonical `XPRINTER_PUBLIC_URL`, including `/mcp`; no token intended for another API is accepted.
- Nonempty `sub`, plus `iat` and `exp`. Maximum issued lifetime is one hour, with a five-second clock tolerance. Keep host/provider clocks synchronized.
- Space-delimited `scope` string using the scopes above. Unknown scopes confer no access.

Opaque access tokens, ID tokens used as access tokens, unsigned tokens and HS256 tokens are unsupported. Configure your provider to issue JWT **access** tokens for this resource; do not use a generic identity token. The provider must enforce resource/scope grants at issuance. Configure only operator-trusted issuer/JWKS URLs; they cannot be supplied by tool callers. JWKS rotation is cached with bounded fetch timeout/cooldown.

Clients need provider discovery plus Authorization Code with PKCE and a supported registration method (pre-registered client, dynamic registration or client-ID metadata as supported by that provider and client). The server metadata lists your issuer; OAuth clients then use the issuer's discovery to find authorization/token endpoints. Verify the provider publishes valid OAuth authorization-server or OpenID discovery metadata and supports resource/audience selection for this API. Some providers require an explicit audience setting in addition to the resource parameter. Setup is provider-specific; the server does not silently substitute an unbound token.

Use confidential client credentials only when your provider and AI client explicitly support machine-to-machine access for this resource. It still needs a stable subject and appropriate scopes; do not share a privileged service identity among unrelated users. This server does not mint credentials or perform administrative grants.

The protected resource metadata is available at `/.well-known/oauth-protected-resource/mcp` and at the root alias. Missing/invalid credentials receive 401 with `resource_metadata` in the Bearer challenge. An authenticated call lacking the operation's scope receives the official SDK scope challenge before running that operation.

## Verified and operator-dependent parts

Automated tests sign synthetic ES256 access tokens and exercise issuer/audience/expiration/future-issued/lifetime/signature checks, owner isolation and scope challenges over both MCP eras. An actual public OAuth tenant, domain, HTTPS certificate, client registration and end-to-end login must be configured and verified by the operator. No public service is provisioned by installing the archive.

Primary references: [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [MCP security practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728).
