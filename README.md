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
  - **挂起（Suspend）** —— 通过 SSH 远程挂起（支持 Linux 与 Windows）
  - **关机（Power Off）** —— 通过 SSH 远程关机（支持 Linux 与 Windows）
  - 挂起 / 关机会先弹出二次确认，避免误操作
- **定时任务**：为某台服务器按 **每天 / 每周 / 单次** 计划在指定时间点执行唤醒、挂起或关机；单次任务执行后自动删除。
- **服务器清单**：集中维护服务器的名称、IP、MAC、SSH 用户名与密码、系统类型，供手动控制与定时任务复用。
- **总开关**：可一键停用全部定时调度，不影响手动控制。

界面位于 LuCI 菜单 **服务 → Server Control**，分为两个标签页：

1. **Manual/Scheduled Control**（手动 / 定时控制）—— 手动操作面板 + 定时任务列表
2. **Server Maintenance**（服务器维护）—— 服务器清单的增删改查

## 依赖

```
+luci-base +rpcd-mod-ucode +etherwake +sshpass +openssh-client
```

- `etherwake`：以二层以太网帧发送 WOL 魔术包（唤醒）。相比 `wakeonlan`（perl 脚本，会拉入整套 perl），`etherwake` 仅依赖 `libc`，更轻量；代价是只在**同一二层广播域**内有效，需指定发送网口（见下 `wol_interface`）
- `sshpass` + `openssh-client`：非交互式 SSH 登录以执行挂起 / 关机
- `luci-base`：LuCI 前端基础库；本应用以 **ucode 插件**形式挂入 rpcd，运行时需要 `rpcd-mod-ucode`（已在包依赖中显式声明，不依赖传递引入）

## 配置说明（UCI: /etc/config/serverctl）

总开关：

```sh
config serverctl 'defaults'
    option enabled '1'         # 设为 0 可停用全部定时任务
    option wol_interface 'eth0'   # 唤醒(WOL)发送魔术包的网络接口；置空则不带 -i
```

> `wol_interface`：`etherwake` 走二层帧，本插件默认从 `eth0` 发送魔术包。若你的目标机不挂在 `eth0`（例如挂在网桥 `br-lan` 或其它网口上），改成对应接口即可：`uci set serverctl.defaults.wol_interface=br-lan && uci commit serverctl`。

服务器条目（Server Maintenance）：

| 字段 | 说明 | 约束 |
| --- | --- | --- |
| `name` | 服务器名称 | 必填、不可重复 |
| `ip` | IP 地址或主机名 | 必填 |
| `mac` | MAC 地址（WOL 用） | 必填 |
| `user` | SSH 用户名 | 默认 `root` |
| `password` | SSH 密码 | 用于 sshpass 登录 |
| `os_type` | 系统类型 | `linux`（默认）/ `windows`，决定休眠 / 关机执行的远端命令 |

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

> 说明：SSH 密码以明文存于 UCI 配置（文件权限仅 root 可读），且 ssh 使用 `StrictHostKeyChecking=no`（不校验远端主机密钥），请把该设备与管理员访问控制在可信的局域网范围内。另请注意：`sshpass` 非交互登录时密码经由命令行参数传递，调用期间本机其他进程理论上可从进程表读到（OpenWrt 默认仅 root 单一可登录/运行进程的账户，实际风险有限）；如需更强隔离，后续可规划改用密钥认证（为服务器条目增加可选私钥字段）。

## 工作原理

- `rpcd` ucode 后端（`/usr/share/rpcd/ucode/serverctl`）提供 `ping`、`sshtest`（读）与 `wake`、`suspend`、`poweroff`（写）方法，权限由 `/usr/share/rpcd/acl.d` 限定。
- `procd` 服务 `/etc/init.d/serverctl`（`START=95`）常驻运行调度器 `/usr/bin/serverctl-scheduler`，每 3 秒检查一次；每当进入新的分钟时评估到期任务。
- 调度使用系统时区（服务启动时读取 `/etc/TZ`），`defaults.enabled=0` 时调度器跳过所有任务。**变更系统时区后需 `/etc/init.d/serverctl restart`**，否则已运行的调度器仍按旧时区触发定时任务。
- 远程命令经 `sshpass + ssh` 执行，固定使用 `-o StrictHostKeyChecking=no`、`-o UserKnownHostsFile=/dev/null` 且连接超时 5 秒；唤醒调用 `etherwake -i <接口> <mac>` 在局域网二层发送魔术包（接口取 `defaults.wol_interface`，缺省 `eth0`；显式置空则退化为不带 `-i` 的 `etherwake <mac>`），按服务器条目的 `os_type` 分发休眠 / 关机命令：Linux（默认）执行 `systemctl suspend --ignore-inhibitors`（忽略应用持有的休眠抑制锁，保证用户明确指令必然生效）与 `systemctl poweroff`；Windows 执行 `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` 与 `shutdown /s /t 0`。

## Windows 目标机设置

要让插件通过 SSH 控制 Windows 10 / 11 电脑，需先在目标机上启用 OpenSSH 服务器：

1. **管理员 PowerShell** 执行 `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` 安装（或在 设置 → 应用 → 可选功能 中添加 "OpenSSH 服务器"）；
2. `Start-Service sshd` 启动服务，`Set-Service -Name sshd -StartupType Automatic` 设为开机自启；
3. 在插件的服务器条目中填写该机的**本地管理员账户**用户名与**密码**（不能是 PIN / Windows Hello；账户必须设密码，空密码会被拒绝），**系统类型** 选择 `Windows`。非管理员账户的关机 / 休眠通常会被系统以权限不足拒绝，不建议使用。

行为与注意事项：

- **休眠**执行 `rundll32.exe powrprof.dll,SetSuspendState 0,1,0`，请求进入**睡眠**（具体是 S3 还是 S0ix 现代待机由设备决定）。⚠️ 若系统启用了休眠功能（`powercfg /h on`，许多 Win11 设备默认开启），Windows 会转而进入**休眠(S4)**；想要真正的睡眠，请先在目标机执行 `powercfg /h off`。
- **关机**执行 `shutdown /s /t 0`，立即关机。
- **WOL 唤醒**：在设备管理器网卡属性中勾选"允许此设备唤醒计算机"；能否从睡眠 / 休眠 / 关机唤醒取决于硬件（不少机器休眠或关机后网卡断电、无法唤醒，睡眠反而可以），以实测为准。

## 安装

### 方式一：下载预编译 ipk（推荐）

本仓库已配置 GitHub Actions 云端编译（见下）。到 **Actions** 运行工作流，从 **Artifacts** 或（勾选 `upload_release` 后的）**Releases** 下载 `luci-app-server-ctl_*.ipk`，然后传到路由器安装：

```sh
scp luci-app-server-ctl_*.ipk root@<路由器IP>:/tmp/
ssh root@<路由器IP> "opkg update && opkg install /tmp/luci-app-server-ctl_*.ipk"
```

**服务启用说明**：包内自带的 `/etc/init.d/serverctl` 在安装时会被 OpenWrt 打包框架的默认 postinst 钩子（base-files `/lib/functions.sh` 的 `default_postinst`）自动 `enable` 并立即 `start`（升级时仅在原本已启用的情况下重启），预编译进固件的场景则在构建时即创建 rc.d 自启链接，**无需手动启用**。可用以下命令确认：

```sh
/etc/init.d/serverctl enabled && echo enabled   # 开机自启状态
pgrep -f serverctl-scheduler                    # 调度器进程是否在运行
logread -e serverctl                            # 调度器输出日志
```

若因环境异常未处于运行状态，手动补救：`/etc/init.d/serverctl enable && /etc/init.d/serverctl start`。

### 方式二：源码编译

将本项目放入 `package/`（或某个 feeds 的 `applications/` 目录，以满足 `include ../../luci.mk` 的相对路径），随后：

```sh
make package/luci-app-server-ctl/compile V=s
```

产出的 ipk 位于 `bin/packages/<arch>/…`（一般在所属 feed 的子目录下，如 `bin/packages/x86_64/luci/`）。

> 若用 **SDK** 做本地编译：本包会连带编译 `luci-base` 及其 C 依赖（`rpcd-mod-luci`、`lucihttp`），
> 它们需要 `libnl-tiny` / `liblua` / `libiwinfo` 等 core 包的**源码**来补齐 staging 头。SDK 只预编译
> 不附带这些源码，因此务必同时更新并安装 `base` feed（`feeds.conf` 中的 `src-git-full base`），
> 否则会报缺 `netlink/msg.h`、`lua.h`。GitHub Actions 工作流已自动处理此点。

## 云端编译（GitHub Actions）

本仓库使用 **ImmortalWrt SDK** 单独编译本插件，无需构建整个固件。工作流文件：

`.github/workflows/build-luci-app-server-ctl.yml`

**流水线主要步骤**：下载并解包 SDK → `feeds update base packages luci`（`base` 用于补齐 core 包源码，见上文提示）→ 将本插件放入 luci feed 的 `applications/` 层并软链接进 `package/feeds/luci/` → 播种 `.config` 并 `make defconfig`（硬校验本包已启用）→ `make package/luci-app-server-ctl/compile` → 收集 ipk 并上传为 Artifact。

**触发方式**：打开仓库 **Actions** → **Build luci-app-server-ctl** → **Run workflow**，可选参数：

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `iw_version` | SDK 对应的 ImmortalWrt 版本，如 `24.10.6` / `25.12.2` | `24.10.6` |
| `upload_release` | 填 `true` 时创建 Release 并附上 ipk | `false` |
| `ssh` | 填 `true` 时开启 tmate 远程调试 | `false` |

**产物**：运行成功后在 **Artifacts** 中下载 `luci-app-server-ctl-ipk-…`（内含 `luci-app-server-ctl_0_all.ipk`，架构为 `all`，通用于各目标平台）。若 `upload_release=true`，同样文件会附带在 Release 上。

**耗时与排错**：会连带从源码编译 `luci-base`、`rpcd`、`rpcd-mod-luci`、`lucihttp` 等依赖，整体约 20 分钟上下，属正常现象。若编译失败，工作流会自动执行 **Diagnose build failure** 步骤，打印 kconfig 循环依赖上下文、相关 `CONFIG` 取值以及 buildroot 分包日志（`logs/.../compile.txt`）中的关键错误，并在失败时上传完整日志 zip，便于快速定位。

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
