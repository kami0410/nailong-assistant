param([string]$Action = 'win-list', [string]$B64 = '', [int]$TargetPid = 0, [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0, [int]$On = 1, [int]$Steps = 1, [string]$Dir = 'up', [int]$Value = -1, [int]$Top = 15, [string]$Sort = 'mem', [string]$Mode = '')
# Nailong Assistant - window / system actions (one-shot CLI, ASCII only)
# Usage: powershell -File win.ps1 -Action win-focus -B64 <base64 title>
# Every action prints: ok <base64 json>  |  err <base64 message>

$ErrorActionPreference = 'Stop'

Add-Type -Namespace WNA -Name N -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
try { [WNA.N]::SetProcessDPIAware() | Out-Null } catch { }

function B64J($o) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 6 -Compress))) }
function Dec([string]$b) { if ([string]::IsNullOrEmpty($b)) { return '' } return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }

function Get-Title([IntPtr]$h) {
  $len = [WNA.N]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder ($len + 2)
  [WNA.N]::GetWindowText($h, $sb, $len + 2) | Out-Null
  return $sb.ToString()
}

function Find-Windows([string]$needle) {
  $res = New-Object System.Collections.ArrayList
  $cb = [WNA.N+EnumWindowsProc]{
    param($h, $p)
    if (-not [WNA.N]::IsWindowVisible($h)) { return $true }
    $t = Get-Title $h
    if ([string]::IsNullOrWhiteSpace($t)) { return $true }
    if ($needle -ne '' -and ($t.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0)) { return $true }
    $null = $res.Add($h)
    return $true
  }
  [WNA.N]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $res
}

function SysInfo {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $disks = @()
  try {
    $disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
      [pscustomobject]@{ drive = $_.DeviceID; freeGB = [math]::Round($_.FreeSpace / 1GB, 1); totalGB = [math]::Round($_.Size / 1GB, 1) }
    })
  } catch { }
  $bat = $null
  try {
    $b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($b) { $bat = [pscustomobject]@{ percent = $b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -eq 2) } }
  } catch { }
  return [pscustomobject]@{
    os = [string]$os.Caption
    version = [string]$os.Version
    arch = [string]$os.OSArchitecture
    host = [string]$cs.Name
    user = [string]$cs.UserName
    cpu = [string]$cpu.Name
    cores = [int]$cpu.NumberOfLogicalProcessors
    ramTotalGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    ramFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    disks = $disks
    battery = $bat
    screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.Bounds.Width.ToString() + 'x' + $_.Bounds.Height.ToString() })
  }
}

try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
  Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
  $result = switch ($Action) {
    'win-list' {
      $fg = [WNA.N]::GetForegroundWindow()
      $items = @()
      foreach ($h in (Find-Windows '')) {
        $r = New-Object WNA.N+RECT
        [WNA.N]::GetWindowRect($h, [ref]$r) | Out-Null
        $p2 = [uint32]0
        [WNA.N]::GetWindowThreadProcessId($h, [ref]$p2) | Out-Null
        $items += [pscustomobject]@{
          hwnd = [int64]$h
          title = (Get-Title $h)
          pid = [int]$p2
          x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top)
          minimized = [bool][WNA.N]::IsIconic($h)
          foreground = ($h -eq $fg)
        }
      }
      [pscustomobject]@{ windows = $items; count = $items.Count }
    }
    'win-foreground' {
      $h = [WNA.N]::GetForegroundWindow()
      $r = New-Object WNA.N+RECT
      [WNA.N]::GetWindowRect($h, [ref]$r) | Out-Null
      $p2 = [uint32]0
      [WNA.N]::GetWindowThreadProcessId($h, [ref]$p2) | Out-Null
      [pscustomobject]@{ hwnd = [int64]$h; title = (Get-Title $h); pid = [int]$p2; x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) }
    }
    'win-focus' {
      $hits = Find-Windows (Dec $B64)
      if ($hits.Count -eq 0) { throw 'no window matched' }
      $h = $hits[0]
      if ([WNA.N]::IsIconic($h)) { [WNA.N]::ShowWindow($h, 9) | Out-Null }
      [WNA.N]::ShowWindow($h, 5) | Out-Null
      [WNA.N]::BringWindowToTop($h) | Out-Null
      [WNA.N]::SetForegroundWindow($h) | Out-Null
      [pscustomobject]@{ focused = $true; title = (Get-Title $h) }
    }
    'win-minimize' { $h = (Find-Windows (Dec $B64))[0]; [WNA.N]::ShowWindow($h, 6) | Out-Null; [pscustomobject]@{ minimized = $true; title = (Get-Title $h) } }
    'win-maximize' { $h = (Find-Windows (Dec $B64))[0]; [WNA.N]::ShowWindow($h, 3) | Out-Null; [pscustomobject]@{ maximized = $true; title = (Get-Title $h) } }
    'win-restore'  { $h = (Find-Windows (Dec $B64))[0]; [WNA.N]::ShowWindow($h, 9) | Out-Null; [pscustomobject]@{ restored = $true; title = (Get-Title $h) } }
    'win-close'    { $h = (Find-Windows (Dec $B64))[0]; [void][WNA.N]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); [pscustomobject]@{ closed = $true; title = (Get-Title $h) } }
    'win-move' {
      $h = (Find-Windows (Dec $B64))[0]
      [WNA.N]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $W, $H, 0x14) | Out-Null
      [pscustomobject]@{ moved = $true; x = $X; y = $Y; w = $W; h = $H }
    }
    'win-topmost' {
      $h = (Find-Windows (Dec $B64))[0]
      $after = if ($On -eq 1) { [IntPtr](-1) } else { [IntPtr](-2) }
      [WNA.N]::SetWindowPos($h, $after, 0, 0, 0, 0, 0x13) | Out-Null
      [pscustomobject]@{ topmost = ($On -eq 1) }
    }
    'volume' {
      $vk = 0xAF
      if ($Dir -eq 'down') { $vk = 0xAE }
      if ($Dir -eq 'mute') { $vk = 0xAD; $Steps = 1 }
      for ($i = 0; $i -lt [Math]::Max(1, $Steps); $i++) {
        [WNA.N]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [WNA.N]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 40
      }
      [pscustomobject]@{ volume = $Dir; steps = $Steps }
    }
    'brightness-get' {
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $b) { throw 'this display does not report brightness through WMI' }
      [pscustomobject]@{ brightness = [int]$b.CurrentBrightness }
    }
    'brightness' {
      if ($Value -lt 0) { throw 'brightness requires -Value 0..100' }
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $m) { throw 'this display does not support brightness control' }
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]([Math]::Min(100, [Math]::Max(0, $Value))) } | Out-Null
      [pscustomobject]@{ brightness = $Value }
    }
    'procs' {
      $all = Get-Process | Where-Object { $_.Id -gt 4 }
      $items = if ($Sort -eq 'cpu') { $all | Sort-Object CPU -Descending | Select-Object -First $Top } else { $all | Sort-Object WorkingSet64 -Descending | Select-Object -First $Top }
      $out = @()
      foreach ($p in $items) {
        $mem = [math]::Round($p.WorkingSet64 / 1MB, 1)
        $out += [pscustomobject]@{ pid = $p.Id; name = $p.ProcessName; memMB = $mem; cpuSec = [math]::Round(($p.CPU), 1); title = $p.MainWindowTitle }
      }
      [pscustomobject]@{ processes = $out }
    }
    'kill' {
      if ($TargetPid -le 0) { throw 'kill requires -TargetPid' }
      Stop-Process -Id $TargetPid -Force
      [pscustomobject]@{ killed = $TargetPid }
    }
    'lock' { Start-Process rundll32.exe -ArgumentList 'user32.dll,LockWorkStation'; [pscustomobject]@{ locked = $true } }
    'sound' {
      # 旧音频 IPC 也只允许播放大笑素材，不调用 Windows 提示音。
      $played = $false
      try {
        $soundPath = Dec $B64
        if ([IO.Path]::GetFileName($soundPath) -ne 'laugh.wav') { throw 'Only laugh.wav is allowed' }
        $player = New-Object System.Media.SoundPlayer $soundPath
        try { $player.Load(); $player.PlaySync(); $played = $true } finally { $player.Dispose() }
      } catch { $played = $false }
      [pscustomobject]@{ sound = 'laugh'; played = $played }
    }
    'sysinfo' { SysInfo }
    'screenshot-size' {
      $s = [System.Windows.Forms.Screen]::PrimaryScreen
      $b = $s.Bounds
      [pscustomobject]@{ width = $b.Width; height = $b.Height; screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [pscustomobject]@{ w = $_.Bounds.Width; h = $_.Bounds.Height; x = $_.Bounds.X; y = $_.Bounds.Y; primary = $_.Primary } }) }
    }
    'screen-info' {
      $s = [System.Windows.Forms.Screen]::PrimaryScreen
      $b = $s.Bounds
      [pscustomobject]@{ width = $b.Width; height = $b.Height; screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [pscustomobject]@{ w = $_.Bounds.Width; h = $_.Bounds.Height; x = $_.Bounds.X; y = $_.Bounds.Y; primary = $_.Primary } }) }
    }
    default { throw ('unknown action: ' + $Action) }
  }
  [Console]::Out.WriteLine('ok ' + (B64J $result))
} catch {
  [Console]::Out.WriteLine('err ' + ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))))
}
