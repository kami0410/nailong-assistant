param([int]$X, [int]$Y, [int]$W, [int]$H, [string]$Out)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace BL -Name N -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[BL.N]::SetProcessDPIAware() | Out-Null

$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$wp = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -ErrorAction SilentlyContinue).WallPaper

$fitPath = Join-Path $dir 'wp-fit.png'
$metaPath = Join-Path $dir 'wp-fit.meta'
$wpInfo = $null
if ($wp -and (Test-Path $wp)) { $wpInfo = Get-Item $wp -ErrorAction SilentlyContinue }
$meta = ''
if ($wpInfo) { $meta = ($wpInfo.FullName + '|' + $wpInfo.LastWriteTimeUtc.Ticks + '|' + $bounds.Width + 'x' + $bounds.Height) }

$full = $null
if ($meta -ne '' -and (Test-Path $fitPath) -and (Test-Path $metaPath)) {
  try {
    if (((Get-Content -LiteralPath $metaPath -Raw -ErrorAction SilentlyContinue) -replace '\s', '') -eq ($meta -replace '\s', '')) {
      $full = [System.Drawing.Bitmap]::FromFile($fitPath)
    }
  } catch { $full = $null }
}

if ($full -eq $null -and $wpInfo) {
  try {
    $src = [System.Drawing.Image]::FromFile($wpInfo.FullName)
    $scale = [Math]::Max($bounds.Width / $src.Width, $bounds.Height / $src.Height)
    $dw = [int][Math]::Ceiling($src.Width * $scale)
    $dh = [int][Math]::Ceiling($src.Height * $scale)
    $full = New-Object System.Drawing.Bitmap($dw, $dh)
    $g = [System.Drawing.Graphics]::FromImage($full)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, $dw, $dh)
    $g.Dispose()
    $src.Dispose()
    try {
      $full.Save($fitPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Set-Content -LiteralPath $metaPath -Value $meta -Encoding UTF8
    } catch { }
  } catch {
    if ($full -ne $null) { $full.Dispose(); $full = $null }
  }
}

if ($full -ne $null) {
  $ox = [int](($full.Width - $bounds.Width) / 2)
  $oy = [int](($full.Height - $bounds.Height) / 2)
  $cropX = [Math]::Max(0, ($X - $bounds.X) + $ox)
  $cropY = [Math]::Max(0, ($Y - $bounds.Y) + $oy)
  $cw = [Math]::Min($W, [Math]::Max(1, $full.Width - $cropX))
  $ch = [Math]::Min($H, [Math]::Max(1, $full.Height - $cropY))

  $crop = New-Object System.Drawing.Bitmap($W, $H)
  $g2 = [System.Drawing.Graphics]::FromImage($crop)
  $g2.Clear([System.Drawing.Color]::FromArgb(255, 30, 26, 18))
  $g2.DrawImage($full, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), (New-Object System.Drawing.Rectangle($cropX, $cropY, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g2.Dispose()
  $full.Dispose()

  $sw2 = [Math]::Max(1, [int]($W / 10))
  $sh2 = [Math]::Max(1, [int]($H / 10))
  $small = New-Object System.Drawing.Bitmap($sw2, $sh2)
  $g3 = [System.Drawing.Graphics]::FromImage($small)
  $g3.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g3.DrawImage($crop, 0, 0, $sw2, $sh2)
  $g3.Dispose()
  $g4 = [System.Drawing.Graphics]::FromImage($crop)
  $g4.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g4.DrawImage($small, 0, 0, $W, $H)
  $g4.Dispose()
  $small.Dispose()

  $crop.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
  Write-Output 'ok'
  exit 0
}

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 32, 28, 20))
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output 'solid-fallback'
