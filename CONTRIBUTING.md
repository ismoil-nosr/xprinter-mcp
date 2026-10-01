# Contributing / Участие / 贡献

Issues and pull requests in **English, Russian or Chinese** are welcome; no English translation is required. 中文用户可以直接用中文提交问题、修复和文档。Можно писать на русском.

Read [architecture](docs/ARCHITECTURE.md), [security boundaries](SECURITY.md) and the [validation record](docs/VALIDATION.md). Keep the client-facing MCP API platform-neutral. Hardware backends must declare their actual host/model/transport support and supply hardware evidence before claiming compatibility.

```sh
npm ci --ignore-scripts
npm test
npm pack
```

Use strict schemas, fixed native executables/argument arrays, explicit owner filtering and the official SDK serving/auth APIs. Add behavior tests for a changed authorization, retry, limit or print boundary. Tests must never call the real printer's submit/cancel methods; real native renderer tests consume no paper. Put physical checks in a separate, explicit operator procedure using synthetic label content.

For Docker/SSH changes, build `docker build -t xprinter-mcp:docker-test .` and run `npm run test:docker` in a repository checkout. This exercises the production image through an isolated SSH printer fixture, without access to hardware. Keep fixture code out of production images and release archives. Both AMD64 and ARM64 image tests and the five core/native CI platforms must pass before a release. Pin the supported Node LTS base image by digest, review dependency/base updates and rerun these checks; never pass secrets as build arguments. Publish release images with SBOM/provenance and preserve deployed state volumes across updates.

Translations live in `src/language.ts` for tool titles/descriptions and `docs/README.*.md` for guides. Keep tool names, field identifiers and machine error codes stable. Explain changes to size/feed direction in all three guides. For a new platform implement `PrinterBackend` and `Renderer` interfaces with equivalent validation and retry behavior; do not fork a second MCP API.

Contributions are under MIT. Do not include credentials, customer/order labels, tokens, USB serials, vendor binaries/PPDs or proprietary SDK manuals. Keep production adapters independent of test fakes; fixtures are excluded from the runtime archive. Report security issues through the private route described in [SECURITY.md](SECURITY.md).
