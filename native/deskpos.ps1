param([string]$B64)
$ErrorActionPreference = 'Stop'

$target = ''
try { $target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($B64)) } catch { Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}'))); exit 0 }
if ([string]::IsNullOrWhiteSpace($target)) { Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}'))); exit 0 }

Add-Type -Namespace DP -Name N -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string win);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
[DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr hp, IntPtr addr, uint size, uint type, uint protect);
[DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr hp, IntPtr addr, uint size, uint type);
[DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr hp, IntPtr addr, byte[] buf, uint size, out UIntPtr written);
[DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr hp, IntPtr addr, byte[] buf, uint size, out UIntPtr read);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
public struct POINT { public int X; public int Y; }
'@

function Is-DesktopListview([IntPtr]$h) {
  $cur = [DP.N]::GetParent($h)
  $guard = 0
  while ($cur -ne [IntPtr]::Zero -and $guard -lt 12) {
    $guard++
    $sb = New-Object System.Text.StringBuilder 64
    [DP.N]::GetClassName($cur, $sb, 64) | Out-Null
    $cn = $sb.ToString()
    if ($cn -eq 'Progman' -or $cn -eq 'WorkerW') { return $true }
    $cur = [DP.N]::GetParent($cur)
  }
  return $false
}

$script:best = [IntPtr]::Zero
$script:bestCount = 0
$cb = [DP.N+EnumWindowsProc]{
  param($h, $l)
  try {
    $sb = New-Object System.Text.StringBuilder 64
    [DP.N]::GetClassName($h, $sb, 64) | Out-Null
    if ($sb.ToString() -eq 'SysListView32') {
      if (Is-DesktopListview $h) {
        $cnt = [int][DP.N]::SendMessageW($h, 0x1004, [IntPtr]::Zero, [IntPtr]::Zero)
        if ($cnt -gt $script:bestCount) { $script:bestCount = $cnt; $script:best = $h }
      }
    }
  } catch { }
  return $true
}
[DP.N]::EnumChildWindows([DP.N]::GetDesktopWindow(), $cb, [IntPtr]::Zero) | Out-Null

if ($env:DESKPOS_DEBUG) { [Console]::Error.WriteLine("dbg best=" + $script:best + " count=" + $script:bestCount) }
$lv = $script:best
if ($lv -eq [IntPtr]::Zero) { Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}'))); exit 0 }

$count = [int][DP.N]::SendMessageW($lv, 0x1004, [IntPtr]::Zero, [IntPtr]::Zero)
if ($count -le 0) { Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}'))); exit 0 }

$procId = [uint32]0
[DP.N]::GetWindowThreadProcessId($lv, [ref]$procId) | Out-Null
$hp = [DP.N]::OpenProcess(0x38, $false, $procId)
if ($hp -eq [IntPtr]::Zero) { Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}'))); exit 0 }

$OFF_LV = [IntPtr]0
$OFF_TX = [IntPtr]512
$OFF_RC = [IntPtr]2048
$mem = [DP.N]::VirtualAllocEx($hp, [IntPtr]::Zero, 4096, 0x3000, 0x04)
if ($mem -eq [IntPtr]::Zero) { [DP.N]::CloseHandle($hp) | Out-Null; Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}'))); exit 0 }

function Read-ItemName([int]$idx) {
  $b = New-Object byte[] 128
  [Array]::Copy([BitConverter]::GetBytes([uint32]1), 0, $b, 0, 4)          # mask = LVIF_TEXT
  [Array]::Copy([BitConverter]::GetBytes([int32]$idx), 0, $b, 4, 4)        # iItem
  [Array]::Copy([BitConverter]::GetBytes([int32]0), 0, $b, 8, 4)          # iSubItem
  $tp = [IntPtr]([int64]$mem + [int64]$OFF_TX)
  [Array]::Copy([BitConverter]::GetBytes([int64]$tp), 0, $b, 24, 8)        # pszText
  [Array]::Copy([BitConverter]::GetBytes([int32]260), 0, $b, 32, 4)        # cchTextMax
  $w = [UIntPtr]::Zero
  [DP.N]::WriteProcessMemory($hp, $mem, $b, 128, [ref]$w) | Out-Null
  [DP.N]::SendMessageW($lv, 0x1073, [IntPtr]$idx, $mem) | Out-Null
  $tb = New-Object byte[] 520
  [DP.N]::ReadProcessMemory($hp, $tp, $tb, 520, [ref]$w) | Out-Null
  $s = [Text.Encoding]::Unicode.GetString($tb)
  $z = $s.IndexOf([char]0)
  if ($z -ge 0) { $s = $s.Substring(0, $z) }
  return $s
}

function Read-ItemIconCenter([int]$idx) {
  $b = New-Object byte[] 16
  [Array]::Copy([BitConverter]::GetBytes([int32]1), 0, $b, 0, 4)   # LVIR_ICON
  $rcp = [IntPtr]([int64]$mem + [int64]$OFF_RC)
  $w = [UIntPtr]::Zero
  [DP.N]::WriteProcessMemory($hp, $rcp, $b, 16, [ref]$w) | Out-Null
  $ret = [DP.N]::SendMessageW($lv, 0x100E, [IntPtr]$idx, $rcp)
  $rb = New-Object byte[] 16
  [DP.N]::ReadProcessMemory($hp, $rcp, $rb, 16, [ref]$w) | Out-Null
  $l = [BitConverter]::ToInt32($rb, 0); $t = [BitConverter]::ToInt32($rb, 4)
  $r = [BitConverter]::ToInt32($rb, 8); $bo = [BitConverter]::ToInt32($rb, 12)
  if ($env:DESKPOS_DEBUG) { [Console]::Error.WriteLine("dbg rect ret=" + $ret + " l=$l t=$t r=$r b=$bo") }
  if (($r - $l) -le 0 -or ($bo - $t) -le 0) { return $null }
  return @{ X = [int](($l + $r) / 2); Y = [int](($t + $bo) / 2) }
}

$want = @($target)
$i = $target.LastIndexOf('.')
if ($i -gt 0) { $want += $target.Substring(0, $i) }

$found = $null
for ($n = 0; $n -lt $count; $n++) {
  $nm = Read-ItemName $n
  if ($env:DESKPOS_DEBUG) { [Console]::Error.WriteLine("dbg n=" + $n + " name=[" + $nm + "] want=[" + ($want -join '|') + "]") }
  foreach ($w in $want) {
    if ($nm -eq $w) { $found = $n; break }
  }
  if ($found -ne $null) { break }
}

if ($found -eq $null) {
  [DP.N]::VirtualFreeEx($hp, $mem, 0, 0x8000) | Out-Null
  [DP.N]::CloseHandle($hp) | Out-Null
  Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}')))
  exit 0
}

$c = Read-ItemIconCenter $found
[DP.N]::VirtualFreeEx($hp, $mem, 0, 0x8000) | Out-Null
[DP.N]::CloseHandle($hp) | Out-Null

if ($null -eq $c) {
  Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"found":false}')))
  exit 0
}

$pt = New-Object DP.N+POINT
$pt.X = $c.X
$pt.Y = $c.Y
[DP.N]::ClientToScreen($lv, [ref]$pt) | Out-Null
Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ found = $true; x = $pt.X; y = $pt.Y } | ConvertTo-Json -Compress))))

