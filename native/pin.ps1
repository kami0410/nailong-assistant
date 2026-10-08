param([int]$ProcessId, [string]$Title)

Add-Type -Namespace PIN -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

$script:order = New-Object System.Collections.ArrayList
$script:main = [IntPtr]::Zero
$cb = [PIN.W+EnumWindowsProc]{
  param($h, $l)
  $wp = [uint32]0
  [PIN.W]::GetWindowThreadProcessId($h, [ref]$wp) | Out-Null
  if ([int]$wp -eq $ProcessId) {
    $cls = New-Object System.Text.StringBuilder 128
    [PIN.W]::GetClassName($h, $cls, 128) | Out-Null
    if ($cls.ToString() -eq 'Chrome_WidgetWin_1') {
      $t = New-Object System.Text.StringBuilder 128
      [PIN.W]::GetWindowText($h, $t, 128) | Out-Null
      if ($t.ToString() -eq $Title) { $script:main = $h }
    }
  }
  $c2 = New-Object System.Text.StringBuilder 64
  [PIN.W]::GetClassName($h, $c2, 64) | Out-Null
  [void]$script:order.Add([pscustomobject]@{ H = $h; C = $c2.ToString() })
  return $true
}
[PIN.W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($script:main -eq [IntPtr]::Zero) { Write-Output 'no-window'; exit 1 }

$pi = -1
for ($i = 0; $i -lt $script:order.Count; $i++) {
  if ($script:order[$i].C -eq 'Progman') { $pi = $i; break }
}
if ($pi -lt 0) { Write-Output 'no-progman'; exit 1 }

$done = $false
for ($i = $pi - 1; $i -ge 0 -and -not $done; $i--) {
  if ($script:order[$i].H -eq $script:main) { continue }
  if ([PIN.W]::SetWindowPos($script:main, $script:order[$i].H, 0, 0, 0, 0, 0x13)) { $done = $true }
}
Write-Output ('pinned ' + $script:main + ' done=' + $done)
