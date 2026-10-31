# luci-app-server-ctl 代码审查报告

- 审查日期：2026-10-31
- Rev.2（同日）：根据反馈对「服务启用链路」做了专项复核（新增 E4），并在 README 安装章节补充验证/补救命令
- Rev.3（同日）：修复全部中危问题（A1、A2、D1、E1、F1 代码修复；B2 按报告建议以 README 说明处理）
- Rev.4（同日）：修复全部低危问题（A3–A7、B3、D2–D5、E2、F2–F4、G1–G3、H1/H2）；B4、C3、D3、E3 按报告结论维持现状仅记录
- 审查范围：仓库全部一手代码（前端视图、ucode 后端、调度器、服务脚本、打包配置、ACL/菜单、i18n、CI 工作流、测试体系、仓库文档）。`tests/harness/resources/` 下的 form.js / ui.js / luci.js / network.js 等 vendored LuCI 库副本仅作为运行环境看待，不作为被审代码。
- 严重度图例：🔴 高（应尽快修）｜🟠 中（建议尽快处理）｜🟡 低（择机改进）｜🔵 说明/正面观察

## 总览

| 模块 | 文件 | 总体评价 | 问题分布 |
| --- | --- | --- | --- |
| A. LuCI 前端视图 | `main.js` | 结构清晰、交互完善，但转义有两处硬伤 | 🟠×2（已修复） 🟡×5 🔵×3 |
| B. 核心逻辑 core.uc | `core.uc` | 转义严谨、错误处理统一，个别边界可收紧 | 🟠×1（已处理） 🟡×2 🔵×3 |
| C. rpcd 接口与 ACL | `rpcd/ucode/serverctl`、`acl.d` | 设计正确，read/write 划分合理 | 🔵×3 |
| D. 调度器与服务 | `serverctl-scheduler`、`init.d` | 逻辑正确、容错好，但缺运行日志 | 🟠×1（已修复） 🟡×4 🔵×3 |
| E. 打包/菜单/翻译 | `Makefile`、`menu.d`、`po` | 规范，有一处依赖声明风险；服务启用链路已复核（E4） | 🟠×1（已修复） 🟡×2 🔵×3 |
| F. CI 工作流 | `build-luci-app-server-ctl.yml` | 诊断完善，个别时效性/最小权限问题 | 🟠×1（已修复） 🟡×3 🔵×2 |
| G. 测试体系 | `tests/`、`preview/` | 覆盖面相当好，路径硬编码 | 🟡×3 🔵×3 |
| H. 仓库卫生/文档 | README、AGENTS、issues | README 质量高；疑似放错目录的文件 | 🟡×2 🔵×1 |

总体结论：**没有发现高危漏洞**。命令注入防护（shell 单引号转义）做得扎实且有测试佐证，ACL 读写分离正确，调度矩阵语义与 README 一致。主要改进点集中在：前端两处 HTML 注入面、服务器列表网格明文暴露密码、调度器守护模式零日志、`rpcd-mod-ucode` 依赖未显式声明、以及 CI runner 时效。以上全部中危项已于 Rev.3 修复完毕（状态见各节“状态”行与文末优先级表）。

---

## A. LuCI 前端视图 `htdocs/luci-static/resources/view/serverctl/main.js`

### 🟠 A1 `E()` 纯字符串子节点走 innerHTML，存在存储型 XSS 注入面

LuCI 框架的 `E()` 在 children 为**裸字符串**时会把内容赋给 `innerHTML`（仅数组元素才走 `createTextNode`，见 `tests/harness/resources/luci.js:1315-1332`）。本视图把 UCI 中的服务器名以裸字符串传入：

- `main.js:291`：`options.push(E('option', { value: s['name'] }, s['name']))` —— 名称即 HTML。
- `main.js:65` + `main.js:423-426`：`confirmDialog` 内 `E('p', {}, body)`，而 body 由 `_('Are you sure ... "%s"?').format(name)` 拼入名称。

凡能写入 `serverctl` UCI 配置者（或手工改配置文件）即可注入如 `<img src=x onerror=...>` 的服务器名，在其他管理员打开页面时以其权限执行脚本。修复很简单，把内容改为数组形式即可走文本节点路径：

```js
E('option', { value: s['name'] }, [ s['name'] ])
E('p', {}, [ body ])
```

（`updateInfo()`/`appendLine()` 用 `textContent`，输出面板是安全的。）

**状态**：✅ 已修复（Rev.3）—— main.js:65（确认框 body）与 main.js:291（下拉 option）两处均已改数组形式；CBI 内建渲染路径未动。

### 🟠 A2 服务器列表网格中密码列明文显示

`main.js:640` 的 `form.Value 'password'` 未设 `modalonly`，LuCI GridSection 会把每个 option 渲染成表格列 —— 实际页面上「服务器维护」表格里密码列是明文可见的（与 `preview/index.html` 里刻意遮成 `••••••` 的预期不符，手动面板里也做了遮罩，唯独网格里没遮）。建议：

```js
o = s.option(form.Value, 'password', _('Password'));
o.modalonly = true;   // 仅模态框内编辑，不进网格列
```

（编辑旧条目时如需防止“明文读取”，可进一步用 `password` 型输入 + 留空表示不修改，非必需。）

**状态**：✅ 已修复（Rev.3）—— `password` 选项已加 `o.modalonly = true`，不再出现在网格列。

### 🟡 A3 `NamedSection` 注册参数疑似写反（无功能影响，但误导）

`main.js:521`：`m.section(ManualSection, 'defaults', 'serverctl', ...)` 的参数顺序是 `(ctor, type, name, title)`，即 type=`defaults`、name=`serverctl`；而 UCI 里实际是 `config serverctl 'defaults'`，两者正好颠倒。因 `ManualSection.render()` 完全自定义、不读写 UCI，当前无副作用；但若日后有人往这个 section 挂表单选项，将无法正确读写。建议改为 `'serverctl', 'defaults'` 或加注释说明系故意留空。

**状态**：✅ 已修复（Rev.4）—— 参数顺序改为 `'serverctl', 'defaults'` 并加注释说明该节完全自定义渲染、不读写 UCI。

### 🟡 A4 weekly 任务可不选“星期”，导致任务永不触发且无提示

`main.js:552-560` `weekday` ListValue 未设 `rmempty=false`/`default`，模态框里可留空。调度器侧 `int('')` 解析失败 → 永不匹配（`core`/scheduler 的容错方向正确），但用户侧完全无感知。建议 `o.rmempty = false; o.default = '1';`。

**状态**：✅ 已修复（Rev.4）—— `weekday` 已加 `o.rmempty = false; o.default = '1'`（默认周一），不再能留空静默失效。

### 🟡 A5 单次任务日期仅做格式校验

`main.js:562-569` 只验证 `YYYY-MM-DD` 形状，`2099-02-30` 也能通过。调度器按字符串相等比较，后果是任务静默不执行。可顺手用 `new Date(v)` 验证真实日期，或明确注释“非法日期=永不触发”。

**状态**：✅ 已修复（Rev.4）—— 格式匹配后用 `new Date(y, m-1, d)` 回验年/月/日三字段，`2099-02-30` 一类伪日期直接拒绝。

### 🟡 A6 输出面板无长度上限

`main.js:385-388` `appendLine` 持续累加 `textContent`，长时间挂页面后 DOM 文本可能很大。可按行数截断（例如保留末 500 行）。

**状态**：✅ 已修复（Rev.4）—— `appendLine()` 在面板文本超过 64 KB 时从头部按 8 KB 一块截断。

### 🟡 A7 `ip` 仅接受 IPv4/hostname

`main.js:631` 的 `or(ip4addr,hostname)`（datatype 合法，harness validation.js 已确认存在 hostname 校验器）不支持 IPv6 地址，而后端 ssh/ping 本身对 IPv6 没有障碍。如需支持可改 `or(ip4addr,ip6addr,hostname)`。

**状态**：✅ 已修复（Rev.4）—— datatype 已改 `or(ip4addr,ip6addr,hostname)`；配套地，`core.uc` 的 ssh 目标地址含 `:` 时自动加方括号包裹（`[fe80::1]` 形式），ping/ssh 全链路可用 IPv6。

### 🔵 A-正面观察

- `rpc.declare` 五个方法集中声明、`actionRPC` 表驱动（8-49），风格规范。
- 挂起/关机二次确认（62-84、422-430）与 busy 状态管理（404-419）完整，取消路径不会产生未捕获 rejection。
- `addModalOptions` 每次打开任务模态框时重建服务器下拉（595-606）+ `modaltitle` 函数式标题（`form.js:3626 titleFn` 支持），考虑周到。
- 标签页布局通过 `renderChildren/renderContents` 重写实现（445-507），对 argon 主题适配的注释详尽，DOM 结构假设均有判空防护。
- `name` 校验仅查重（620-627）：允许任意字符名称。配合 A1 修复后风险可控；若想更严可仿 `uciname` 风格限制。

---

## B. 核心逻辑 `root/usr/share/serverctl/core.uc`

### 🔵 B1 shell 转义实现正确且有测试佐证（重点核查项）

`shellquote()`（15-17）用标准 `'…'\''…'` 单引号转义，`run()`（29-38）将 argv 逐一转义后拼接并 `2>&1` 合并输出。`run-tests.sh:231-242` 专门用含 `'` 和空格的密码 `p'w x` 验证了透传完整性，这是同类插件常见的翻车点，本项目做对了。

补充说明（已查证 ucode 上游）：`fd.close()` 对 popen 句柄返回经 `WEXITSTATUS` 归一的退出码（信号终止为负数，出错为 `null`），`run()` 的 `{code, output}` 语义成立；仅当 close 异常时 code 为 `null`，前端 `typeof res.code === 'number'` 判 false 会显示 -1，可接受。另外新版 ucode 的 `fs.popen` 支持 argv 数组直接 execvp 绕过 shell，待目标版本基线确认后可简化掉手工转义——现阶段保留字符串形式反而兼容性最好。

### 🟠 B2 SSH 密码经由命令行传递（sshpass `-p`）

`core.uc:50`：`sshpass -p <密码> ssh ...`。密码在进程存续期内可被同机任何进程通过进程列表（`ps`/`/proc/*/cmdline`）读取。OpenWrt 上通常只有 root 能看，风险有限，但这是该模式固有的弱点：更稳妥的 `sshpass -d 0` 需要 stdin 管道配合，或改用密钥认证（服务器条目提供私钥选项），建议至少在 README 中注明此局限（目前 README 只注明了明文存储与 StrictHostKeyChecking）。

**状态**：✅ 已按报告建议处理（Rev.3）—— 代码侧维持 `-p`（OpenWrt 单一 root 模型下，`-f` 临时文件方案的权限控制与崩溃残留风险弊大于利）；README 安全说明已补充 sshpass 调用的进程表可见窗口与密钥认证改进方向。

### 🟡 B3 `find_server` 空名可误匹配无名条目

`core.uc:75`：`str(s['name']) == str(name) || sid == name` —— 若调用方传空串（RPC 层 `args.server` 无长度约束），而清单里恰有缺失 `name` 字段的条目，会命中第一个无名条目并对错误目标执行动作。调度器侧已挡住空 server（scheduler `:86`），但 RPC 路径 `execute(action, '')` 未挡。建议 `execute()` 开头对 `str(name) == ''` 直接返回 `code 1`。

**状态**：✅ 已修复（Rev.4）—— `execute()` 开头空名直接返回 `code 1`；`find_server()` 同步改为空名不走名称匹配分支，双保险。

### 🟡 B4 `StrictHostKeyChecking=no` + `UserKnownHostsFile=/dev/null`

`core.uc:51-52`，README 已明示属已知设计（LAN 环境 + 免交互）。若想收紧，可默认关闭主机校验但允许在服务器条目上勾选“严格校验”，作为后续增强即可，不必现在做。

### 🔵 B-正面观察

- `get_cursor()` 支持 `SERVERCTL_CONFDIR/DELTADIR` 环境变量注入（19-27），使测试可用独立配置目录跑真实 uci，是很好的可测试性设计。
- `wake` 对 `wol_interface`「缺省=eth0 / 显式置空=不带 -i」的三态语义（95-107）注释与实现一致。
- 各 action 返回统一的 `{code, output}`，`execute()` 对未知动作/未知服务器先行短路（130-141），错误信息可读。
- user 缺省 root、password 缺省空（44-48）与前端默认值呼应。

---

## C. rpcd 接口 `root/usr/share/rpcd/ucode/serverctl` 与 ACL `acl.d/luci-app-server-ctl.json`

### 🔵 C1 接口层薄而正确

方法工厂（7-15）将参数限定为 `{ server: 'string' }`，实际网络目标全部来自 UCI 存量条目而非调用方输入——这从根上避免了“让路由器对任意主机发 ping/ssh”的 SSRF 面。返回值直接透传 core 的对象，rpcd-ucode 约定下即为成功响应，前端契约一致。

### 🔵 C2 ACL 读写分离恰当

`acl.d` 中 ping/sshtest 归 `read`，wake/suspend/poweroff 归 `write`（5-14），与动作破坏性匹配；menu.d 再以 `depends.acl` 隐藏无权限入口。`uci: ["serverctl"]` 意味着 write 用户可改 SSH 密码——属功能必需，注意 README 的“可信局域网”前提同样适用于 ACL 授权。已知属性：read 权限用户经 `uci.get` 本就能拿到密码字段，前端的遮罩只是观感。

### 🟡 C3 错误以 `code:1` 返回而非 rpcd 错误

`server not found` 等以正常响应 `{code:1, output}` 返回。前端已按此契约处理（`typeof res.code === 'number'`），内部自洽；只是对第三方复用该 ubus 对象的调用者而言，业务失败与成功在 rpcd 层面不可区分。维持现状可接受，记录即可。

---

## D. 调度器 `root/usr/bin/serverctl-scheduler` 与服务 `root/etc/init.d/serverctl`

### 🟠 D1 守护模式丢弃全部执行结果（可观测性盲区）

`tick()` 精心构造了 `sid server action code=… output=…` 的结果行（91-92），但只有手动 `tick` 子命令会打印（106-113）；常驻循环里 `tick()` 返回值被直接丢弃（125）。init.d 明明已开 `stdout 1 / stderr 1`（init.d:15-16），logread 里却永远看不到定时任务的执行记录——定时关机因密码错误静默失败时，用户在 logread 里也查不到任何线索。修复成本极低：

```js
for (let line in tick())
    warn(line + '\n');   // 或 printf 到 stdout，procd 会收进 logread
```

**状态**：✅ 已修复（Rev.3）—— 守护循环现将 `tick()` 结果 `printf` 到 stdout（procd 收入 logread）；无任务的正常分钟无输出、无噪音。

### 🟡 D2 同分钟重启可能重复触发

循环以 `date+HH:MM` 字符串与上一轮比较来检测“进入新分钟”（115-126），`last` 不落盘。若调度器恰在任务所在分钟内被重启（procd respawn、手动 restart、开机时序），该分钟内任务会再次执行（daily/weekly 场景）。类似地，NTP 首次校时/时区变更导致时钟回拨也可能重复触发。影响有限（动作基本幂等、once 已删），若要根治可把“最近处理过的分钟戳”写入 `/var/run` 文件。

**状态**：✅ 已修复（Rev.4）—— “最近已处理分钟”落盘 `/var/run/serverctl-lasttick`（tmpfs），respawn/重启同分钟内不再重复执行；/var/run 随设备重启清空，重启后当前分钟任务仍至多执行一次。

### 🟡 D3 串行执行 + 跨分钟丢任务

一轮 tick 内所有到期任务串行执行（49-98），每条 SSH 至少受 `ConnectTimeout=5` 约束，但命令本身（如挂起响应慢的主机）耗时不受总控。任务多且目标异常时一轮可超 60s，期间被跳过的分钟不会补跑，任务顺延到次日。小规模 LAN 场景概率很低，记录为已知限制即可；将来可考虑每任务 fork 或整体超时。

### 🟡 D4 每分钟 fork `date` 子进程

`readnow()`（8-28）每 3 秒 popen 一次 `date`，一天 28800 个进程，在嵌入式设备上属于可观的常驻开销。ucode `system.date('*t')`（受 TZ 环境变量支配，与 procd 注入的 `TZ` 正好吻合，init.d:9-13）可以进程内完成同样计算。顺带可消除 `date` 输出格式被外部 shell 环境影响的理论风险。

**状态**：✅ 已修复（Rev.4）—— `readnow()` 改用 ucode 内置 `localtime()` 进程内计算（已按上游文档核对 TimeSpec：mon 1 基、wday 0 基即周日=0，与原 `date +%w` 及前端取值语义一致），每分钟 fork 数归零。

### 🟡 D5 时区热更新缺失

init.d 只在 start 时读 `/etc/TZ`（init.d:9-13，且 /etc/TZ 为空时完全不设 TZ，走 UTC）。用户改时区后若不重启本服务，任务时刻会整体偏移。建议 README 提一句“变更时区后需 `/etc/init.d/serverctl restart`”，或在 uci 变更钩子里自动 restart。

**状态**：✅ 已处理（Rev.4）—— README 架构说明已加粗提示“变更系统时区后需 `/etc/init.d/serverctl restart`”；自动 restart 钩子留作后续增强。

### 🔵 D-正面观察

- 配置容错成体系：`enabled` 缺省视为启用、`schedule` 缺省 daily、`int('')` 解析失败自然不匹配（56-65），手改坏配置不会导致调度器崩溃。
- `once` 任务执行后 `delete + commit`（94-101），并有测试覆盖删除与保留的隔离性。
- `tick` 子命令（106-113）兼作调试入口，配合 fake 工具链是该测试体系能落地的关键。
- procd `respawn` 采用默认策略即可；`START=95` 晚于网络类服务，合理。

---

## E. 打包配置（Makefile / etc/config / menu.d / po）

### 🟠 E1 `rpcd-mod-ucode` 未显式列入依赖

`Makefile:9`：`LUCI_DEPENDS:=+luci-base +etherwake +sshpass +openssh-client`。本应用的整个后端挂在 rpcd 的 ucode 插件上，运行时硬依赖 `rpcd-mod-ucode`，但依赖声明里只有 README 第 38 行那句“通常已随 luci-base 的依赖链引入”。即便当前 OpenWrt/ImmortalWrt 版本恰好经 luci-base 传递引入，依赖声明也应覆盖直接运行时依赖——上游依赖链变动或定制镜像裁剪时，症状是页面所有按钮报 `SERVER_NOT_FOUND` 类错误且难以排查。建议直接改为：

```make
LUCI_DEPENDS:=+luci-base +rpcd-mod-ucode +etherwake +sshpass +openssh-client
```

**状态**：✅ 已修复（Rev.3）—— Makefile 依赖已改为上式，README 依赖清单同步更新。

### 🟡 E2 i18n 文案小瑕疵

`po/zh_Hans/luci-app-server-ctl.po`：翻译覆盖完整（逐条对照过 main.js 全部 `_('…')`，无遗漏）。两点小意见：① `Ping测试/SSH测试` 建议与全角空格风格统一（如 `Ping 测试`）；② po 头缺 `Project-Id-Version`/`Language` 等标准字段，纯装饰性问题。

**状态**：✅ 已修复（Rev.4）—— `Ping 测试`/`SSH 测试` 已加空格；po 头补齐 `Project-Id-Version`、`Language` 字段。

### 🟡 E3 `PKG_PO_VERSION` 跟随动态版本号

`Makefile:17-18`：`PKG_PO_VERSION = PKG_VERSION`（CI 注入日期+哈希）。i18n 包版本与主包绑定对发布无害，但每次 CI 构建都会产出“版本更新”的 i18n 包。可接受，仅提示。

### 🔵 E4（Rev.2 复核）服务启用链路专项复核：无需自定义 postinst / uci-defaults

针对「全仓库无 uci-defaults / postinst，opkg 安装后服务未 enable，定时任务装完即失效」的疑问做了源码级复核，结论：**该链路在标准安装方式下由 OpenWrt 框架自动兜底，功能不会装完即失效**。

依据（均取自上游源码实测）：

1. buildroot 为每个包生成的 `.postinst` 会调用 base-files `/lib/functions.sh` 中的 `default_postinst()`，该函数 grep 包文件清单中的 `/etc/init.d/*` 条目：实机 opkg 安装时自动 `"$i" enable` + `"$i" start`（升级时仅在已 enable 的前提下重启）；镜像构建（IPKG_INSTROOT 非空）时通过 `$root/etc/rc.common "$root$i" enable` 直接在镜像里创建 rc.d 自启链接。卸载侧由 `default_prerm()` 对称执行 stop + disable（升级除外）。
2. `default_postinst()` 还会在实机安装时立即执行包内的 `/etc/uci-defaults/*` 脚本（执行成功即删除），boot 阶段 `uci_apply_defaults()` 仅作补跑——即本包即使补 uci-defaults，也属重复而非必需。
3. luci.mk 的默认 postinst（`ifndef Package/$(PKG_NAME)/postinst` 守卫）只负责清 LuCI 模板/模块缓存并 reload rpcd，不管服务 enable——上述两层分工明确、互不冲突；本包未自定义 postinst，默认版完整保留。

因此 README 的「opkg 装 ipk」与「SDK/镜像预装」两条路径下，procd 均会在安装后/首次启动时拉起调度器。真正的缺口在**文档**：README 原先未说明该自动行为，用户装机后无从验证。Rev.2 已在 README 安装章节补充说明与验证/补救命令（`/etc/init.d/serverctl enabled`、`pgrep -f serverctl-scheduler`、`logread -e serverctl`）。

可选加固（当前不必做）：若要覆盖绕过 maintainer 脚本的极端安装方式（纯 rootfs 解包等），可加幂等的 `root/etc/uci-defaults/luci-app-server-ctl`（内容 `[ -x /etc/init.d/serverctl ] && /etc/init.d/serverctl enable`）作兜底。另注：若在 24.10+ 的 APK 打包发行版上部署，CI 产出的 `.ipk` 需经 apk 兼容路径安装，maintainer 脚本机制等价，但建议在该类设备上实测一次。

### 🔵 E-正面观察

- `PKG_VERSION ?= $(if $(CTL_BUILDID),...)`（Makefile:15-17）兼顾 CI 构建号与本地回退，注释清楚。
- `etc/config/serverctl` 默认值与前端/调度器默认语义一致；menu.d 的 `depends.uci + acl` 双条件、`order: 90` 规范。

---

## F. CI 工作流 `.github/workflows/build-luci-app-server-ctl.yml`

### 🟠 F1 `ubuntu-22.04` runner 已过时

`workflow:63`：GitHub 托管的 ubuntu-22.04 镜像已进入退役周期（2026 年 4 月起停止服务），继续钉在 22.04 随时可能出现排队重定向或彻底失败。建议切到 `ubuntu-24.04` 并验证一次构建（SDK 编译自带工具链，通常只需留意 apt 包名差异）。

**状态**：✅ 已修复（Rev.3）—— 已切至 `ubuntu-24.04`；同批从 apt 安装清单移除 24.04 起不再提供的 `python3-distutils`（Python 3.12 移除 distutils，保留会直接导致 apt 安装失败），并在工作流中留注说明。**待办**：下一次手动触发工作流做一次实际验证。

### 🟡 F2 actions 未固定到 commit SHA

`actions/checkout@v4`、`mxschmitt/action-tmate@v3`、`softprops/action-gh-release@v2`（67、175、325）按可变 tag 引用。公共仓库供应链加固的通行做法是钉 SHA + `actions/dependabot` 更新。另外 `repository_dispatch`（29-30）未限定 `types`，任何外部 dispatch 类型都会触发构建（本仓库无 secrets 注入面，风险低，但建议显式 types）。

**状态**：✅ 已修复（Rev.4）—— 全部 actions 钉到 commit SHA 并注明版本（checkout v4.4.0、upload-artifact v4.6.2、download-artifact v4.3.0、action-tmate v3.24、action-gh-release v2.6.2，均取当前主版本线最新补丁）；`repository_dispatch` 限定 `types: [build]`；新增 `.github/dependabot.yml`（github-actions 每周检查）负责后续 SHA 升级提 PR。

### 🟡 F3 顶层 `permissions: contents: write` 粒度过宽

`workflow:58-59` 全 job 可写仓库内容；实际只有 Create release 步骤需要写权限。建议默认 `contents: read`，release 挪到独立 job 或步骤级授权。

**状态**：✅ 已修复（Rev.4）—— 顶层降为 `contents: read`；Release 拆为独立 `release` job（`needs: build`，唯一持有 `contents: write`），.ipk 经 artifact 跨 job 传递；build job 输出 `version/build_id/ipk_ok` 供其拼接产物名、tag 与正文，且仅在勾选 upload_release 且 ipk 确实产出时执行。

### 🟡 F4 CI 未运行仓库自带测试

工作流只做编译。`tests/run-tests.sh`（静态检查 + 行为测试）目前无自动执行入口，路径问题见 G1。可在 SDK 构建前加一步（runner 自带 node，ucode/uci 需 apt 或跳过）。

**状态**：✅ 已修复（Rev.4）—— 新增 “Run repo self-tests” 步骤（Install 之后、SDK 下载之前）：apt 装 `uci`、ucode 走一次快速源码构建（约 1 分钟，失败不影响后续），以 root 运行 `bash tests/run-tests.sh`；步骤设 `continue-on-error: true`，测试环境波动不阻断 .ipk 产出。

### 🔵 F-正面观察

- 诊断体系出色：`defconfig` 后硬校验本包启用（202-207）、失败时 kconfig 循环依赖上下文 + build.log 关键行 + logs/ 分包日志扫描（240-287）、失败日志 artifact 上传（289-297）。
- i18n 构建以「ipk 是否真实产出」判定成败并注释了 buildroot 记账 bug 的由来（219-237），把 workarounds 讲清楚了。
- tmate 调试有 `limit-access-to-actor: true`；SDK 文件名抓取失败有明确报错；feed `install -a` 会引发 kconfig 环的坑有注释存档。

---

## G. 测试体系 `tests/`、`preview/`

### 🟡 G1 `run-tests.sh` 路径硬编码，可移植性差

`run-tests.sh:5-6` 钉死 `/workspace/luci-plugin/...`，换机器即失效；45-48 还把文件复制到 `/usr/share`、`/usr/local/bin` 且结束时不清理。建议改为 `ROOT="$(cd "$(dirname "$0")/.." && pwd)"` 推导，并加 trap 清理。

**状态**：✅ 已修复（Rev.4）—— 改为 `SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)` 推导 `ROOT/PKG`；测试工作区支持 `SC_TEST_DIR` 覆盖；`trap cleanup EXIT INT TERM` 统一清理工作区及部署到 `/usr/share`、`/usr/local/bin` 的文件。

### 🟡 G2 覆盖缺口（当前矩阵已相相当好）

已覆盖：daily/weekly/once 命中与不命中、enabled 双层开关、缺 MAC、未知服务器、Windows 命令分发、ssh 命令行完整性、含引号密码转义、once 删除隔离、全局禁用、rpcd 模块结构、守护循环冒烟。尚可补：
1. `wol_interface` 自定义值与显式空串（不带 `-i`）两条分支——核心代码有明确语义却无断言；
2. popen 路径非零退出码的归一传递（现 only 固定 `{code:1}` 分支，建议用 fake 工具 `exit 3` 断言 `code=3`）；
3. `sshpass`/`etherwake` 缺失时 `sh: not found` → code 127 的表现。

**状态**：✅ 已补 1、2 两项（Rev.4）—— 新增断言：wol_interface 自定义接口（RPC 直调 wake）、显式空串不带 `-i`（uci CLI 置空等于删选项，故 sed 直写空串）、非零退出码传递（fake ping `exit 3` → tick 行 `code=3`）。第 3 项需整体剥离系统 PATH（连 ucode/uci 都无法运行），暂不补，视为可选。

### 🟡 G3 mock-server 静态路由无路径遍历防护

`mock-server.js:56-59`：`path.join(RES, p.slice(...))` 未校验结果仍在 RES 内，`/luci-static/resources/../../../../etc/passwd` 可读任意文件。仅监听 127.0.0.1 的开发工具，风险低，加一行守卫更稳妥：

```js
if (!path.normalize(file).startsWith(RES + path.sep) && file !== PLUGIN_MAIN) → 404
```

**状态**：✅ 已修复（Rev.4）—— 静态路由记录归属根目录，用 `path.relative` 判定解析结果必须仍在根内（越界即 404），比 `startsWith` 字符串前缀更严格（防 `/luci-static/resources-evil` 一类前缀混淆）。

### 🔵 G-正面观察

- 「动态取当前分钟构造配置 + 跨分钟自动重试（3 次）」的调度器测试策略务实（64-66、182）。
- 通过 `SERVERCTL_CONFDIR/DELTADIR` 隔离被测配置，真实调用 uci/ucode 而非 stub，测试价值高。
- `preview/index.html` 自称“非真实 LuCI 运行时”定位诚实；playwright harness 用真实 LuCI 前端栈 + mock ubus，是前端回归的好底子（建议补一条 A2 密码列行为的回归用例——它正是 preview 与实际页面不一致的实例）。
- harness 内 vendored LuCI 库副本为上游未改动拷贝，版本随 openwrt2020 主题固定，注意后续手工同步。

---

## H. 仓库卫生与文档

### 🟡 H1 `issues/overtchat-connector-lan-http.md` 疑似放错仓库

该文档描述的是 OvertChat（`overtchat-app`/Host Connector，TypeScript 项目）的 issue 草稿，与本 LuCI 仓库无任何关联。若非有意留档，建议移至对应项目，避免干扰后续检索。

**状态**：✅ 已处理（Rev.4）—— 该文件原本未纳入 git 跟踪，已移入 `archive/overtchat-connector-lan-http.md`（空 `issues/` 目录已删）；确认属 OvertChat 项目后可直接删除。

### 🟡 H2 `AGENTS.md` 为空占位（仅“# 项目约定”标题）

要么补充约定（代码风格、提交规范），要么删除，避免给协进者空信号。

**状态**：✅ 已修复（Rev.4）—— 已补齐实质约定：仓库结构、代码风格（POSIX sh、ucode 'use strict'、`E()` 数组子节点）、测试验证入口、提交规范。

### 🔵 H-正面观察

- README 与实现逐点核对基本一致：依赖清单、`ConnectTimeout=5`、`-o` 选项、etherwake 三态接口语义、START=95、3 秒轮询、明文密码与主机校验告警均有如实交代——文档诚信度高。
- `.gitattributes`（统一 LF + 按 OpenWrt 部署路径强制 eol=lf）是对“Windows 上开发、路由设备上跑”工作流的正确防御，实测关键脚本均无 CRLF。

---

## 建议修复优先级

| # | 事项 | 位置 | 量级 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | `E()` 字符串子节点改数组形式，堵住名称注入面 | main.js:65、291 | 2 行 | ✅ Rev.3 |
| 2 | 密码列 `modalonly = true` | main.js:640 | 1 行 | ✅ Rev.3 |
| 3 | Makefile 显式加 `+rpcd-mod-ucode` | Makefile:9 | 1 行 | ✅ Rev.3 |
| 4 | 守护模式把 tick 结果打到 stdout（进 logread） | scheduler:125 | 2 行 | ✅ Rev.3 |
| 5 | CI runner 升 ubuntu-24.04 | workflow:63 | 1 行 + 一次验证 | ✅ Rev.3（待跑一次工作流验证） |
| 6 | `execute()` 拒绝空 server 名 | core.uc:130 | 2 行 | ✅ Rev.4 |
| 7 | weekday 加默认值 + `rmempty=false` | main.js:552 | 2 行 | ✅ Rev.4 |
| 8 | run-tests.sh 路径自适应 + 清理 | run-tests.sh:5-6 | 小改 | ✅ Rev.4 |
| 9 | wol_interface / 非零退出码补测 | run-tests.sh | 中等 | ✅ Rev.4 |
| 10 | 移走误置的 issues 文档、补/删 AGENTS.md | 仓库根 | 整理 | ✅ Rev.4 |

（第 1–5 项连同 B2 的 README 说明已在 Rev.3 完成；第 6–10 项连同其余低危项 A3、A5–A7、D2–D5、E2、F2–F4、G3 已在 Rev.4 完成——至此报告无待办修复项。B4、C3、D3、E3 按各节结论维持现状仅记录。剩余唯一动作：手动触发一次 Build workflow，验证 ubuntu-24.04、自测步骤与拆分后的 release job。）
