# Docker 快速开始

[English](DOCKER.md) · [Русский](DOCKER.ru.md) · **简体中文**

官方镜像 **`ghcr.io/ismoil-nosr/xprinter-mcp:0.2.1`** 支持 Intel/AMD（`linux/amd64`）和 ARM（`linux/arm64`），内含 Node 24、编译后的 MCP 服务器、锁定的生产依赖及 OpenSSH。在 macOS/Windows 的 Docker Desktop 或 Linux 的 Docker Engine 中使用同一 Linux 镜像。固定版本或使用发行版中的镜像 digest 可重复部署；`latest` 随发行版更新。

MCP 服务器运行在**容器内**。打印机通过 USB 连接到安装了 [Open Xprinter 0.3.1+](https://github.com/ismoil-nosr/xprinter-macos/releases/latest) 的 Mac，并配置 `XP330B_OpenSource` 队列。容器通过 SSH 调用 Mac 的原生标签渲染器及 CUPS 工具。**这种模式不需要在打印机 Mac 上安装 Node 或 MCP 软件包。** Mac 需要已授权的普通 SSH 账户、可达的网络和保持唤醒。当前不支持在 Linux/Windows 上直接托管 USB 打印机。

Docker Desktop [不提供直接 USB 透传](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/general/#can-i-pass-through-a-usb-device-to-a-container)，Linux 容器也不能运行 macOS AppKit。无需特权容器、Docker socket、CUPS 共享或公开打印机端口。八个 MCP 工具、三种语言、OAuth 权限、私有预览、打印额度及持久重试回执均使用相同实现。

## 一次性配置打印机 Mac

1. 安装原生应用/驱动，配置专用队列，并用实际标签尺寸和间隙验证一张实体标签。
2. 在 **系统设置 → 通用 → 共享 → 远程登录** 中允许指定的普通 Mac 账户访问。使用可信局域网/VPN；无需将 SSH 暴露到互联网。请勿使用 root。[Apple 远程登录指南](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)。
3. 在运行 Docker 的电脑上创建专用密钥：

```sh
mkdir -p secrets
chmod 700 secrets
ssh-keygen -t ed25519 -f secrets/id_ed25519 -N '' -C open-xprinter-docker
```

将**公钥** `secrets/id_ed25519.pub` 添加至 Mac 账户的 `~/.ssh/authorized_keys`。在公钥行前添加 `restrict `，禁用转发、代理转发和 TTY；`.ssh` 目录权限为 0700，`authorized_keys` 为 0600。该密钥仍允许以该账户执行命令；请保护私钥，并尽可能使用专用账户。MCP 不接受任意命令输入，但被盗的 SSH 密钥不受此边界保护。

在**打印机 Mac 本机**读取 SSH 主机公钥及指纹：

```sh
cat /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

在 Docker 电脑上创建 `secrets/known_hosts`，写入已验证的主机密钥。Docker Desktop 运行于同一 Mac 时：

```text
host.docker.internal ssh-ed25519 REPLACE_WITH_VERIFIED_PUBLIC_HOST_KEY
```

使用与 `XPRINTER_SSH_HOST` 相同的主机名/IP；非默认端口使用 `[host]:port`。远程 Mac 的指纹应通过可信渠道核对，单独使用 `ssh-keyscan` 不能建立信任。服务严格校验主机密钥，不会自动接受新密钥或更改。此无人值守密钥文件模式不支持交互输入私钥口令。

## 下载、检查并连接 AI

从[发行版](https://github.com/ismoil-nosr/xprinter-mcp/releases/tag/v0.2.1)下载 `xprinter-docker-0.2.1.zip` 和 `SHA256SUMS.txt`，校验 SHA-256 后解压；也可以克隆仓库。将 `docker.env.example` 复制为 `docker.env`，填写 Mac 用户名、地址和两个 SSH 文件路径，并设置 `XPRINTER_LANGUAGE=zh-Hans`。

同一 Mac 的 Docker Desktop 使用 `host.docker.internal`；其他电脑使用可达的 Mac IP/DNS。容器中的 `localhost` 指向容器自身。私钥权限必须为 0600，两份文件必须可由容器的 UID 1000 读取；不要将私钥改成全局可读。所有者不匹配时，请使用[独立凭据卷及初始化命令](DOCKER.md#ownership-troubleshooting)。

```sh
docker compose --env-file docker.env pull xprinter
docker compose --env-file docker.env run --rm -T xprinter doctor
```

检查应显示 `backend: "ssh"`、队列已配置及 `rendering: true`。该命令不会请求走纸；队列状态不能证明 USB 已连接或纸张正确。启动 stdio：

```sh
docker compose --env-file docker.env run --rm -T xprinter
```

AI 客户端可使用[Docker JSON 模板](../examples/docker.json)，替换 Docker/SSH 文件的绝对路径及 Mac 用户名。Docker 必须运行。使用 `-i`，**不要使用 `-t`**，因为 TTY 会损坏 MCP 数据流。外层配置格式由 AI 应用决定。

默认 `XPRINTER_ALLOW_PRINT=0`。确认预览和纸卷后改为 `1`，并设置 AI 客户端自身的工具审批。AI 提交的布尔字段不能证明人类同意。未挂载持久回执卷时，服务拒绝启动打印。

## 保留回执与额度

同一打印机的所有容器必须共享命名卷 **`xprinter-mcp-state`** 和相同额度。该卷保存私有标签及重试回执，经过 `--rm`、升级或容器重建后仍保留。不要用 `down -v`、卷清理或卸载删除它，否则会失去重复打印保护。

卷绑定一个 SSH 主机/端口/账户。遇到 `backend_changed` 时恢复原配置；创建其他部署之前先检查未完成或结果不确定的任务。Mac 上单独运行的 MCP 或其他状态卷拥有独立额度，因此请为每台打印机使用一个主部署。其他 Mac 应用不受 MCP 额度约束。收到 `uncertain` 时检查队列及纸张，复用同一请求密钥获取现有回执，切勿自动使用新 UUID 重新打印。

## 持续运行的 HTTPS 服务

按照 [OAuth 合约](OAUTH.md)和[远程部署指南](REMOTE.md)，在 `docker.env` 配置实际 HTTPS 资源地址、OAuth issuer 和 JWKS URL：

```sh
docker compose --env-file docker.env --profile http up -d xprinter-http
docker compose --env-file docker.env --profile http ps xprinter-http
```

容器内部监听 `0.0.0.0`，Compose 在 Docker 主机上仅发布 **`127.0.0.1:8787`**，供已配置的 HTTPS 反向代理使用。OAuth 始终必需，没有匿名 MCP HTTP 模式。健康检查只验证元数据可达，不能验证 USB、纸张或 OAuth 登录。不要向互联网开放明文端口。已验证的 OAuth 用户保持独立身份和私有数据。

## 在仓库克隆中开发与验证

```sh
docker build -t xprinter-mcp:docker-test .
npm ci --ignore-scripts
npm run test:docker
```

只有开发电脑上的测试客户端需要 Node。测试使用实际容器和隔离 SSH 合成打印机，验证两个 MCP 协议模式、容器重建后的回执、取消、响应丢失、主机密钥拒绝及强制 OAuth。测试无法访问实体打印机。CI 在发布带有 SBOM 和构建来源证明的多平台镜像之前测试 AMD64/ARM64；原生渲染器另在真实 macOS 上验证。[验证范围](VALIDATION.md)。欢迎中文贡献！
