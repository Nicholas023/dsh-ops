# 3085 验证包 · cot-gw-* 一次性 shell 栈（2026-09-11）

> 产出：`Agent预设创作` 会话 ｜ 派单：统括官（2026-09-11 20:12「批准·限量」）
> 用途：把 **3085 环境**那份 DSH_HOME 下的 5 份 `cot-gw-*` 预设，换成与内置 `standard` / `cordis` 同款的一次性 shell 栈。
> ⚠️ 本包**不含**生产目录的任何写入；生产 `C:\Users\HP\.dsh\.agent-presets\` **未被改动**。

## 一、为什么改

统括官今晚的双向对照结论：**DSH 后端僵死（HTTP 全超时 2~5 分钟）病在「持久 shell（persistent-shell + PTY）」，不在 pwsh 本身。**

- **行为对照**：`cordis`（一次性 `tool-pwsh`）连跑 3 次 pwsh 正常；5 个 `cot-gw-*`（持久 PTY）反复卡死。
- **代码对照**（一次性路径上一个都没有）：
  1. `dsh-tool-pwsh-persistent.executeCommand`：`while(true)` 轮询、`POLL_INTERVAL_MS=25`，每轮 `read({offset:0,count:1000})` **读整屏**；
  2. `dsh-terminal-bash.read()`：每次 `snapshot().text.split("\n")` 再 join；
  3. `retainedScrollback()`：同步 `while` 分页读完**整个 scrollback**，循环里 `pages.unshift()`；
  4. `utf8Tail()`：超限时 `Array.from(text)` 把整串拆成**逐字符数组**；
  5. `dsh-subprocess-local.inspectForeground()`：**每 50ms** 一次 `inspector.snapshot()`（枚举进程树）。
- **与实测互相印证**：持久版每次调用**固定开销 3.6s**（716 样本，中位 4076ms、最小 3624ms，与命令长度无关）；一次性版 0.8s；`run_code` 0.05s。

## 二、每份改了什么（两处）

**① 整组禁用** `persistent-shell`（组内含 `pty` / `terminal-bash` / `persistent-bash` / `terminal-pwsh` / `persistent-pwsh` 五行 —— 不是只禁一行）：

```yaml
- id: persistent-shell
  name: cordis:group
  # 整组禁用：持久 PTY shell 是后端僵死根源（见交付说明）；组内保留以便回退
  disabled: true
  group: true
  isolate:
    terminals: true
  config:
    ...
```

**② 补上一次性 shell 两行**（照抄内置 `standard` 预设，门控为**平台表达式**）：

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'
```

### 为什么"只禁不补"会出事（09-11 已踩过）
`dsh-web-app\cordis.patch.yml` L368–390 已把 base 的 `tool-bash` / `tool-pwsh` / `tool-fs` / `tool-fs-search` 全部 `disabled: true`（"交给预设提供"）⇒ **预设是唯一提供者**。只禁持久版而不补一次性版，台面上会**彻底没有 pwsh**，且 `tool-gate` 的 `∩ available` 会**静默剔除**、不报错。

### 门控必须写平台表达式
曾把 `disabled:` 写成字面 `false`，导致 `persistent-bash` 在 Windows 上被无条件启用（本机没有 bash 后端）⇒ 挂载风险。**本次两行都用 `!!js` 平台表达式**，脚本里也专门校验"有无字面 false"。

## 三、怎么落地（二选一）

**A. 交统括官 → 由统括官派 3085 环境会话执行**（隔离环境各归其主；按 2026-09-12 等级制度，跨会话派活必经统括官）：

```powershell
pwsh -File "D:\DSH-Files\02-DSH开发\Agent预设创作\预设\3085-验证包\应用并验证.ps1"
```

脚本会：确认目标是 3085、逐份**备份**（`.bak-<时分>`）、替换、打印**改前/改后 MD5 + 字节数**、自查 group 是否禁用/两行是否补上/有无字面 `false`。

**B. 由用户或统括官直接操作**：把 `预设\3085-验证包\<预设名>\agent.cordis.yml` 复制到
`<3085 的 DSH_HOME>\.agent-presets\<预设名>\`（覆盖前先备份）。

## 四、落地后要交的三样证据

1. **改动清单**：文件路径 + 改前/改后 MD5 + 字节数 + 备份路径（`应用并验证.ps1` 直接打印）；
2. **3085 重启后能起来的证据**：启动日志里插件**全部加载、无 fail-fast**；
3. 结论：**「3085 已就绪，可验证」** —— 随后由 `3085环境 · 升级验证` 跑黑盒验证。

## 五、红线（本包遵守）

- 只针对 3085 的 DSH_HOME；**生产 `C:\Users\HP\.dsh\.agent-presets\` 一个字未动**，3080 未重启、未验证；
- 未顺手改 `coord` / `cordis` / `standard` / `ptc`；
- 还原判定**只认哈希不认时间**（复制出来的备份会保留源文件的 `LastWriteTime`，今天已踩过这个坑）。
