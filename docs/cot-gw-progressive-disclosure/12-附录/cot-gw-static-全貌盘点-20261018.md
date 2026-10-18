# cot-gw-static（网关路由模式）项目全貌盘点

> 盘点日期：2026-10-18 ｜ 触发：与 dsh-ops issue #261 的「渐进式披露」原则对照
> 判据：全部事实来自文件本体（timestamps / 源码注释 / 文档），不采信自述

## 一、一句话定性

**cot-gw =「网关路由模式」= 一套 DSH agent 预设机制**：把模型可见工具面压到「固定小台面（居民工具）」，其余能力全部藏到一个 `gateway` 工具后面（list/describe/call 全目录转发），配合静态工具面（前缀缓存命中）/ 增量披露 / 技能按需发现，实现渐进式披露——**「能力常在、说明书不常驻」**。这正是 issue #261 里作者写的「渐进式披露获得高级能力」的既有落地。

## 二、核心机制（实现层，4 个 .mjs + 装配 yml）

| 文件 | 作用 |
| --- | --- |
| `tool-gate.mjs` | **静态工具面闸**：把请求的 tool 目录钉死在 resident 集合，每步 schema 不变 → 请求前缀字节级稳定 → 吃到供应商 prefix cache 折扣价。注释自证它是更早 dynamic cot-gw（LRU retireRounds 退役可解锁工具）的缓存稳定改良版 |
| `gateway.mjs` | **网关**：唯一模型入口。`{"action":"list"}` 输出全目录 + 参数 schema（紧凑），`{"action":"call","tool":...,"args":...}` 转发执行；走宿主注册表完整策略管线（pre-execute/approval/dispatch/finalization），**不绕过** |
| `tool-watch.mjs` | **新工具增量披露**（动态能力渐进露出） |
| `skill-search.mjs` | 技能按需发现：紧凑索引 + 别名 + 最近似降级 + 文件系统兜底 |
| `agent.cordis.yml` / `preset.yml` | 预设装配（persona + 组件行 + gateway/tool-gate/tool-watch 插件行） |

## 三、实测效果（2026-08-30，生产基线对比，来自安装说明 README）

| 指标 | 原默认（code） | cot-gw-static | 变化 |
| --- | ---: | ---: | ---: |
| 6 任务组合计费用 | 0.2124 元 | 0.1123 元 | **-47.1%** |
| 新会话首步未命中 | 6018 token | 1236 token | **-79%** |
| 缓存命中率 | 97.5% | 96.8% | 持平 |
| 质量 | 6×✓ | 6×✓ | 无回退 |

方法论已抽象为平台无关手册（四个杠杆：精简系统提示 / 前缀字节稳定 / 动作批处理 / 按需路由工具），含避坑清单与验证协议。

## 四、分布位置（散落 5 处，这就是「不成体系」的现状）

1. **原始包（归档）**：`12-归档/cot-gw-static/`
   - `v4.2-backup/`、`v4.3-backup/`、`win适配版v4.3/`（版本链）
   - `省钱方案包/`：可分发包 + `cot-gw-static-省钱方案-v1-20260830.zip` + `安装说明-README.md` + `省钱思路-通用版.md`
2. **共享机制包**：`02-DSH开发/Agent预设创作/legacy-presets/dsh-cot-gw-static/`（一份机制、零复制，被各预设引用；含 tool-nudge 及其 generic 版）
3. **变体预设**：`legacy-presets/cot-gw-*` 与 `预设/cot-gw-*`（arch 建筑设计 / deliver 交付协调 / dev 开发 / kaogong 考公复习 / static 基座 v4.3）——只改 resident，共用四个实现文件
4. **发展形态（统括官）**：`legacy-presets/coord/`（agent.cordis.yml 522 行）——台面 12 项 + gateway 抽屉；persona 11~12 条岗位规则；tool-nudge 6 条结果驱动提醒；装配头注释逐条自证机制来自 dsh-cot-gw-static（一份机制、零复制）
   （注：你说的「agent.md 残留」实际载体为 legacy-presets/coord/ 的 agent.cordis.yml + preset.yml；全盘未找到名为 agent.md 的独立文件）
5. **打包/验证**：`预设/3085-验证包/`（README + 应用并验证.ps1 + 校验.mjs + 5 个 cot-gw 变体）

另有备份链：`legacy-presets.bak-20260926-114257` / `bak-20260926-114854`；生成器：`make-variant.mjs`（t17 系列）、`make-coord.mjs`（**已失效**，改手工维护）、`make-3085-package.mjs`。

## 五、时间线（据文件 mtime）

- 2026-08-17：tool-watch.mjs 初代
- 2026-08-29~30：tool-gate 静态版 + gateway.mjs；08-30 省钱方案包 v1 发布（生产 3080 实装）
- 2026-09-11~23：tool-nudge（9-11）→ tool-nudge-generic（9-16）→ skill-search 重写（9-22）
- 2026-09-16：统括官 persona「一次瘦到底」−62%（20607 → 7817 B）；arch/deliver/dev/kaogong 变体生成
- 2026-09-26~27：legacy-presets 归档（bak 拆出），`预设/` 新目录 + 3085-验证包

## 六、与 dsh-ops #261 的关联

- #261 原则③「使用渐进式披露获得高级能力」= 本项目的 gateway 抽屉机制（能力常在、说明书不常驻）；
- 原则②「追加附加工具、copy 复用原版实现」与「轻量化、低侵入」= 本项目的既有一贯风格；
- 区别：cot-gw 是「一套预设内按需路由工具」；#261 的范围更大——0.4.0 把 Native 与 PTC 两套执行层彻底分方案（前者已在本机实践中被验证是省钱正道，作者在 261 里把它上升为项目原则）。
