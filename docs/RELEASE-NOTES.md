Open Xprinter MCP 0.1.0 provides AI access to the XP-330B through local stdio, remote SSH and OAuth-authenticated HTTPS.

- Separate open-source MCP repository, with platform-neutral API and independently versioned macOS printer backend. Windows, Linux and Mac clients connect to the Mac hosting the USB printer. Direct USB hosting on Windows/Linux is not implemented.
- Prepare Code 128, Unicode QR, text or PDF labels; inspect first-page previews; submit physical prints; inspect/cancel only the caller's own jobs.
- Official TypeScript SDK v2 serving APIs: MCP 2026-07-28 plus 2025 client compatibility over stdio and Streamable HTTP.
- Printing disabled by default; scoped authorization, per-job/shared hourly budgets, private expiring artifacts and durable idempotency receipts. An uncertain submission is never automatically replayed.
- HTTPS resource-server mode requires operator-provided TLS/domain/OAuth JWT configuration; it binds only to loopback. No public endpoint or authentication provider is provisioned automatically.
- English, Russian and Simplified Chinese tool descriptions and usage/contribution guides. Compiled runtime archive, dependency shrinkwrap, checksums and CI for Windows/Linux and ARM/Intel Macs.

Requires **Node 24+** and **[Open Xprinter 0.3.0+](https://github.com/ismoil-nosr/xprinter-macos/releases/latest)** on the server Mac. The native driver package is unsigned by Apple. [Install and connect](https://github.com/ismoil-nosr/xprinter-mcp#install-on-the-printer-mac).

Русский: отдельный MCP-сервер для AI, локально и удалённо. Windows/Linux-клиенты используют тот же API; USB-бэкенд работает на Mac. Печать разрешается владельцем явно; повторы защищены квитанциями. [Инструкция](https://github.com/ismoil-nosr/xprinter-mcp/blob/main/docs/README.ru.md).

简体中文：独立 MCP 服务器支持本地和远程 AI 客户端。Windows/Linux 客户端使用相同 API，USB 后端运行在 Mac 上。默认禁止打印，并通过权限及持久回执限制误操作与重复请求。欢迎中文贡献。[中文指南](https://github.com/ismoil-nosr/xprinter-mcp/blob/main/docs/README.zh-CN.md)。

Tests consume no paper; a development-Mac held CUPS job was created, identity-verified and cancelled without requesting paper movement. Physical label alignment comes from the previously confirmed native driver baseline. Actual public OAuth login, network exposure and physical printer/stock variants need operator verification. [Validation](https://github.com/ismoil-nosr/xprinter-mcp/blob/main/docs/VALIDATION.md) · [Security boundary](https://github.com/ismoil-nosr/xprinter-mcp/blob/main/SECURITY.md).
