param([string]$B64)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName Microsoft.VisualBasic
$ok = 0
$fail = 0
$errs = @()
foreach ($b in ($B64 -split ',')) {
  if ([string]::IsNullOrWhiteSpace($b)) { continue }
  $p = ''
  try {
    $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))
  } catch {
    $fail++
    $errs += 'bad-b64'
    continue
  }
  try {
    if (-not (Test-Path -LiteralPath $p)) {
      $fail++
      $errs += 'missing'
      continue
    }
    if (Test-Path -LiteralPath $p -PathType Container) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    } else {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    }
    $ok++
  } catch {
    $fail++
    $errs += $_.Exception.Message
  }
}
Write-Output ('ok ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ ok = $ok; fail = $fail; err = ($errs -join ' | ') } | ConvertTo-Json -Compress))))
