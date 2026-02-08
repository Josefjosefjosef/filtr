# Audit topic a section hodnot v articles.json
$data = Get-Content "projects\data\articles.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$total = $data.articles.Count

$topics = @{}
$sections = @{}
$topicRaw = @{}
$sectionRaw = @{}
$topicExamples = @{}
$sectionExamples = @{}
$topicSectionDiff = 0
$emptyTopic = 0
$emptySection = 0

foreach($art in $data.articles) {
    $t = ($art.topic -as [string])
    $s = ($art.section -as [string])
    
    if([string]::IsNullOrWhiteSpace($t)) {
        $emptyTopic++
        $t = "[EMPTY]"
        $tNormalized = "[EMPTY]"
    } else {
        $tNormalized = $t.Trim().ToLower()
    }
    
    if([string]::IsNullOrWhiteSpace($s)) {
        $emptySection++
        $s = "[EMPTY]"
        $sNormalized = "[EMPTY]"
    } else {
        $sNormalized = $s.Trim().ToLower()
    }
    
    # Topic stats
    if(-not $topics.ContainsKey($tNormalized)) {
        $topics[$tNormalized] = 0
        $topicRaw[$tNormalized] = $t
        $topicExamples[$tNormalized] = @()
    }
    $topics[$tNormalized]++
    
    # Section stats
    if(-not $sections.ContainsKey($sNormalized)) {
        $sections[$sNormalized] = 0
        $sectionRaw[$sNormalized] = $s
        $sectionExamples[$sNormalized] = @()
    }
    $sections[$sNormalized]++
    
    # Examples for topic
    if($topicExamples[$tNormalized].Count -lt 3) {
        $srcName = if($art.sources -and $art.sources.Count -gt 0) { $art.sources[0].name } else { "-" }
        $topicExamples[$tNormalized] += [PSCustomObject]@{
            Title = $art.title
            Source = $srcName
            Url = $art.url
            RawTopic = $art.topic
        }
    }
    
    # Examples for section (TOP 20 only)
    if($sections[$sNormalized] -le 20 -and $sectionExamples[$sNormalized].Count -lt 3) {
        $srcName = if($art.sources -and $art.sources.Count -gt 0) { $art.sources[0].name } else { "-" }
        $sectionExamples[$sNormalized] += [PSCustomObject]@{
            Title = $art.title
            Source = $srcName
            Url = $art.url
            RawSection = $art.section
        }
    }
    
    # Check difference
    if($tNormalized -ne $sNormalized) {
        $topicSectionDiff++
    }
}

# Generate markdown report
$md = @"
# Audit topic a section hodnot v articles.json

**Generováno:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## Souhrn

- **Celkem článků:** $total
- **Prázdné topic:** $emptyTopic ($([math]::Round($emptyTopic/$total*100, 2))%)
- **Prázdné section:** $emptySection ($([math]::Round($emptySection/$total*100, 2))%)
- **Unikátních topic hodnot:** $($topics.Count)
- **Unikátních section hodnot:** $($sections.Count)
- **Rozdíl topic ≠ section:** $topicSectionDiff ($([math]::Round($topicSectionDiff/$total*100, 2))%)

## Tabulka topic (všechny hodnoty)

| Topic | Count | % | Původní hodnota |
|-------|-------|---|-----------------|
"@

$topicsSorted = $topics.GetEnumerator() | Sort-Object Value -Descending
foreach($kvp in $topicsSorted) {
    $pct = [math]::Round($kvp.Value/$total*100, 2)
    $raw = $topicRaw[$kvp.Key]
    $md += "`n| ``$($kvp.Key)`` | $($kvp.Value) | $pct% | $raw |"
}

$md += @"


## Ukázky článků pro topic

"@

foreach($kvp in $topicsSorted) {
    $topicKey = $kvp.Key
    $examples = $topicExamples[$topicKey]
    $md += @"

### ``$topicKey`` ($($kvp.Value) článků)

"@
    foreach($ex in $examples) {
        $md += @"
- **$($ex.Title)**  
  Zdroj: $($ex.Source) | [URL]($($ex.Url))  
  Původní topic: ``$($ex.RawTopic)``

"@
    }
}

$md += @"


## Tabulka section (TOP 20)

| Section | Count | % | Původní hodnota |
|---------|-------|---|-----------------|
"@

$sectionsSorted = $sections.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 20
foreach($kvp in $sectionsSorted) {
    $pct = [math]::Round($kvp.Value/$total*100, 2)
    $raw = $sectionRaw[$kvp.Key]
    $md += "`n| ``$($kvp.Key)`` | $($kvp.Value) | $pct% | $raw |"
}

$md += @"


## Ukázky článků pro section (TOP 10)

"@

$top10Sections = $sectionsSorted | Select-Object -First 10
foreach($kvp in $top10Sections) {
    $sectionKey = $kvp.Key
    $examples = $sectionExamples[$sectionKey]
    if($examples -and $examples.Count -gt 0) {
        $md += @"

### ``$sectionKey`` ($($kvp.Value) článků)

"@
        foreach($ex in $examples) {
            $md += @"
- **$($ex.Title)**  
  Zdroj: $($ex.Source) | [URL]($($ex.Url))  
  Původní section: ``$($ex.RawSection)``

"@
        }
    }
}

if($topicSectionDiff -gt 0) {
    $md += @"


## Rozdíly topic vs section

**Poznámka:** V $topicSectionDiff případech ($([math]::Round($topicSectionDiff/$total*100, 2))%) se hodnoty topic a section liší.

Pro deterministické mapování ikon se používá pouze **topic**, nikoli section.
"@
} else {
    $md += @"


## Rozdíly topic vs section

**Výsledek:** Topic a section jsou vždy identické. Pro mapování ikon lze použít obě hodnoty.
"@
}

# Save report
$md | Out-File "docs\_topic_audit.md" -Encoding UTF8 -NoNewline
Write-Host "Report saved to docs\_topic_audit.md"
Write-Host "Total: $total, Topics: $($topics.Count), Sections: $($sections.Count), Diff: $topicSectionDiff"
