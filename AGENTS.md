# 项目约定

## 仓库结构

- `luci-app-server-ctl/`：LuCI 应用包本体（OpenWrt/ImmortalWrt），由 `.github/workflows` 在 ImmortalWrt SDK 中云端编译。
- `tests/run-tests.sh`：ucode/uci 行为测试 + 静态检查，需在 Linux 环境运行。
- `tests/harness/`：浏览器回归用的 mock rpcd/uci 服务（playwright 配套）。
- `preview/`：不依赖真实设备的浏览器预览页（非真实 LuCI 运行时，定位勿混淆）。
- `CODE_REVIEW.md`：代码审查报告；修复问题后须同步其各节「状态」行与文末优先级表。

## 代码风格

- shell 脚本以 POSIX sh 为准（dash 可运行）；ucode 脚本一律 `'use strict'`。
- LuCI 前端遵循 JS 惯例：`E()` 的子节点用数组形式传文本，禁止裸字符串拼接进 innerHTML（防注入）。
- 注释与文档用中文；代码标识符、UCI 选项名保持英文，与既有选项命名风格一致。
- 所有文本文件统一 LF（见 `.gitattributes`），Windows 上开发勿改成 CRLF。

## 测试与验证

- 改动 `main.js` 后至少跑 `node --check`；改动 shell 脚本后跑 `sh -n`。
- 改动 `core.uc` / `serverctl-scheduler` 后，在有 ucode/uci 的 Linux 环境跑 `bash tests/run-tests.sh`。
- 修改调度语义（schedule/weekday/enabled 判定）时必须同步补充测试用例。

## 提交规范

- 提交标题用「模块: 摘要」格式（如 `scheduler: 分钟戳落盘防重复触发`），正文说明动机。
- 一次提交只做一件事；涉及用户可见行为变化时同步更新 README。
