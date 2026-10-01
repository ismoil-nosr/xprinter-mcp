# Open Xprinter MCP

[English](../README.md) · [Русский](README.ru.md) · **简体中文**

让 AI 通过 MCP 为 **Xprinter 芯烨 XP-330B** 准备标签、查看预览、打印并查询自己的任务。Windows、Linux 和 macOS 客户端使用相同 API。MCP 可在 Mac 上运行，或**使用现成 Docker 镜像，通过 SSH 连接打印机 Mac**。USB 驱动和原生渲染器仍运行在 Mac 上；本版本尚未实现 Windows/Linux 直接 USB 主机支持。

## Docker 快速开始

镜像 **`ghcr.io/ismoil-nosr/xprinter-mcp:0.2.1`** 内含 Node 和全部 MCP 依赖，支持 Intel/AMD 及 ARM。打印机 Mac 只需要 Open Xprinter 0.3.1+ 与 SSH，**无需安装 Node/MCP**。下载发行版中的 Docker ZIP，填写 `docker.env` 的 Mac 账户、专用 SSH 密钥和已验证主机密钥：

```sh
docker compose --env-file docker.env pull xprinter
docker compose --env-file docker.env run --rm -T xprinter doctor
docker compose --env-file docker.env run --rm -T xprinter
```

最后一条命令启动 MCP stdio。[中文 Docker 指南](DOCKER.zh-CN.md)及 [AI 客户端 JSON](../examples/docker.json)。默认禁止打印；持久卷在重建容器后保留重试回执。可选 HTTP Compose 配置强制 OAuth，且仅发布到 Docker 主机回环地址。

## 在打印机所在的 Mac 上安装

1. 安装 [Open Xprinter 0.3.1 或更高版本](https://github.com/ismoil-nosr/xprinter-macos/releases/latest)，配置 `XP330B_OpenSource` 队列，并在原生应用中确认一张标签正确打印。驱动安装包暂未获得 Apple 签名，请按其安装指南批准。
2. 安装 [Node.js 24 LTS 或更高版本](https://nodejs.org/en/download)。普通驱动和原生应用本身不需要 Node。
3. 从 [MCP Releases](https://github.com/ismoil-nosr/xprinter-mcp/releases/latest) 下载 `.tgz` 和 `SHA256SUMS.txt`，验证 SHA-256 后运行：

```sh
npm install --global ./ismoil-nosr-xprinter-mcp-0.2.1.tgz
xprinter-mcp doctor
```

`doctor` 检查队列和原生生成器，不会走纸。队列就绪并不能证明 USB 硬件实际已连接。npm 从网络下载归档中锁定的依赖；当前通过 GitHub Releases 分发，并未发布到 npm registry。

## 本地连接

在 AI 客户端的 MCP 设置中使用 Node 和服务器的绝对路径：

```json
{
  "mcpServers": {
    "xprinter": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/xprinter-mcp/dist/cli.js", "stdio"],
      "env": {"XPRINTER_LANGUAGE": "zh-Hans", "XPRINTER_ALLOW_PRINT": "1"}
    }
  }
}
```

用 `command -v node` 查找 Node 路径。外层设置格式因客户端而异。全局安装后也可使用 `command -v xprinter-mcp` 返回的绝对路径，参数为 `stdio`，但 AI 客户端的 PATH 还必须包含 Node。[配置示例](../examples)。

**默认禁止实际打印。** 设置 `XPRINTER_ALLOW_PRINT=1` 才允许消耗纸张；仅授权可信客户端，并配置客户端自身的工具批准策略。`confirmed: true` 是防误操作字段，不能独立证明用户批准。不启用打印仍可准备标签并查看预览。

运行 `xprinter-mcp config` 可生成包含实际绝对路径的客户端 JSON，默认关闭打印。将其复制到 AI 客户端设置，按需明确启用打印。

## 推荐工作流程

1. 读取 `printer_capabilities` 和 `printer_status`。
2. 确认实际纸卷：宽度为打印头横向尺寸，高度为进纸方向尺寸，间隙单独测量。默认 58×40 毫米、2 毫米间隙、浓度 7。
3. 使用 `prepare_labels` 生成 Code 128、二维码或文本，或使用 `prepare_pdf` 输入 base64 PDF。返回标签 ID、页数和**仅第一页**的 PNG 预览，不会走纸。
4. 用户检查预览、批次内容并明确要求打印后，调用 `print_labels`，传入 `confirmed: true` 和本次打印意图的新 UUID `idempotencyKey`。
5. 网络重试必须沿用同一 UUID、标签 ID 和份数。如果结果是 `uncertain`，人工检查 Mac 队列和实物标签；绝不能自动换新键重印。

每条记录的 `quantity` 展开为页面，`copies` 重复整个文档。默认上限为每任务 100 张、每小时共享预算 500 张。取消或结果不确定的任务仍保守计入预算。

`preview_label` 查看自己的准备对象；`job_status` 查询自己的任务；`cancel_job` 核验 CUPS 任务身份后仅取消自己的未完成任务。已打印的纸无法撤销。CUPS“完成”并不代表标签对齐或条码可扫描。

## Windows/Linux 与远程访问

远程 AI 客户端不需要 macOS 驱动。推荐通过 SSH 密钥访问服务器 Mac，参见 [ssh.json](../examples/ssh.json)。客户端只需要 SSH；Node、驱动和队列位于服务器 Mac。同一 SSH/Mac 账户下的客户端共享本地身份。

公开 HTTPS 需要域名、TLS 反向代理和外部 OAuth 提供商。原生服务默认监听 `127.0.0.1`；Docker HTTP 配置仅发布到主机回环地址，没有匿名模式。[远程配置指南](REMOTE.md)及 [OAuth 要求](OAUTH.md)。访问令牌必须是签名的 JWT access token，包含正确的 issuer、audience、subject、时间和权限范围：`xprinter.read`、`xprinter.prepare`、`xprinter.print`、`xprinter.cancel`。令牌不会转交给打印系统。

通过官方 SDK v2 支持 MCP 2026-07-28 和 2025 客户端兼容模式；不提供旧的独立 HTTP+SSE 传输。工具名称和 JSON 字段保持稳定；标题和描述支持英文、俄文、简体中文。Code 128 只接受可打印 ASCII，二维码支持中文等 Unicode 内容。

## 数据与限制

PDF/PNG 仅所属身份可访问，准备对象 15 分钟后过期。共享存储上限为 64 MiB/128 个对象，打印回执保留 30 天。删除数据库会同时删除重试防重复记录，操作前请检查未完成及不确定的任务。使用 Node 内置 SQLite；Node 24 在 stderr 上的实验性警告不会破坏 MCP stdout 协议。

MCP 支持横向宽度 20–76 毫米、进纸高度 10–200 毫米，每批最多 50 条记录/100 页；PDF 输入最多 2 MiB/100 页，输出最多 6 MiB。预览只显示第一页。任意文件路径、网址、shell、原始 TSPL、固件、校准和管理操作都不是工具输入。PDF 解析有大小和时间限制，但本版本没有单独的操作系统沙箱；请限制为可信用户。

## 开发、测试与贡献

```sh
git clone https://github.com/ismoil-nosr/xprinter-mcp.git
cd xprinter-mcp
npm ci --ignore-scripts
npm test
npm pack
```

在 Mac 上设置 `XPRINTER_RENDERER` 为 Open Xprinter 0.3.1+ 内的 executable 绝对路径，可运行真实生成器集成测试。这些测试不打印纸张。CI 在 Windows/Linux/macOS 上检查协议核心，在 ARM/Intel Mac 上检查原生生成器。[验证范围](VALIDATION.md)。

欢迎中文 Issue、Pull Request、文档及翻译改进。请阅读[贡献指南](../CONTRIBUTING.md)和[架构](ARCHITECTURE.md)。不得提交没有再分发许可的厂商驱动、PPD、SDK 或客户标签。

卸载时先停止客户端/服务，运行 `npm uninstall --global @ismoil-nosr/xprinter-mcp`，并移除客户端 MCP 配置。原生驱动和私有状态会保留。不要在网络文件系统上存放数据库。其他 Mac 应用的直接打印不受 MCP 预算限制。

仓库独立发布：[xprinter-macos](https://github.com/ismoil-nosr/xprinter-macos) 负责原生驱动、应用和生成器；本仓库负责 MCP、授权、任务记录和客户端文档。未来可添加 Windows/Linux USB 后端而无需更改客户端 API。MIT 许可证；独立于 Xprinter/芯烨。

## 安全更新

0.2.1 从镜像运行时文件系统移除不需要的 npm/npx/Yarn/Corepack，并要求具有独立 25 秒渲染期限的 Open Xprinter 0.3.1+。CI 执行 npm 依赖审计、CodeQL、PR 依赖审查及两种架构的 Docker 扫描；已知高危/严重漏洞或任何镜像密钥匹配会阻止发布。Dependabot 与每周扫描用于跟踪新风险。扫描结果仅反映检查时的数据；请更新 macOS/Node 并保护 SSH 密钥。[安全策略与私密报告](../SECURITY.md)。
