# 重启 DeepSeek Harness（改了插件代码之后用）。
#   先让它正常退出（和关机时一样：关后台、不弹确认），30 秒还没退就结束进程。再通过 explorer 启动（不挂在调用者的进程下面，
#   调用的终端或 agent 结束了 DSH 也不会跟着关）。最后等 DSH 的后台起来；装了 B站伙伴、开了收件箱的，
#   再等它查一次收件箱，确认插件已经加载。
# 用法：pwsh -File dev/restart-dsh.ps1 [-Exe <DeepSeek Harness.exe 路径>] [-Force] [-TimeoutSec 90]
#   -Force：不等正常退出，直接结束进程。
# 注意：重启会打断她正在进行的对话（比如 QQ 里正在回的一轮）。
param(
  [string]$Exe = '',
  [switch]$Force,
  [int]$TimeoutSec = 90
)
$ErrorActionPreference = 'Stop'
$name = 'DeepSeek Harness'

function Get-Dsh { @(Get-Process -Name $name -ErrorAction SilentlyContinue) }

# 找程序路径：优先用正在运行的那个，其次是默认安装位置
$running = Get-Dsh
if (-not $Exe) {
  $Exe = ($running | Where-Object { $_.Path } | Select-Object -First 1).Path
  if (-not $Exe) { $Exe = Join-Path $env:LOCALAPPDATA "Programs\$name\$name.exe" }
}
if (-not (Test-Path $Exe)) { throw "找不到 DSH 程序：$Exe（用 -Exe 指定）" }

# 正常退出：DSH 的关闭按钮只是缩到托盘；它在 Windows 结束会话（关机、注销）时才让窗口真的关掉，
# 然后走正常退出（先关后台，不弹「有任务在跑」的确认）。这里给它的窗口发同样的 WM_ENDSESSION 再关窗口。
# 窗口缩在托盘里时 Process.MainWindowHandle 是 0，所以按进程号枚举顶层窗口。
Add-Type -Namespace DshRestart -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder s, int n);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint msg, System.IntPtr w, System.IntPtr l, uint flags, uint timeout, out System.IntPtr result);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr w, System.IntPtr l);
'@
function Get-Windows([int[]]$Ids) {
  $found = [System.Collections.Generic.List[IntPtr]]::new()
  $cb = [DshRestart.Win+EnumProc]{
    param($h, $l)
    $wpid = [uint32]0
    [void][DshRestart.Win]::GetWindowThreadProcessId($h, [ref]$wpid)
    if ($Ids -contains [int]$wpid) {
      $sb = [System.Text.StringBuilder]::new(64)
      [void][DshRestart.Win]::GetClassName($h, $sb, 64)
      if ($sb.ToString() -eq 'Chrome_WidgetWin_1') { $found.Add($h) }
    }
    $true
  }
  [void][DshRestart.Win]::EnumWindows($cb, [IntPtr]::Zero)
  $found
}

$started = Get-Date
if ($running.Count) {
  if (-not $Force) {
    $wins = Get-Windows ($running | ForEach-Object Id)
    $r = [IntPtr]::Zero
    foreach ($w in $wins) { [void][DshRestart.Win]::SendMessageTimeout($w, 0x0016, [IntPtr]1, [IntPtr]::Zero, 0x0002, 3000, [ref]$r) }   # WM_ENDSESSION(TRUE)，SMTO_ABORTIFHUNG
    foreach ($w in $wins) { [void][DshRestart.Win]::PostMessage($w, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }                          # WM_CLOSE
    Write-Host "让 DSH 正常退出（$($wins.Count) 个窗口）…"
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Dsh).Count -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  }
  $left = Get-Dsh
  if ($left.Count) {
    Write-Host ($Force ? '结束 DSH 进程…' : '30 秒内没有正常退出，结束进程…')
    $left | Stop-Process -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Dsh).Count -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    if ((Get-Dsh).Count) { throw 'DSH 进程关不掉' }
  }
  Write-Host "已关闭 DSH（$([int]((Get-Date) - $started).TotalSeconds) 秒）"
} else {
  Write-Host 'DSH 没在运行，直接启动'
}

$launched = Get-Date
Start-Process -FilePath explorer.exe -ArgumentList "`"$Exe`""

# 等后台（带 --expose-internals 的那个进程）起来
$deadline = $launched.AddSeconds($TimeoutSec)
$backend = $null
while (-not $backend -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  $backend = Get-CimInstance Win32_Process -Filter "Name='$name.exe'" | Where-Object { $_.CommandLine -match '--expose-internals' } | Select-Object -First 1
}
if (-not $backend) { throw "DSH 在 $TimeoutSec 秒内没有起来" }
Write-Host "DSH 已启动（$([int]((Get-Date) - $launched).TotalSeconds) 秒）"

# B站伙伴：收件箱开着的话，等它在重启后查一次，说明插件加载好了
$cfgFile = Join-Path $HOME '.dsh\bili-eyes.json'
$inboxFile = Join-Path $HOME '.dsh\bili-eyes\inbox.json'
if ((Test-Path $cfgFile) -and (Test-Path $inboxFile) -and ((Get-Content $cfgFile -Raw | ConvertFrom-Json).inboxOn)) {
  $since = [DateTimeOffset]::new($launched).ToUnixTimeMilliseconds()
  $ok = $false
  while (-not $ok -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    try { $ok = (Get-Content $inboxFile -Raw | ConvertFrom-Json).lastPoll -gt $since } catch { }
  }
  if ($ok) { Write-Host "B站伙伴已加载（收件箱在重启后查过了，共 $([int]((Get-Date) - $launched).TotalSeconds) 秒）" }
  else { Write-Warning "B站伙伴在 $TimeoutSec 秒内没有查收件箱：插件可能没加载，去 DSH 的「设置 → B站伙伴 → 概览」看安装检查" }
}
