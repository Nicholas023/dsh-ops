#!/usr/bin/env node
/**
 * 校验.mjs —— 校验「3085 验证包」的 5 份 yml 是否改了该改的、且没改不该改的。
 *
 * 判据（全部为硬判据，任一不满足即失败）：
 *   ① YAML 能解析（`!!js` 标签先替换为普通文本再解析），顶层是非空行数组；
 *   ② `persistent-shell` 这个 group 行的 `disabled === true`（**整组禁用**，不是只禁一行）；
 *   ③ 补上了 `tool-pwsh` / `tool-bash` 两行，且 `disabled` 是**平台表达式**：
 *        tool-pwsh → 含 `!== 'win32'`（Windows 上启用）
 *        tool-bash → 含 `=== 'win32'`（Windows 上禁用）
 *   ④ **没有**把 persistent-pwsh / persistent-bash 的 disabled 写成**字面 false**
 *      （09-11 出过事故：字面 false 会让 persistent-bash 在 Windows 上无条件启用）。
 *
 * 用法：node 校验.mjs [包目录]
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire('file:///C:/Users/HP/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/package.json');
const YAML = require('yaml');
const BASE = process.argv[2] ?? 'D:/DSH-Files/02-DSH开发/Agent预设创作/预设/3085-验证包';
const NAMES = ['cot-gw-static', 'cot-gw-arch', 'cot-gw-dev', 'cot-gw-deliver', 'cot-gw-kaogong'];

let allOk = true;
for (const n of NAMES) {
  const p = join(BASE, n, 'agent.cordis.yml');
  if (!existsSync(p)) { console.log('  ✗ ' + n + ' ：缺文件 ' + p); allOk = false; continue; }
  const t = readFileSync(p, 'utf8');

  let rows = null, err = null;
  try { rows = YAML.parse(t.replace(/!!js /g, '')); } catch (e) { err = e.message; }
  const list = Array.isArray(rows) ? rows : [];
  const g = list.find((r) => r && r.id === 'persistent-shell');
  const pw = list.find((r) => r && r.id === 'tool-pwsh');
  const ba = list.find((r) => r && r.id === 'tool-bash');

  // 字面 false 检查：只在 persistent-* 两行上查（这两个才是事故点）
  const literalFalse = /- id: (persistent-pwsh|persistent-bash)[\s\S]{0,200}?disabled: false/.test(t);

  const c1 = !err && list.length > 0;
  const c2 = !!g && g.disabled === true;
  const c3 = !!pw && !!ba;
  const c4 = c3 && String(pw.disabled).includes("!== 'win32'") && String(ba.disabled).includes("=== 'win32'");
  const c5 = !literalFalse;
  const ok = c1 && c2 && c3 && c4 && c5;
  if (!ok) allOk = false;

  console.log('  ' + (ok ? '✓' : '✗') + ' ' + n.padEnd(16) +
    ' 顶层行=' + String(list.length).padStart(3) +
    ' YAML=' + (c1 ? '✓' : '✗ ' + String(err).slice(0, 50)) +
    ' group.disabled=' + (g ? JSON.stringify(g.disabled) : '缺失') +
    ' tool-pwsh=' + (pw ? JSON.stringify(pw.disabled) : '缺失') +
    ' tool-bash=' + (ba ? JSON.stringify(ba.disabled) : '缺失') +
    ' 字面false=' + literalFalse);
}
console.log('\n  总判定：' + (allOk ? '全部通过 ✅' : '存在问题 ❌'));
process.exit(allOk ? 0 : 1);
