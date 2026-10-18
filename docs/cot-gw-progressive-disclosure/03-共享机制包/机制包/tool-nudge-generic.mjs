/**
 * tool-nudge —— 第四种「工具到达方式」：**结果驱动的能力提醒**。
 *
 * ── 为什么需要第四种 ────────────────────────────────────────────────────────
 * 本机现有三条到达路径，解决的都是"工具怎么够得着"：
 *   ① 原生调用   —— schema 在 API `tools` 字段里，直接 emit
 *   ② PTC 子调用 —— 写 run_code 程序，程序里 `await tools.xxx()`
 *   ③ 网关转发   —— gateway({action:'call'}) 转发到抽屉里的工具
 * 但**它们都不解决"在正确的那一秒想起它"**。实证：建筑设计会话里 `read_image`
 * 一直躺在 SDK 里够得着，可 `image_ocr` 在 seq=31 就上了、`read_image` 到 seq=493 才第一次被用；
 * 实测：高频工具全在 run_code，而 `present` 直接调用 0 次。
 * ⇒ 工具够得着 ≠ 会被想起。缺的是**时机**。
 *
 * ── 它怎么做 ────────────────────────────────────────────────────────────────
 * 挂在 `tools/post-execute` 瀑布上（与 `repeat-tool-reminder` 同一条路，已有一等先例）：
 * 工具刚跑完时按规则表检查"刚刚发生了什么"，命中就在**结果之后**追加一条 plugin 消息，
 * 在"事实旁边"说该用哪只手。**不改台面** ⇒ 不动 `tools` 数组 ⇒ 前缀 byte-stable，
 * 只追加消息尾部（`tool-watch` 的注释已论证：仅追加不使既有 KV Cache 条目失效）。
 *
 * ── 设计：一份机制 + N 份规则表 ──────────────────────────────────────────────
 * 引擎在这里，**规则表由挂载方通过 `config.rules` 提供**（可完全写在预设 YAML 里，
 * 因为 `say` 支持字符串模板、正则支持字符串写法）。本文件另导出两份参考规则表：
 *   · `DEFAULT_RULES` —— 通用（看图/交付）
 *   · `DEFAULT_RULES`  —— 通用规则（产出后提醒 present 等）
 *
 * ── 规则字段 ────────────────────────────────────────────────────────────────
 *   id            规则名（节流与事件来源里用它）
 *   when.tool     工具名（字符串或数组）
 *   when.argPath  参数里的路径字段匹配此正则（字符串或 RegExp）
 *   when.codeMatches / when.codeNotMatches   参数里的代码文本匹配/不匹配此正则
 *   skipIfToolUsed  本会话此前调用过该工具则跳过本规则（用于"还没 present 过"这类会话级判断）
 *   minToolCalls   本会话累计工具调用数达到该值才评估本规则（用于"干了一会儿却还没立计划"这类时机判断）
 *   maxPerSession 每条规则每个会话最多触发次数（默认 1）
 *   say           提醒文案：字符串模板（`{path}`/`{tool}`/`{calls}` 占位）或 (view) => string
 *
 * ── 设计约束 ────────────────────────────────────────────────────────────────
 * · **只提醒，绝不阻断**：不返回 `kind:'block'`，不改 `content`，只加 `additionalContexts`；
 * · **节流** + **失败静默** + **按 agent 分键**（父子代理互不干扰）。
 *
 * ── 它治不了什么（如实）────────────────────────────────────────────────────
 * post-execute 只能看见"刚跑完的那一次调用" ⇒ **看不见"模型压根没调用任何工具"的情形**，
 * 也看不见"模型在正文里声称做了却没做"（那是 assistant 文本，不是工具调用）。
 * 这两类仍需 persona 自检条款与外部验收判据兜底。
 */

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'tool-nudge'

/** 有意不 inject：监听器只在事件发生时取服务。 */
export const inject = []

/** 通用规则表（看图 / 交付）。 */
export const DEFAULT_RULES = [
  {
    id: 'image-produced',
    when: { tool: ['write', 'edit', 'str_replace_editor'], argPath: '\\.(png|jpe?g|webp|gif|pdf|dxf)$' },
    maxPerSession: 3,
    say: '你刚写出了 {path}。它是图/PDF —— 用 read_image 亲眼看一遍再交付（不要用 image_ocr 代替，它认不出图形错误），确认无误后调 present 让用户在 GUI 里拿到链接。',
  },
  {
    id: 'ocr-instead-of-looking',
    when: { tool: ['image_ocr', 'vision_analyze', 'image_scan'] },
    maxPerSession: 2,
    say: 'OCR/插件视觉只回文字与坐标，认不出「墙线错位 / 标注被压住 / 比例失真」这类图形错误。如果这是你自己刚出的图，你有 read_image —— 直读一眼比 OCR 更可靠。',
  },
  {
    id: 'artifacts-then-present',
    when: { tool: ['pwsh', 'run_code'], codeMatches: 'matplotlib|savefig|ezdxf|reportlab' },
    skipIfToolUsed: 'present',
    maxPerSession: 2,
    say: '这次调用像是在产出文件。产出完成后记得调 present 登记为交付物 —— 只在回复里写路径，用户是找不到的。',
  },
]


/** 从工具参数里取出"路径"类字段（不同工具的取名不一样）。 */
function pathOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  for (const k of ['file_path', 'path', 'filePath', 'target', 'output']) {
    const v = args[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

/** 从工具参数里取出代码文本（run_code 的 `code`）。 */
function codeOf(args) {
  if (args === null || typeof args !== 'object') return ''
  return typeof args.code === 'string' ? args.code : ''
}

/** 正则判据：接受字符串（YAML 友好）或 RegExp。 */
function rx(value) {
  if (value === undefined || value === null) return undefined
  if (value instanceof RegExp) return value
  try { return new RegExp(String(value), 'i') } catch { return undefined }
}

/** 文案渲染：函数直接用，字符串按 `{key}` 占位替换。 */
function render(say, view) {
  if (typeof say === 'function') return String(say(view))
  return String(say ?? '').replace(/\{(\w+)\}/g, (_m, k) => (view[k] === undefined ? '' : String(view[k])))
}

/** 注册结果驱动的能力提醒。 */
export function apply(ctx, config) {
  const rules = Array.isArray(config?.rules) && config.rules.length > 0 ? config.rules : DEFAULT_RULES
  /** agent → Map<ruleId, 已触发次数>。 */
  const fired = new WeakMap()
  /** agent → 本会话此前调用过的工具名集合（供 skipIfToolUsed 判断）。 */
  const usedTools = new WeakMap()
  /** agent → 本会话累计工具调用次数（供 minToolCalls 判断）。 */
  const callCounts = new WeakMap()

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next()   // 先让下游定夺，本插件只做追加
    try {
      if (decision.kind === 'block') return decision
      const agent = exec?.agent
      if (agent === undefined) return decision

      let used = usedTools.get(agent)
      if (used === undefined) { used = new Set(); usedTools.set(agent, used) }
      let counter = fired.get(agent)
      if (counter === undefined) { counter = new Map(); fired.set(agent, counter) }
      // 计数**含本次**：minToolCalls:4 表示"这是第 4 次调用时"开始评估。
      const calls = (callCounts.get(agent) ?? 0) + 1
      callCounts.set(agent, calls)

      const code = codeOf(exec.arguments)
      const path = pathOf(exec.arguments)

      const hit = []
      for (const rule of rules) {
        const w = rule.when ?? {}
        if (rule.minToolCalls !== undefined && calls < rule.minToolCalls) continue
        if (w.tool !== undefined) {
          const names = Array.isArray(w.tool) ? w.tool : [w.tool]
          if (!names.includes(exec.name)) continue
        }
        const rPath = rx(w.argPath)
        if (rPath !== undefined && (typeof path !== 'string' || !rPath.test(path))) continue
        const rCode = rx(w.codeMatches)
        if (rCode !== undefined && !rCode.test(code)) continue
        const rNot = rx(w.codeNotMatches)
        if (rNot !== undefined && rNot.test(code)) continue
        if (rule.skipIfToolUsed !== undefined && used.has(rule.skipIfToolUsed)) continue
        const n = counter.get(rule.id) ?? 0
        if (n >= (rule.maxPerSession ?? 1)) continue
        counter.set(rule.id, n + 1)
        hit.push(rule)
      }
      // 在判定**之后**登记本次工具：这样 skipIfToolUsed 的语义是"本会话此前用过"。
      if (typeof exec.name === 'string') used.add(exec.name)

      if (hit.length === 0) return decision

      const view = { path, tool: exec.name, calls }
      const text = '（能力提醒 · 由上一步的结果触发）\n' + hit.map((r) => '· ' + render(r.say, view)).join('\n')
      const nudge = {
        id: `tool-nudge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: name, form: 'notice', summary: hit.map((r) => r.id).join(',') },
      }
      const prior = decision.additionalContexts ?? []
      return { ...decision, additionalContexts: [nudge, ...prior] }
    } catch (error) {
      try { ctx.logger.warn('%s: %s', name, String((error && error.message) || error)) } catch { /* logger 可能不在 */ }
      return decision
    }
  }, { prepend: true })
}
