# 计划任务实际执行的包装：负责日志轮转、固定 node 路径、带时间戳记录。
# 为什么单独一层：计划任务会话的 PATH 与交互窗口不同，直接 npm run 常常找不到 node；
# stdout 也没人看，失败必须落到文件里才能事后排查。单实例保护在采集器入口（Node 层），
# 同时计划任务设置 IgnoreNew 双保险，避免上一次没跑完下一次又启动。
#
# 注意：本文件必须带 UTF-8 BOM。PowerShell 5.1 读无 BOM 的 .ps1 会按 GBK 解码，
# 脚本里的中文字符串（连日志标题）都会变乱码。采集器输出走 Start-Process 的字节级
# 重定向，绕开 PowerShell 对 native stdout 的编码转换，中文课程名才不会花掉。
param(
  [string]$NodePath = ""
)

$ErrorActionPreference = "Continue"
$enc = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$logDir = Join-Path $root "data"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$log = Join-Path $logDir "collector.log"

# 无人值守会跑几年，日志不能无限长：超过 512KB 只保留后半段。
if (Test-Path -LiteralPath $log) {
  try {
    if ((Get-Item -LiteralPath $log).Length -gt 512KB) {
      $text = [IO.File]::ReadAllText($log, $enc)
      $keep = if ($text.Length -gt 256000) { $text.Substring($text.Length - 256000) } else { $text }
      [IO.File]::WriteAllText($log, "[日志已裁剪，仅保留最近部分]`r`n" + $keep, $enc)
    }
  } catch { }
}

# 绝对路径的 node，不依赖任务会话的 PATH；没传就按常见位置探测。
$node = $NodePath
if (-not $node -or -not (Test-Path -LiteralPath $node)) {
  $candidates = @(
    "D:\nodejs\node.exe",
    "C:\Program Files\nodejs\node.exe",
    (Get-Command node -ErrorAction SilentlyContinue).Source
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break }
  }
}

$start = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
[IO.File]::AppendAllText($log, "`r`n===== $start 开始 =====`r`n", $enc)

if (-not $node -or -not (Test-Path -LiteralPath $node)) {
  [IO.File]::AppendAllText($log, "找不到 node.exe，采集未执行。NodePath=$NodePath`r`n", $enc)
  exit 1
}

# 交给 cmd.exe 做字节级重定向，绕开 PowerShell 对 native stdout 的编码转换
# （否则中文课程名按 GBK 解码会花）。也不用 Start-Process：本机同时存在
# HTTPS_PROXY 与 https_proxy，PS5.1 构建环境字典会抛「关键字冲突」直接失败。
# 临时 .cmd 用纯 ASCII 写，避免批处理代码页把中文路径/注释弄乱。
$tmpOut = Join-Path $logDir "collector.out.tmp"
$tmpErr = Join-Path $logDir "collector.err.tmp"
$batch = Join-Path $logDir "collector-run.cmd"
foreach ($f in @($tmpOut, $tmpErr)) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }

# 用单个 here-string 生成整份批处理，避免数组拼接把路径拆成多行
$batchText = @"
@echo off
cd /d "$root"
"$node" --import ./scripts/load-env.mjs --import tsx packages/collector/src/index.ts > "$tmpOut" 2> "$tmpErr"
exit /b %ERRORLEVEL%
"@
[IO.File]::WriteAllText($batch, $batchText, [Text.Encoding]::ASCII)

& cmd.exe /c "`"$batch`""
$code = $LASTEXITCODE
Remove-Item -LiteralPath $batch -Force -ErrorAction SilentlyContinue

foreach ($f in @($tmpOut, $tmpErr)) {
  if (Test-Path -LiteralPath $f) {
    try {
      [IO.File]::AppendAllText($log, [IO.File]::ReadAllText($f, $enc), $enc)
    } catch { }
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  }
}

$end = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
[IO.File]::AppendAllText($log, "===== $end 结束（退出码 $code）=====`r`n", $enc)
exit $code
