param(
  [Parameter(Mandatory=$true)][string]$Manifest,
  [Parameter(Mandatory=$true)][string]$DataRoot,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $DataRoot).Path.TrimEnd('\')
$entries = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$allowed = @('raw','patents','company','releases','bronze','silver','reviews','reports')
$verified = @()
foreach ($entry in $entries) {
  $absolute = [IO.Path]::GetFullPath($entry.FullName)
  if (-not $absolute.StartsWith($resolvedRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw "Path outside data root: $absolute" }
  $category = $absolute.Substring($resolvedRoot.Length + 1).Split('\')[0]
  if ($category -notin $allowed) { throw "Unrecognized legacy category: $category" }
  if (Test-Path -LiteralPath $absolute) {
    $item = Get-Item -LiteralPath $absolute
    if ($item.PSIsContainer -or $item.LinkType -or $item.Length -ne $entry.Length) { throw "Manifest entry changed: $absolute" }
    $parent = $item.Directory
    while ($parent.FullName.Length -gt $resolvedRoot.Length) {
      if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked directory: $($parent.FullName)" }
      $parent = $parent.Parent
    }
    $verified += $item
  }
}
# All final absolute paths are checked before the first deletion. No recursive delete.
$totalBytes = ($verified | Measure-Object Length -Sum).Sum
if ($Apply) {
  foreach ($item in $verified) { Remove-Item -LiteralPath $item.FullName -Force }
}
[pscustomobject]@{ Applied=[bool]$Apply; Files=$verified.Count; Bytes=$totalBytes } | ConvertTo-Json
