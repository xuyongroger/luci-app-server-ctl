# luci-app-server-ctl

> Server Control —— 局域网服务器的**手动**与**定时**开关机 / 唤醒管理 LuCI 应用。
> 通过 Wake-on-LAN 唤醒、通过 SSH 实现挂起与关机。

[![Build luci-app-server-ctl](https://github.com/xuyongroger/luci-app-server-ctl/actions/workflows/build-luci-app-server-ctl.yml/badge.svg)](https://github.com/xuyongroger/luci-app-server-ctl/actions/workflows/build-luci-app-server-ctl.yml)

适用于 OpenWrt / ImmortalWrt 的 LuCI（Luci-nginx / uhttpd 均可）插件。

---

## 功能特性

- **手动控制**：在网页上选择一台已登记的服务器，一键执行
  - **Ping 测试** —— 检测设备是否在线
  - **SSH 测试** —— 验证 SSH 凭据是否可用
  - **唤醒（Wake）** —— 基于 MAC 地址的 Wake-on-LAN 魔术包
  - **挂起（Suspend）** —— 通过 SSH 远程挂起
  - **关机（Power Off）** —— 通过 SSH 远程关机
  - 挂起 / 关机会先弹出二次确认，避免误操作
- **定时任务**：为某台服务器按 **每天 / 每周 / 单次** 计划在指定时间点执行唤醒、挂起或关机；单次任务执行后自动删除。
- **服务器清单**：集中维护服务器的名称、IP、MAC、SSH 用户名与密码，供手动控制与定时任务复用。
- **总开关**：可一键停用全部定时调度，不影响手动控制。

界面位于 LuCI 菜单 **服务 → Server Control**，分为两个标签页：

1. **Manual/Scheduled Control**（手动 / 定时控制）—— 手动操作面板 + 定时任务列表
2. **Server Maintenance**（服务器维护）—— 服务器清单的增删改查

## 依赖

```
+luci-base +wakeonlan +sshpass +openssh-client
```

- `wakeonlan`：发送 WOL 魔术包（唤醒）
- `sshpass` + `openssh-client`：非交互式 SSH 登录以执行挂起 / 关机
- `luci-base`：LuCI 前端基础库（含 ucode rpcd 支持）

## 配置说明（UCI: /etc/config/serverctl）

总开关：

```sh
config serverctl 'defaults'
    option enabled '1'        # 设为 0 可停用全部定时任务
```

服务器条目（Server Maintenance）：

| 字段 | 说明 | 约束 |
| --- | --- | --- |
| `name` | 服务器名称 | 必填、不可重复 |
| `ip` | IP 地址或主机名 | 必填 |
| `mac` | MAC 地址（WOL 用） | 必填 |
| `user` | SSH 用户名 | 默认 `root` |
| `password` | SSH 密码 | 用于 sshpass 登录 |

定时任务条目（Scheduled Tasks）：

| 字段 | 说明 | 取值 |
| --- | --- | --- |
| `server` | 目标服务器名 | 来自服务器清单 |
| `action` | 动作 | `wake` / `suspend` / `poweroff` |
| `schedule` | 计划类型 | `daily` / `weekly` / `once` |
| `weekday` | 星期（仅 weekly） | 0–6（0=周日） |
| `date` | 日期（仅 once） | `YYYY-MM-DD` |
| `hour` / `minute` | 执行时刻 | 0–23 / 0–59 |
| `enabled` | 是否启用 | 开关 |

> 说明：SSH 密码以明文存于 UCI 配置，请把该设备与管理员访问控制在可信范围内。

## 工作原理

- `rpcd` ucode 后端（`/usr/share/rpcd/ucode/serverctl`）提供 `ping`、`sshtest`（读）与 `wake`、`suspend`、`poweroff`（写）方法，权限由 `/usr/share/rpcd/acl.d` 限定。
- `procd` 服务 `/etc/init.d/serverctl`（`START=95`）常驻运行调度器 `/usr/bin/serverctl-scheduler`，每 3 秒检查一次；每当进入新的分钟时评估到期任务。
- 调度使用系统时区（读取 `/etc/TZ`），`defaults.enabled=0` 时调度器跳过所有任务。

## 安装

### 方式一：下载预编译 ipk（推荐）

本仓库已配置 GitHub Actions 云端编译（见下）。到 **Actions** 运行工作流，从 **Artifacts** 或（勾选 `upload_release` 后的）**Releases** 下载 `luci-app-server-ctl_*.ipk`，然后传到路由器安装：

```sh
scp luci-app-server-ctl_*.ipk root@<路由器IP>:/tmp/
ssh root@<路由器IP> "opkg update && opkg install /tmp/luci-app-server-ctl_*.ipk"
```

### 方式二：源码编译

将本项目放入 `package/`（或某个 feeds 的 `applications/` 目录，以满足 `include ../../luci.mk` 的相对路径），随后：

```sh
make package/luci-app-server-ctl/compile V=s
```

产出的 ipk 位于 `bin/packages/<arch>/packages/`。

## 云端编译（GitHub Actions）

本仓库使用 **ImmortalWrt SDK** 单独编译本插件，无需构建整个固件：

`.github/workflows/build-luci-app-server-ctl.yml`

使用步骤：

1. 打开仓库 **Actions** → **Build luci-app-server-ctl** → **Run workflow**；
2. 可选参数：
   - `iw_version`：SDK 对应的 ImmortalWrt 版本，默认 `24.10.6`（可填 `25.12.2` 等）；
   - `upload_release`：`true` 时创建 Release 并附上 ipk；
   - `ssh`：`true` 时开启 tmate 远程调试；
3. 运行结束后在 **Artifacts** 下载 ipk。

> 首次运行会连带编译 `luci-base` 等构建依赖，耗时约十几分钟到半小时，属正常现象。产出的 ipk 为 `all` 架构，通用于各目标平台。

## 本地预览与测试

无需真实路由器即可在浏览器中预览界面逻辑（基于本地 mock rpcd 后端）：

```sh
# 需要 Node.js 与 playwright
./tests/run-tests.sh
```

- `preview/index.html`：静态预览入口
- `tests/harness/`：mock rpcd/uci 后端 + 最小 LuCI 前端资源

## 目录结构

```
luci-app-server-ctl/
├── Makefile                         # LuCI 包定义
├── htdocs/luci-static/resources/view/serverctl/main.js   # LuCI 前端视图
├── po/zh_Hans/…                     # 简体中文翻译
└── root/
    ├── etc/config/serverctl         # UCI 默认配置
    ├── etc/init.d/serverctl         # procd 服务
    ├── usr/bin/serverctl-scheduler  # ucode 调度器
    └── usr/share/
        ├── luci/menu.d/…            # 菜单注册
        ├── rpcd/acl.d/…             # 权限 ACL
        ├── rpcd/ucode/serverctl     # rpcd ucode 后端
        └── serverctl/core.uc        # 公共逻辑（core）
```

## 许可

Apache-2.0（见 `Makefile` 中的 `PKG_LICENSE`）。
