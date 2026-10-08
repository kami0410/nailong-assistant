Add-Type -Namespace AI -Name N -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
'@
[AI.N]::SetProcessDPIAware() | Out-Null

$MDOWN = 2; $MUP = 4; $RDOWN = 8; $RUP = 16; $WHEEL = 0x800
$KEYUP = 2; $UNICODE = 4

$KEYS = @{
  'enter' = 0x0D; 'tab' = 0x09; 'esc' = 0x1B; 'escape' = 0x1B; 'space' = 0x20;
  'backspace' = 0x08; 'delete' = 0x2E; 'insert' = 0x2D; 'home' = 0x24; 'end' = 0x23;
  'pageup' = 0x21; 'pagedown' = 0x22; 'up' = 0x26; 'down' = 0x28; 'left' = 0x25; 'right' = 0x27;
  'ctrl' = 0x11; 'control' = 0x11; 'alt' = 0x12; 'shift' = 0x10; 'win' = 0x5B;
  'f1' = 0x70; 'f2' = 0x71; 'f3' = 0x72; 'f4' = 0x73; 'f5' = 0x74; 'f6' = 0x75;
  'f7' = 0x76; 'f8' = 0x77; 'f9' = 0x78; 'f10' = 0x79; 'f11' = 0x7A; 'f12' = 0x7B
}

function Get-Vk([string]$name) {
  $n = $name.ToLower()
  if ($KEYS.ContainsKey($n)) { return [int]$KEYS[$n] }
  if ($n.Length -eq 1) {
    $r = [AI.N]::VkKeyScan([char]$n)
    if ($r -ne -1) { return ($r -band 0xFF) }
  }
  return -1
}

function Tap-Vk([int]$vk, [bool]$shift) {
  if ($shift) { [AI.N]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero) }
  [AI.N]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 25
  [AI.N]::keybd_event([byte]$vk, 0, $KEYUP, [UIntPtr]::Zero)
  if ($shift) { [AI.N]::keybd_event(0x10, 0, $KEYUP, [UIntPtr]::Zero) }
}

function Send-Combo([string]$combo) {
  $parts = $combo.Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
  if ($parts.Count -eq 0) { return }
  $mods = @()
  for ($i = 0; $i -lt $parts.Count - 1; $i++) {
    $vk = Get-Vk $parts[$i]
    if ($vk -ge 0) { $mods += $vk; [AI.N]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero) }
  }
  Start-Sleep -Milliseconds 40
  $last = $parts[$parts.Count - 1]
  $vk2 = Get-Vk $last
  if ($vk2 -ge 0) {
    $shift = $false
    if ($last.Length -eq 1) {
      $r = [AI.N]::VkKeyScan([char]$last)
      if ($r -ne -1) { $shift = (($r -shr 8) -band 1) -eq 1 }
    }
    Tap-Vk $vk2 $shift
  }
  Start-Sleep -Milliseconds 40
  for ($i = $mods.Count - 1; $i -ge 0; $i--) { [AI.N]::keybd_event([byte]$mods[$i], 0, $KEYUP, [UIntPtr]::Zero) }
}

function Type-Text([string]$b64) {
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  try {
    Set-Clipboard -Value $text
    Start-Sleep -Milliseconds 60
    Send-Combo 'ctrl+v'
  } catch {
    foreach ($ch in $text.ToCharArray()) {
      $r = [AI.N]::VkKeyScan($ch)
      if ($r -ne -1) { Tap-Vk ($r -band 0xFF) ((($r -shr 8) -band 1) -eq 1) }
    }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  $parts = $line.Split(' ')
  $cmd = $parts[0]
  $ok = $true
  try {
    switch ($cmd) {
      'ping' { }
      'move' { [AI.N]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null }
      'click' {
        [AI.N]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null
        Start-Sleep -Milliseconds 80
        [AI.N]::mouse_event($MDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [AI.N]::mouse_event($MUP, 0, 0, 0, [IntPtr]::Zero)
      }
      'dblclick' {
        [AI.N]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null
        Start-Sleep -Milliseconds 80
        1..2 | ForEach-Object {
          [AI.N]::mouse_event($MDOWN, 0, 0, 0, [IntPtr]::Zero)
          Start-Sleep -Milliseconds 40
          [AI.N]::mouse_event($MUP, 0, 0, 0, [IntPtr]::Zero)
          Start-Sleep -Milliseconds 60
        }
      }
      'rightclick' {
        [AI.N]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null
        Start-Sleep -Milliseconds 80
        [AI.N]::mouse_event($RDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [AI.N]::mouse_event($RUP, 0, 0, 0, [IntPtr]::Zero)
      }
      'type' { Type-Text $parts[1] }
      'key' { Send-Combo $parts[1] }
      'scroll' { [AI.N]::mouse_event($WHEEL, 0, 0, [uint32]([int]$parts[1] * -120), [IntPtr]::Zero) }
      'exit' { break }
      default { $ok = $false }
    }
  } catch { $ok = $false }
  if ($ok) { [Console]::Out.WriteLine('ok') } else { [Console]::Out.WriteLine('err') }
  [Console]::Out.Flush()
}
