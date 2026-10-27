#!/bin/sh
# 端到端测试：调度器逻辑 + rpcd 模块 + 静态检查
# 依赖: ucode(自制运行时), uci CLI, fake etherwake/sshpass/ping

ROOT=/workspace/luci-plugin/luci-app-server-ctl/root
PKG=/workspace/luci-plugin/luci-app-server-ctl
T=/tmp/sc-test
LOG=$T/calls.log
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

check() { # desc, cond-result(0/1)
	if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1"; fi
}

rm -rf $T
mkdir -p $T/bin $T/etc/config $T/delta $T/ucode-tmp

export TZ=UTC
export SERVERCTL_CONFDIR=$T/etc/config
export SERVERCTL_DELTADIR=$T/delta
CONF=$T/etc/config/serverctl

# ---------- fake 工具 ----------
cat > $T/bin/etherwake <<EOF
#!/bin/sh
echo "etherwake \$*" >> $LOG
EOF
cat > $T/bin/sshpass <<EOF
#!/bin/sh
echo "sshpass \$*" >> $LOG
echo FAKE-SSH-OUTPUT
EOF
cat > $T/bin/ping <<EOF
#!/bin/sh
echo "ping \$*" >> $LOG
EOF
chmod +x $T/bin/*
export PATH=$T/bin:$PATH

# ---------- 部署被测文件到设备路径（模拟安装） ----------
mkdir -p /usr/share/serverctl
cp $ROOT/usr/share/serverctl/core.uc /usr/share/serverctl/core.uc
cp $ROOT/usr/bin/serverctl-scheduler /usr/local/bin/serverctl-scheduler
chmod +x /usr/local/bin/serverctl-scheduler

# ---------- 静态检查 ----------
node --check $PKG/htdocs/luci-static/resources/view/serverctl/main.js 2>/dev/null \
	&& ok "node --check main.js" || bad "node --check main.js"

sh -n $ROOT/etc/init.d/serverctl 2>/dev/null && ok "sh -n init.d" || bad "sh -n init.d"

ucode -e "
import { readfile } from 'fs';
json(readfile('$ROOT/usr/share/luci/menu.d/luci-app-server-ctl.json'));
json(readfile('$ROOT/usr/share/rpcd/acl.d/luci-app-server-ctl.json'));
print('json-ok');
" > $T/json.out 2>&1
grep -q json-ok $T/json.out && ok "menu.d + acl.d JSON 合法" || bad "menu.d + acl.d JSON 合法"

# ---------- uci 配置（动态时间；分钟翻转自动重试）----------
for attempt in 1 2 3; do
NOW_H=$(date +%H); NOW_M=$(date +%M); NOW_W=$(date +%w); TODAY=$(date +%Y-%m-%d)
FUT_H=$(( (10#$NOW_H + 3) % 24 ))
BAD_W=$(( (NOW_W + 1) % 7 ))

cat > $CONF <<EOF
config serverctl 'defaults'
	option enabled '1'

config server 'nas'
	option name 'NAS'
	option ip '192.0.2.10'
	option mac 'AA:BB:CC:DD:EE:01'
	option user 'root'
	option password 'p@ss w1'

config server 'db'
	option name 'DB'
	option ip '192.0.2.11'
	option mac ''
	option user 'dbuser'
	option password 'pw2'

config task 't_daily_match'
	option schedule 'daily'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'wake'
	option server 'NAS'

config task 't_daily_nomatch'
	option schedule 'daily'
	option hour '$FUT_H'
	option minute '$NOW_M'
	option action 'ping'
	option server 'NAS'

config task 't_disabled'
	option enabled '0'
	option schedule 'daily'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'ping'
	option server 'NAS'

config task 't_weekly_wrong'
	option schedule 'weekly'
	option weekday '$BAD_W'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'ping'
	option server 'NAS'

config task 't_weekly_right'
	option schedule 'weekly'
	option weekday '$NOW_W'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'ping'
	option server 'DB'

config task 't_once_today'
	option schedule 'once'
	option date '$TODAY'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'poweroff'
	option server 'DB'

config task 't_once_future'
	option schedule 'once'
	option date '2099-01-01'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'wake'
	option server 'NAS'

config task 't_missing_mac'
	option schedule 'daily'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'wake'
	option server 'DB'

config task 't_badserver'
	option schedule 'daily'
	option hour '$NOW_H'
	option minute '$NOW_M'
	option action 'wake'
	option server 'NOPE'
EOF

: > $LOG
OUT=$(ucode /usr/local/bin/serverctl-scheduler tick 2>$T/tick.err)
TICK_RC=$?
echo "$OUT" | grep -q "t_daily_match" && break
done
[ $TICK_RC -eq 0 ] && [ ! -s $T/tick.err ] && ok "tick 退出码 0 且无 stderr" || bad "tick 退出码/stderr: $(cat $T/tick.err)"

echo "$OUT" | grep -q "t_daily_match NAS wake"            && ok "daily 匹配任务执行"        || bad "daily 匹配任务执行"
echo "$OUT" | grep -q "t_daily_match.*code=0"            && ok "wake 成功 code=0"          || bad "wake 成功 code=0"
echo "$OUT" | grep -q "t_weekly_right DB ping"           && ok "weekly 星期匹配执行"       || bad "weekly 星期匹配执行"
echo "$OUT" | grep -q "t_once_today DB poweroff"         && ok "once 当日任务执行"         || bad "once 当日任务执行"
echo "$OUT" | grep -q "t_missing_mac DB wake.*mac address missing" && ok "缺 MAC 拒绝唤醒"  || bad "缺 MAC 拒绝唤醒"
echo "$OUT" | grep -q "t_badserver NOPE.*server not found" && ok "未知服务器报错" || bad "未知服务器报错"
echo "$OUT" | grep -q "t_daily_nomatch"                  && bad "非匹配分钟不执行" || ok "非匹配分钟不执行"
echo "$OUT" | grep -q "t_disabled"                       && bad "disabled 任务不执行" || ok "disabled 任务不执行"
echo "$OUT" | grep -q "t_weekly_wrong"                   && bad "weekly 星期不匹配不执行" || ok "weekly 星期不匹配不执行"
echo "$OUT" | grep -q "t_once_future"                    && bad "once 非当日不执行" || ok "once 非当日不执行"
[ $(echo "$OUT" | grep -c .) -eq 5 ] && ok "恰好执行 5 个匹配任务(含 2 个预期失败)" || bad "恰好执行 5 个匹配任务: [$(echo "$OUT" | grep -c .)]"

grep -q "^etherwake -i eth0 AA:BB:CC:DD:EE:01$" $LOG && ok "etherwake 以配置接口+MAC 调用" || bad "etherwake 调用参数: $(cat $LOG)"
grep -q "systemctl poweroff" $LOG                       && ok "poweroff 经 ssh 执行" || bad "poweroff 经 ssh 执行"
grep -Fq "sshpass -p pw2 ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 dbuser@192.0.2.11 systemctl poweroff" $LOG \
	&& ok "ssh 命令行完整(用户/选项/命令正确)" || bad "ssh 命令行完整: $(grep poweroff $LOG)"
grep -q "^ping -c 3 -W 2 192.0.2.11$" $LOG             && ok "ping 参数正确" || bad "ping 参数正确"

# once 任务执行后应删除，其他任务保留
uci -c $T/etc/config -t $T/delta show serverctl 2>/dev/null | grep -q t_once_today \
	&& bad "once 任务已删除" || ok "once 任务已删除"
uci -c $T/etc/config -t $T/delta show serverctl 2>/dev/null | grep -q t_daily_match \
	&& ok "daily 任务保留" || bad "daily 任务保留"

# ---------- 二次 tick: once 已删不再触发 ----------
: > $LOG
OUT2=$(ucode /usr/local/bin/serverctl-scheduler tick 2>&1)
echo "$OUT2" | grep -q "t_once_today" && bad "二次 tick 不再触发 once" || ok "二次 tick 不再触发 once"

# ---------- 全局禁用 ----------
uci -c $T/etc/config -t $T/delta set serverctl.defaults.enabled=0 >/dev/null 2>&1
uci -c $T/etc/config -t $T/delta commit serverctl >/dev/null 2>&1
: > $LOG
OUT3=$(ucode /usr/local/bin/serverctl-scheduler tick 2>&1)
[ -z "$OUT3" ] && ok "defaults.enabled=0 全局禁用" || bad "defaults.enabled=0 全局禁用"
uci -c $T/etc/config -t $T/delta set serverctl.defaults.enabled=1 >/dev/null 2>&1
uci -c $T/etc/config -t $T/delta commit serverctl >/dev/null 2>&1

# ---------- 含空格/引号密码的 ssh 注入防护 ----------
sed '1{/^#!/d}; s/^return {/export default {/' $ROOT/usr/share/rpcd/ucode/serverctl > $T/rpc-svc.uc
uci -c $T/etc/config -t $T/delta set "serverctl.nas.password=p'w x" >/dev/null 2>&1
uci -c $T/etc/config -t $T/delta commit serverctl >/dev/null 2>&1
: > $LOG
ucode -e '
import svc from "/tmp/sc-test/rpc-svc.uc";
let r = svc.serverctl.suspend.call({ args: { server: "NAS" } });
print("code=", r.code);
' > $T/rpc1.out 2>$T/rpc1.err
grep -Fq "sshpass -p p'w x ssh -o StrictHostKeyChecking=no" $LOG \
	&& ok "含引号密码被正确 shell 转义并完整传参" || bad "shell 转义: $(cat $T/rpc1.out $T/rpc1.err) log=$(cat $LOG)"

# ---------- rpcd 模块接口（测试用：去 shebang 并改 return 为 export default）----------
sed '1{/^#!/d}; s/^return {/export default {/' $ROOT/usr/share/rpcd/ucode/serverctl > $T/rpc-svc.uc
uci -c $T/etc/config -t $T/delta set "serverctl.nas.password=pw1" >/dev/null 2>&1
uci -c $T/etc/config -t $T/delta commit serverctl >/dev/null 2>&1
: > $LOG
ucode -e '
import svc from "/tmp/sc-test/rpc-svc.uc";
let m = svc.serverctl;
printf("methods: %s %s %s %s %s\n", type(m.ping), type(m.sshtest), type(m.wake), type(m.suspend), type(m.poweroff));
printf("argtype: %s\n", m.wake.args.server);
let r = m.sshtest.call({ args: { server: "NAS" } });
printf("sshtest-code: %d\noutput: %s", r.code, r.output);
let x = m.ping.call({ args: { server: "GHOST" } });
printf("ghost-code: %d\n", x.code);
' > $T/rpc2.out 2>$T/rpc2.err
grep -q "methods: object object object object object" $T/rpc2.out && ok "rpcd 模块 5 方法结构" || bad "rpcd 模块结构: $(cat $T/rpc2.out $T/rpc2.err)"
grep -q "argtype: string" $T/rpc2.out && ok "args.server 类型 string" || bad "args.server 类型"
grep -q "^sshtest-code: 0$" $T/rpc2.out && grep -q "^output: FAKE-SSH-OUTPUT$" $T/rpc2.out && ok "sshtest 执行成功" || bad "sshtest 执行: $(cat $T/rpc2.out)"
grep -q "ghost-code: 1" $T/rpc2.out && ok "未知服务器返回 code 1" || bad "未知服务器返回码"
grep -q "ssh -o StrictHostKeyChecking=no" $LOG && ok "ssh 命令实际调用" || bad "ssh 命令实际调用"

# ---------- 长驻循环模式冒烟（5 秒不死循环崩溃）----------
timeout 5 ucode /usr/local/bin/serverctl-scheduler >/dev/null 2>$T/loop.err
RC=$?
[ $RC -ge 124 ] && ! grep -qi "error" $T/loop.err && ok "守护循环模式稳定运行 5s" || bad "守护循环模式 rc=$RC $(cat $T/loop.err)"

echo
echo "==== PASS=$PASS FAIL=$FAIL ===="
[ $FAIL -eq 0 ]
