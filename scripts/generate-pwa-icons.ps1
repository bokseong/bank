param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\frontend\public\icons'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function New-BankIcon {
  param(
    [Parameter(Mandatory)] [int] $Size,
    [Parameter(Mandatory)] [string] $FileName
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#1769c2'))

  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#dcecff'))
  try {
    $roof = [System.Drawing.PointF[]] @(
      [System.Drawing.PointF]::new($Size * 0.19, $Size * 0.41),
      [System.Drawing.PointF]::new($Size * 0.50, $Size * 0.22),
      [System.Drawing.PointF]::new($Size * 0.81, $Size * 0.41)
    )
    $graphics.FillPolygon($white, $roof)
    $graphics.FillRectangle($white, $Size * 0.19, $Size * 0.40, $Size * 0.62, $Size * 0.08)

    foreach ($x in @(0.25, 0.45, 0.65)) {
      $graphics.FillRectangle($white, $Size * $x, $Size * 0.55, $Size * 0.10, $Size * 0.20)
    }
    $graphics.FillRectangle($white, $Size * 0.17, $Size * 0.75, $Size * 0.66, $Size * 0.08)
    $graphics.FillEllipse($accent, $Size * 0.45, $Size * 0.31, $Size * 0.10, $Size * 0.10)

    $path = Join-Path $outputDirectory $FileName
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $accent.Dispose()
    $white.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

New-BankIcon -Size 180 -FileName 'app-icon-180.png'
New-BankIcon -Size 192 -FileName 'app-icon-192.png'
New-BankIcon -Size 512 -FileName 'app-icon-512.png'
