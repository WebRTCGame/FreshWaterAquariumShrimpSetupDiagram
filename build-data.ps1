# Syncs diagram nodes into components/ and bundles everything into components/data.js.
# Step 1: parse diagram.js, add manifest entries + component JSONs for nodes missing from the manifest.
# Step 2: bundle manifest + component JSONs into data.js (script tags work on file:// where fetch() is CORS-blocked).
$dir = Join-Path $PSScriptRoot 'components'
$manifestPath = Join-Path $dir 'manifest.json'
$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json

# ── Step 1: generate missing entries from diagram.js ──────────────────────────
$diagram = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'diagram.js')
$pattern = '(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\[({>][^"]*"([^"]*)"[^:]*:::\s*(\w+)\s*$'

$classCat = @{
  tank = 'Main Systems'; equipment = 'Equipment'; valve = 'Flow Control'
  instrument = 'Sensors & Instruments'; access = 'Accessories'
  substrate = 'Substrate & Plants'; plants = 'Substrate & Plants'; bacteria = 'Substrate & Plants'
  shrimp = 'Shrimp Habitat'; dosing = 'Dosing System'; light = 'Lighting'
  alarm = 'Safety & Alarms'; power = 'Power & Control'; flow_output = 'Flow Control'
  island = 'Island System'; islandctrl = 'Island System'; co2 = 'CO₂ System'
  ato = 'Water Management'; wc = 'Water Management'; feeder = 'Feeding'
  quarantine = 'Quarantine'; par = 'Sensors & Instruments'
}
$prefixCat = @{
  'BIO' = 'Filtration'; 'MIN' = 'Filtration'; 'OX' = 'Filtration'; 'DEG' = 'Filtration'
  'PRE' = 'Filtration'; 'FIL' = 'Filtration'; 'P_' = 'Main Systems'; 'AIR' = 'Air System'
  'CO2' = 'CO₂ System'; 'DOS' = 'Dosing System'; 'HTR' = 'Heating & Climate'
  'QT' = 'Quarantine'; 'ISL' = 'Island System'; 'ATO' = 'Water Management'; 'WC' = 'Water Management'
  'LGT' = 'Lighting'; 'DATA' = 'Data & Monitoring'; 'SUP' = 'Plumbing & Valves'
  'RET' = 'Plumbing & Valves'; 'TEE' = 'Plumbing & Valves'
}

$existing = @{}
$manifest | ForEach-Object { $existing[$_.id] = $true }
$newEntries = @()
foreach ($m in [regex]::Matches($diagram, $pattern)) {
  $id = $m.Groups[1].Value
  if ($existing.ContainsKey($id)) { continue }
  if ($id -like 'LEG_*' -or $id -like 'OV_*') { continue }

  $lines = $m.Groups[2].Value -split '<br>'
  $category = $classCat[$m.Groups[3].Value]
  if ($category -eq 'Equipment' -or $category -eq 'Flow Control') {
    foreach ($p in $prefixCat.Keys) {
      if ($id.StartsWith($p)) { $category = $prefixCat[$p]; break }
    }
  }
  if (-not $category) { $category = 'Equipment' }

  $desc = ($lines[1..($lines.Count - 1)] | Where-Object { $_ }) -join '; '
  $entry = [ordered]@{
    id = $id
    name = $lines[0]
    desc = $desc
    status = 'operational'
    category = $category
  }
  $newEntries += $entry
  $fileEntry = $entry.Clone()
  $fileEntry.details = @{ specs = ($entry.desc) }
  [System.IO.File]::WriteAllText(
    (Join-Path $dir "$id.json"),
    ($fileEntry | ConvertTo-Json -Depth 3))
  $existing[$id] = $true
}
if ($newEntries.Count -gt 0) {
  $newEntries = $newEntries | Sort-Object category, id
  $manifest = @($manifest) + $newEntries
  [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 3))
  Write-Host "Added $($newEntries.Count) diagram nodes to manifest + component JSONs"
} else {
  Write-Host 'No new diagram nodes to add'
}

# Self-heal: recreate component files that exist in the manifest but not on disk
foreach ($item in $manifest) {
  $filePath = Join-Path $dir "$($item.id).json"
  if (-not (Test-Path $filePath)) {
    $fileEntry = [ordered]@{
      id = $item.id
      name = $item.name
      desc = $item.desc
      status = $item.status
      category = $item.category
      details = @{ specs = $item.desc }
    }
    [System.IO.File]::WriteAllText($filePath, ($fileEntry | ConvertTo-Json -Depth 3))
    Write-Host "Recreated $($item.id).json from manifest entry"
  }
}

# ── Step 2: bundle into data.js ───────────────────────────────────────────────
$manifestRaw = Get-Content -Raw -Encoding UTF8 $manifestPath
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('window.MANIFEST = ' + $manifestRaw + ';')
[void]$sb.AppendLine('window.COMPONENT_DATA = {')
foreach ($item in $manifest) {
  $json = Get-Content -Raw -Encoding UTF8 (Join-Path $dir "$($item.id).json")
  [void]$sb.AppendLine("  `"$($item.id)`": $json,")
}
[void]$sb.AppendLine('};')
[System.IO.File]::WriteAllText((Join-Path $dir 'data.js'), $sb.ToString())
Write-Host "Wrote components/data.js ($($manifest.Count) components)"
