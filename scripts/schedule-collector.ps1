# 注册 / 卸载 / 查看 StarryStudy 采集计划任务。无需管理员（当前用户登录时触发）。
# 用法（PowerShell）：
#   .\scripts\schedule-collector.ps1                    # 默认每 1 小时
#   .\scripts\schedule-collector.ps1 -IntervalHours 2   # 改成每 2 小时
#   .\scripts\schedule-collector.ps1 -Status            # 查看状态与上次结果
#   .\scripts\schedule-collector.ps1 -Uninstall        # 取消自动抓取
#
# 为什么用「登录时 + 每 N 小时重复」而不是 AtStartup：AtStartup 需要管理员/SYSTEM，
# 而且开机瞬间往往还没联网，登录后再跑成功率更高；重复间隔覆盖「开机状态下持续抓」。
param(
  [ValidateRange(1, 24)][int]$IntervalHours = 1,
  [switch]$Status,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "StarryStudy-BB-Collect"
$runScript = Join-Path $PSScriptRoot "collect-scheduled.ps1"
$root = Split-Path -Parent $PSScriptRoot

# 探测 node 绝对路径，作为固定参数传给包装脚本，避免任务会话 PATH 不同
$node = ""
foreach ($c in @("D:\nodejs\node.exe", "C:\Program Files\nodejs\node.exe", (Get-Command node -ErrorAction SilentlyContinue).Source)) {
  if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break }
}
if (-not $node) { Write-Error "找不到 node.exe，请先安装 Node.js 或把路径写进脚本"; exit 1 }

if ($Uninstall) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "已删除计划任务 $TaskName，自动抓取已关闭。"
  } else {
    Write-Output "任务 $TaskName 不存在，无需删除。"
  }
  exit 0
}

if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Output "任务 $TaskName 未注册。"; exit 1 }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Output ("状态       : " + $t.State)
  Write-Output ("触发器     : " + (($t.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ", "))
  Write-Output ("重复间隔   : PT" + $IntervalHours + "H（当前脚本默认值）")
  Write-Output ("上次运行   : " + $info.LastRunTime)
  Write-Output ("上次结果   : " + $info.LastTaskResult)
  Write-Output ("下次运行   : " + $info.NextRunTime)
  Write-Output ("日志文件   : " + (Join-Path $root "data\collector.log"))
  exit 0
}

if (-not (Test-Path -LiteralPath $runScript)) { Write-Error "缺少 $runScript"; exit 1 }

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runScript + '" -NodePath "' + $node + '"'

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $root

# 登录时立即跑一次；之后每 N 小时重复一次，持续到注销/关机。
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

# IgnoreNew：上一次还在跑就不启动第二个实例（配合采集器入口的原子锁）
# StartWhenAvailable：错过（关机/睡眠）后尽快补跑一次
# ExecutionTimeLimit 30 分钟：防单次卡死拖到下个周期
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action `
  -Trigger @($tLogon, $tRepeat) -Settings $settings `
  -Description "StarryStudy 开机登录后自动抓取 Blackboard，之后每 $IntervalHours 小时抓取一次" `
  -Force | Out-Null

Write-Output "已注册 $TaskName：登录时抓取一次，之后每 $IntervalHours 小时一次。"
Write-Output "改间隔：.\scripts\schedule-collector.ps1 -IntervalHours 2"
Write-Output "查看：  .\scripts\schedule-collector.ps1 -Status"
Write-Output "取消：  .\scripts\schedule-collector.ps1 -Uninstall"
Write-Output "日志：  $root\data\collector.log"
