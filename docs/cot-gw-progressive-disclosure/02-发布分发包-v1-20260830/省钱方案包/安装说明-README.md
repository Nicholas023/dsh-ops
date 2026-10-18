# cot-gw-static —— DSH 省钱 Agent 预设（可安装分发包）

**版本**：v1（2026-08-30 发布）｜ **适用**：DeepSeek Harness（DSH）agent-presets 机制
**实测**：任务集费用 0.2124 → 0.1123 元（-47%），6 形态质量全 ✓（见下方数据摘要）

---

## 一、这是什么

一个「固定 7 工具 + 网关路由」的 DSH Agent 预设（preset）。它把模型每次请求携带的**系统提示与工具说明书精简并固定**，并强制**批量执行**习惯，从而：

1. 新会话首步未命中输入 **-79%**（6018 → 1236 token，靠精简人设替换大段注入）；
2. 工具 schema 字节级稳定 → **DeepSeek 前缀缓存命中**（0.05 元/M vs 未命中 1.5 元/M）；
3. 同类动作批量化（一条 PowerShell 循环）→ **API 轮次大减**；
4. 其余能力按需经 gateway 路由（不常驻提示、不丢能力）。

## 二、安装（3 步）

1. 把本包中的 cot-gw-static 目录复制到你的 DSH 配置目录：
   - Windows：%USERPROFILE%\.dsh\.agent-presets\cot-gw-static\
   - 其它平台：$DSH_HOME/.agent-presets/cot-gw-static/（$DSH_HOME 通常为 ~/.dsh）
2. 编辑 $DSH_HOME/settings.yaml：
   agent-presets:
     default: cot-gw-static
3. **开新会话即生效**（预设按会话绑定，无需重启；若未看到新会话，重启 dsh 实例亦可）。

**回退**：把 default 改回 code（或你的原预设 id）即可。

## 三、环境要求与兼容性

- **DSH 版本**：已验证 0.1.1-rc.2；**0.1.2-alpha.1 起 Web API 面与认证变更，本预设的 web 会话兼容性未验证**（alpha 不建议生产使用）；
- **平台**：Windows（PowerShell）与 POSIX（bash）双分支均已内置于 agent.cordis.yml（按平台自动启用对应 shell）；
- **依赖**：仅 DSH 内置组件（minimal 派生，零外部依赖、零网络请求、零凭据读取）；
- **可选插件**：若安装 vision-exp-tile 插件（图像分块识别），vision_tile_recognize 自动进入注入面（原生看图）；未安装则该工具被自动过滤，其余不受影响；
- **技能约定**：预设带 skill_search/skill_load（按需技能发现）。本包不捆绑 SKILL.md；若你有技能目录（$DSH_HOME/skills/）则可用；无技能时这两个工具返回简洁提示。

## 四、行为说明（重要）

模型将以极简人设运行（complete:true 覆盖全局身份与注入）：
- 不再注入 AGENTS.md / 全局指令 / 技能目录——**任务提示词需自包含**（请把关键要求写进你发的消息）；
- 回复语言默认英文风格（极简工程师人设）；需要中文请在消息里写明；
- 硬规则包含：禁止枚举全部环境变量（防凭据泄漏）、子代理同步等待（run_in_background:false）、检索必须递归、完成后必须输出总结文本。

## 五、实测数据摘要（2026-08-30，生产基线对比）

| 指标 | 原默认（code preset） | cot-gw-static | 变化 |
|---|---:|---:|---:|
| 6 任务组合计费用 | 0.2124 元 | 0.1123 元 | **-47.1%** |
| 新会话首步未命中 | 6018 token | 1236 token | -79% |
| 缓存命中率 | 97.5% | 96.8% | 持平 |
| 质量 | 6×✓ | 6×✓（批量/看图/子代理/技能/十轮链） | 无回退 |
| API 轮次 | 15 步 | ~24 步 | 观察项；批处理任务 10 步→2 步 |

## 六、安全与免责

- 本包 mjs 插件：无网络、无凭据、无自身文件写入；转发走宿主完整策略管线；异常均回退（gate 失败→暴露全目录）；
- **建议在隔离/测试环境先行验证再上生产**；
- 如遇个别形态异常：优先检查任务提示词自包含性；必要时回退默认 preset。

## 七、文件清单

| 文件 | 作用 |
|---|---|
| agent.cordis.yml | 预设装配（persona 人设 + shell/文件/工具组 + gateway/mjs 插件行） |
| preset.yml | 预设简介（展示用） |
| gateway.mjs | 网关：list(紧凑)/describe(参数)/call(转发) |
| skill-search.mjs | 技能按需发现（索引+别名+最近似降级+文件系统兜底） |
| tool-gate.mjs | 静态工具面闸（固定 7 工具，前缀稳定） |
| tool-watch.mjs | 新工具增量披露 |
| 省钱思路-通用版.md | 原理与**迁移到其它 AI agent** 的可移植手册 |