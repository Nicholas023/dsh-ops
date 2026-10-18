# 在 3085 环境侧执行：备份 → 替换 5 份预设 → 校验 → 打印改动清单
#
# 由 Agent预设创作 会话产出（2026-09-11），交 3085环境 · 升级验证 执行。
# 用法：
#   pwsh -File 应用并验证.ps1
#   pwsh -File 应用并验证.ps1 -DshHome "D:\DSH-Files\03-隔离环境\3085-升级验证\dsh-home"
#
# 红线：本脚本只碰 3085 的 DSH_HOME；不碰生产 C:\Users\HP\.dsh\
param(
  [string]$DshHome = "D:\DSH-Files\03-隔离环境\3085-升级验证\dsh-home",
  [string]$PackageDir = "D:\DSH-Files\02-DSH开发\Agent预设创作\预设\3085-验证包"
)

$names = @('cot-gw-static','cot-gw-arch','cot-gw-dev','cot-gw-deliver','cot-gw-kaogong')
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$rows = @()

Write-Host "=== ① 落地前先确认这是 3085（不是生产）==="
Write-Host "  DSH_HOME = $DshHome"
if ($DshHome -like "*\.dsh*" -and $DshHome -notlike "*3085*") { Write-Host "  ✗ 目标看起来像生产 home，拒绝执行"; exit 1 }
if (-not (Test-Path $DshHome)) { Write-Host "  ✗ DSH_HOME 不存在"; exit 1 }
Write-Host "  ✓ 目标合法（含 3085）"

Write-Host "`n=== ② 逐份备份 + 替换 ==="
foreach ($n in $names) {
  $dst = Join-Path $DshHome ".agent-presets\$n\agent.cordis.yml"
  $src = Join-Path $PackageDir "$n\agent.cordis.yml"
  if (-not (Test-Path $dst)) { Write-Host "  - $n ：目标不存在，跳过"; continue }
  if (-not (Test-Path $src)) { Write-Host "  ! $n ：包内缺文件，跳过"; continue }

  $beforeMd5  = (Get-FileHash $dst -Algorithm MD5).Hash
  $beforeLen  = (Get-Item $dst).Length
  $bak = "$dst.bak-$stamp"
  Copy-Item $dst $bak -Force

  Copy-Item $src $dst -Force
  $afterMd5 = (Get-FileHash $dst -Algorithm MD5).Hash
  $afterLen = (Get-Item $dst).Length

  $rows += [PSCustomObject]@{
    预设 = $n; 改前MD5 = $beforeMd5.Substring(0,12); 改前字节 = $beforeLen
    改后MD5 = $afterMd5.Substring(0,12); 改后字节 = $afterLen; 备份 = (Split-Path $bak -Leaf)
  }
}
$rows | Format-Table -AutoSize

Write-Host "`n=== ③ 改后自查：group 是否禁用、两行是否补上、门控是否为平台表达式 ==="
foreach ($n in $names) {
  $f = Join-Path $DshHome ".agent-presets\$n\agent.cordis.yml"
  if (-not (Test-Path $f)) { continue }
  $t = [IO.File]::ReadAllText($f, [Text.UTF8Encoding]::new($false))
  $groupOff = $t -match "(?s)- id: persistent-shell\r?\n\s+name: cordis:group\r?\n\s+#[^\r\n]*\r?\n\s+disabled: true"
  $hasPwsh  = $t -match "(?s)- id: tool-pwsh\r?\n\s+name: '@deepseek-ai/dsh-tool-pwsh'\r?\n\s+disabled: \!\!js process\.platform !== 'win32'"
  $hasBash  = $t -match "(?s)- id: tool-bash\r?\n\s+name: '@deepseek-ai/dsh-tool-bash'\r?\n\s+disabled: \!\!js process\.platform === 'win32'"
  $literalFalse = $t -match "(?s)- id: (persistent-pwsh|persistent-bash)\r?\n\s+name: '[^']+'\r?\n\s+disabled: false"
  "  {0,-16} group已禁={1,-6} 补tool-pwsh={2,-6} 补tool-bash={3,-6} 有字面false={4}" -f $n, $groupOff, $hasPwsh, $hasBash, $literalFalse
}
Write-Host "`n（判据：group已禁=True、补两行=True、有字面false=False）"
Write-Host "`n=== ④ 下一步：重启 3085 实例，确认插件全部加载、无 fail-fast ==="
Write-Host "  重启后请把启动日志里的加载清单贴进回执；再按 E0/E1 那套做黑盒验证。"
