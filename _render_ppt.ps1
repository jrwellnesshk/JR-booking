$src = Join-Path (Get-Location) 'presentation'
$ppt = Get-ChildItem $src -Filter *.pptx | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$out = Join-Path $src 'render'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($ppt.FullName, $true, $false, $false)
$i = 1
foreach ($slide in $pres.Slides) {
    $slide.Export((Join-Path $out ('slide{0:d2}.png' -f $i)), 'PNG', 1600, 900)
    $i++
}
$pres.Close()
$app.Quit()
Write-Output "exported $($i-1) slides -> $out"
