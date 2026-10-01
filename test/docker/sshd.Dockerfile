# SPDX-License-Identifier: MIT
# Test fixture only. Never used by the production image or published to a registry.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
RUN apk add --no-cache openssh-server \
    && adduser -D printer \
    && echo 'printer:synthetic-test-account' | chpasswd \
    && ssh-keygen -A \
    && mkdir -p /fixture-state \
    && chown printer:printer /fixture-state
COPY mac-tool.mjs /fixture/mac-tool.mjs
COPY sshd_config /fixture/sshd_config
RUN chmod 0755 /fixture/mac-tool.mjs \
    && mkdir -p '/Applications/Open Xprinter.app/Contents/MacOS' \
    && ln -s /fixture/mac-tool.mjs '/Applications/Open Xprinter.app/Contents/MacOS/OpenXprinter' \
    && for tool in lpstat lpoptions lp ipptool plutil cancel; do ln -s /fixture/mac-tool.mjs "/usr/bin/$tool"; done
CMD ["/usr/sbin/sshd", "-D", "-e", "-f", "/fixture/sshd_config"]
