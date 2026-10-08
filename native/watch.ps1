param([int]$ProcessId, [string]$Title)

Add-Type -Namespace WATCH -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

$logPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.cache\watch.log'
$tick = 0

while ($true) {
  Start-Sleep -Milliseconds 500
  $tick++
  try {
    if ($tick % 8 -eq 1) {
      if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }
    }

    $cb = [WATCH.W+EnumWindowsProc]{
      param($h, $l)
      $wp = [uint32]0
      [WATCH.W]::GetWindowThreadProcessId($h, [ref]$wp) | Out-Null
      if ([int]$wp -eq $ProcessId) {
        $cls = New-Object System.Text.StringBuilder 128
        [WATCH.W]::GetClassName($h, $cls, 128) | Out-Null
        if ($cls.ToString() -eq 'Chrome_WidgetWin_1') {
          $t = New-Object System.Text.StringBuilder 128
          [WATCH.W]::GetWindowText($h, $t, 128) | Out-Null
          if ($t.ToString() -eq $Title) {
            $r = New-Object WATCH.W+RECT
            [WATCH.W]::GetWindowRect($h, [ref]$r) | Out-Null
            if (($r.Right - $r.Left) -gt 0 -and $r.Top -le -30000) {
              [WATCH.W]::ShowWindow($h, 4) | Out-Null
            }
          }
        }
      }
      return $true
    }
    [WATCH.W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  } catch {
    Add-Content -LiteralPath $logPath -Value ("ERR " + $_.Exception.Message) -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}
