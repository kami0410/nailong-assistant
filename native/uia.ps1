param()
# Nailong Assistant - UI Automation worker (persistent REPL)
#
# Why: pixel-only agents guess coordinates. Windows exposes a real accessibility
# tree (the same one screen readers use) with names, roles and exact bounds.
# This worker keeps the element cache alive between calls so the model can say
# "click element e37" instead of "click (812, 441)".
#
# Protocol: one ASCII command per line on stdin, one response line on stdout.
#   tree <maxDepth> <maxNodes> [hwnd|0]   -> ok <base64 json>
#   find <base64 text> [hwnd|0]          -> ok <base64 json>
#   rect <elementId>                     -> ok <base64 json>
#   invoke <elementId>                   -> ok <base64 json>
#   setvalue <elementId> <base64 text>   -> ok <base64 json>
#   focus <elementId>                    -> ok <base64 json>
#   windows                              -> ok <base64 json>
#   ping                                 -> ok <base64 json>
# Responses are base64 so console codepage can never mangle Chinese text.
# Keep this file ASCII-only: PowerShell 5.1 mis-decodes BOM-less UTF-8 scripts.

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::ASCII

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  [Console]::Out.WriteLine('err ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('UIAutomation assemblies unavailable: ' + $_.Exception.Message)))
  exit 1
}

Add-Type -Namespace UIAW -Name N -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
'@
[UIAW.N]::SetProcessDPIAware() | Out-Null

$script:cache = @{}
$script:seq = 0
$script:lastHwnd = [IntPtr]::Zero

function B64J($obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
}
function B64S($s) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$s)) }
function FromB64($s) { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

function Get-WindowTitle([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [UIAW.N]::GetWindowText($h, $sb, 512) | Out-Null
  return $sb.ToString()
}

function Get-Root([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [UIAW.N]::GetForegroundWindow() }
  try { return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch { return $null }
}

function Format-Element($el, [int]$depth) {
  $script:seq++
  $id = 'e' + $script:seq
  $script:cache[$id] = $el
  $r = $el.Current.BoundingRectangle
  $role = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  $val = ''
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $val = $vp.Current.Value
  } catch { }
  return [pscustomobject]@{
    id = $id
    d = $depth
    role = $role
    name = [string]$el.Current.Name
    value = [string]$val
    aid = [string]$el.Current.AutomationId
    x = [int]$r.X
    y = [int]$r.Y
    w = [int]$r.Width
    h = [int]$r.Height
    on = [bool]$el.Current.IsEnabled
    off = [bool]$el.Current.IsOffscreen
  }
}

function Walk-Tree([IntPtr]$hwnd, [int]$maxDepth, [int]$maxNodes) {
  $script:cache = @{}
  $script:seq = 0
  $root = Get-Root $hwnd
  if ($root -eq $null) { return @() }
  $script:lastHwnd = [UIAW.N]::GetForegroundWindow()
  $out = New-Object System.Collections.ArrayList
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($root, 0))
  while ($queue.Count -gt 0 -and $out.Count -lt $maxNodes) {
    $pair = $queue.Dequeue()
    $el = $pair[0]
    $depth = [int]$pair[1]
    $null = $out.Add((Format-Element $el $depth))
    if ($depth -ge $maxDepth) { continue }
    try {
      $child = $walker.GetFirstChild($el)
      while ($child -ne $null -and $out.Count -lt $maxNodes) {
        $queue.Enqueue(@($child, $depth + 1))
        $child = $walker.GetNextSibling($child)
      }
    } catch { }
  }
  return $out
}

function Find-Elements([IntPtr]$hwnd, [string]$text) {
  $script:cache = @{}
  $script:seq = 0
  $root = Get-Root $hwnd
  if ($root -eq $null) { return @() }
  $out = New-Object System.Collections.ArrayList
  foreach ($scope in @([System.Windows.Automation.TreeScope]::Descendants)) {
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $text)
      $hits = $root.FindAll($scope, $cond)
      foreach ($h in $hits) { $null = $out.Add((Format-Element $h 1)) }
    } catch { }
  }
  if ($out.Count -eq 0) {
    try {
      $cond2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $text, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)
      $hits2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond2)
      foreach ($h in $hits2) { $null = $out.Add((Format-Element $h 1)) }
    } catch { }
  }
  return $out
}

function List-Windows() {
  $res = New-Object System.Collections.ArrayList
  $fg = [UIAW.N]::GetForegroundWindow()
  $cb = [UIAW.N+EnumWindowsProc]{
    param($h, $p)
    if (-not [UIAW.N]::IsWindowVisible($h)) { return $true }
    $t = Get-WindowTitle $h
    if ([string]::IsNullOrWhiteSpace($t)) { return $true }
    $pid2 = [uint32]0
    [UIAW.N]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
    try {
      $el = [System.Windows.Automation.AutomationElement]::FromHandle($h)
      $r = $el.Current.BoundingRectangle
    } catch { return $true }
    $null = $res.Add([pscustomobject]@{
      hwnd = [int64]$h
      title = $t
      pid = [int]$pid2
      x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
      minimized = [bool][UIAW.N]::IsIconic($h)
      foreground = ($h -eq $fg)
    })
    return $true
  }
  [UIAW.N]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $res
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  $parts = $line.Split(' ')
  $cmd = $parts[0].ToLower()
  try {
    switch ($cmd) {
      'ping' { [Console]::Out.WriteLine('ok ' + (B64J @{ pong = $true })) }
      'tree' {
        $depth = 8
        $maxNodes = 400
        $hwnd = [IntPtr]::Zero
        if ($parts.Count -gt 1) { $depth = [int]$parts[1] }
        if ($parts.Count -gt 2) { $maxNodes = [int]$parts[2] }
        if ($parts.Count -gt 3 -and $parts[3] -ne '0') { $hwnd = [IntPtr][int64]$parts[3] }
        $nodes = @(Walk-Tree $hwnd $depth $maxNodes)
        [Console]::Out.WriteLine('ok ' + (B64J @{ count = $nodes.Count; nodes = $nodes; window = (Get-WindowTitle ([UIAW.N]::GetForegroundWindow())) }))
      }
      'find' {
        $hwnd = [IntPtr]::Zero
        if ($parts.Count -gt 2 -and $parts[2] -ne '0') { $hwnd = [IntPtr][int64]$parts[2] }
        $nodes = @(Find-Elements $hwnd (FromB64 $parts[1]))
        [Console]::Out.WriteLine('ok ' + (B64J @{ count = $nodes.Count; nodes = $nodes }))
      }
      'rect' {
        $el = $script:cache[$parts[1]]
        if ($null -eq $el) { throw 'element not found (cache expired, run tree again)' }
        $r = $el.Current.BoundingRectangle
        [Console]::Out.WriteLine('ok ' + (B64J @{ id = $parts[1]; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; name = [string]$el.Current.Name }))
      }
      'invoke' {
        $el = $script:cache[$parts[1]]
        if ($null -eq $el) { throw 'element not found (cache expired, run tree again)' }
        $done = $false
        $errs = @()
        foreach ($pat in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern, [System.Windows.Automation.ExpandCollapsePattern]::Pattern)) {
          try {
            $obj = $el.GetCurrentPattern($pat)
            switch ($pat.ProgrammaticName) {
              'InvokePatternIdentifiers.Pattern' { $obj.Invoke(); $done = $true }
              'SelectionItemPatternIdentifiers.Pattern' { $obj.Select(); $done = $true }
              'TogglePatternIdentifiers.Pattern' { $obj.Toggle(); $done = $true }
              'ExpandCollapsePatternIdentifiers.Pattern' {
                if ($obj.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $obj.Collapse() } else { $obj.Expand() }
                $done = $true
              }
            }
          } catch { $errs += $_.Exception.Message }
          if ($done) { break }
        }
        if (-not $done) {
          $r = $el.Current.BoundingRectangle
          [Console]::Out.WriteLine('ok ' + (B64J @{ invoked = $false; clickable = $true; x = [int]($r.X + $r.Width / 2); y = [int]($r.Y + $r.Height / 2); name = [string]$el.Current.Name; reason = 'no invoke pattern; click the center instead' }))
        } else {
          [Console]::Out.WriteLine('ok ' + (B64J @{ invoked = $true; name = [string]$el.Current.Name }))
        }
      }
      'setvalue' {
        $el = $script:cache[$parts[1]]
        if ($null -eq $el) { throw 'element not found (cache expired, run tree again)' }
        $text = FromB64 $parts[2]
        $obj = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $obj.SetValue($text)
        [Console]::Out.WriteLine('ok ' + (B64J @{ set = $true; name = [string]$el.Current.Name }))
      }
      'focus' {
        $el = $script:cache[$parts[1]]
        if ($null -eq $el) { throw 'element not found (cache expired, run tree again)' }
        $el.SetFocus()
        [Console]::Out.WriteLine('ok ' + (B64J @{ focused = $true; name = [string]$el.Current.Name }))
      }
      'windows' {
        [Console]::Out.WriteLine('ok ' + (B64J @{ windows = @(List-Windows) }))
      }
      default { throw ('unknown command: ' + $cmd) }
    }
  } catch {
    [Console]::Out.WriteLine('err ' + (B64S $_.Exception.Message))
  }
  [Console]::Out.Flush()
}
