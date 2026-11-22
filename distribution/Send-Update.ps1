[CmdletBinding()]
param(
    [string]$TestersFile = '',
    [string]$ReleaseNotesFile = '',
    [switch]$SkipBuild,
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($TestersFile)) { $TestersFile = Join-Path $PSScriptRoot 'testers.local.txt' }
if ([string]::IsNullOrWhiteSpace($ReleaseNotesFile)) { $ReleaseNotesFile = Join-Path $PSScriptRoot 'release-notes.txt' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $projectRoot 'app/google-services.json'
$apkFile = Join-Path $projectRoot 'app/build/outputs/apk/debug/app-debug.apk'
$metadataFile = Join-Path $projectRoot 'app/build/outputs/apk/debug/output-metadata.json'
$packageName = 'com.madmeower.pawpower'

if (-not (Test-Path -LiteralPath $configFile)) {
    throw 'The local app/google-services.json is missing. Restore your existing Firebase config; do not commit it.'
}
$config = [System.IO.File]::ReadAllText($configFile) | ConvertFrom-Json
$clients = @($config.client | Where-Object { $_.client_info.android_client_info.package_name -eq $packageName })
if ($clients.Count -ne 1) { throw 'Firebase config must contain exactly one PawPower Android client.' }
$appId = $clients[0].client_info.mobilesdk_app_id
$projectId = $config.project_info.project_id
if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($projectId)) {
    throw 'Firebase app/project identifiers are missing.'
}
if (-not (Test-Path -LiteralPath $TestersFile)) {
    throw 'Private recipient file is missing: distribution/testers.local.txt. It stays out of Git.'
}
$recipients = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $TestersFile).Path).Trim()
$addresses = @($recipients -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($addresses.Count -eq 0 -or @($addresses | Where-Object { $_ -notmatch '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' }).Count -gt 0) {
    throw 'Recipient file must contain valid email addresses.'
}
if ($recipients.Contains(';')) { throw 'Use commas between recipient addresses, not semicolons.' }
if (-not (Test-Path -LiteralPath $ReleaseNotesFile)) { throw 'Release notes file is missing.' }
if ($CheckOnly) {
    Write-Output ('Distribution inputs valid for ' + $packageName + '. Recipient count: ' + $addresses.Count)
    return
}

$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if ($null -eq $npxCommand) { $npxCommand = Get-Command npx -ErrorAction Stop }
$previousJavaHome = $env:JAVA_HOME
Push-Location -LiteralPath $projectRoot
try {
    if (-not $SkipBuild) {
        if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -and $null -eq (Get-Command java -ErrorAction SilentlyContinue)) {
            $jdkCandidates = @(
                (Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'),
                (Join-Path $env:LOCALAPPDATA 'Programs/Android Studio/jbr')
            )
            foreach ($candidate in $jdkCandidates) {
                if (Test-Path -LiteralPath (Join-Path $candidate 'bin/java.exe')) {
                    $env:JAVA_HOME = $candidate
                    break
                }
            }
            if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
                throw 'Build/check the app in Android Studio, then run this command with -SkipBuild.'
            }
        }
        & (Join-Path $projectRoot 'gradlew.bat') ':app:assembleDebug' ':app:lintDebug' ':app:testDebugUnitTest'
        if ($LASTEXITCODE -ne 0) { throw 'Build or checks failed. Nothing was uploaded.' }
    }
    if (-not (Test-Path -LiteralPath $apkFile) -or -not (Test-Path -LiteralPath $metadataFile)) {
        throw 'Debug APK is missing. Build it in Android Studio first.'
    }
    $metadata = [System.IO.File]::ReadAllText($metadataFile) | ConvertFrom-Json
    if ($metadata.applicationId -ne $packageName) { throw 'APK metadata has the wrong application ID.' }
    Write-Output ('Uploading PawPower ' + $metadata.elements[0].versionName + ' (build ' + $metadata.elements[0].versionCode + ') privately.')
    # CLI OAuth stays in the local Firebase CLI account store. No admin token or service-account key is used.
    & $npxCommand.Source '-y' 'firebase-tools@latest' 'appdistribution:distribute' $apkFile '--app' $appId '--project' $projectId '--release-notes-file' (Resolve-Path -LiteralPath $ReleaseNotesFile).Path '--testers-file' (Resolve-Path -LiteralPath $TestersFile).Path '--non-interactive'
    if ($LASTEXITCODE -ne 0) { throw 'Firebase upload/distribution did not complete. Check the message above before retrying.' }
}
finally {
    Pop-Location
    $env:JAVA_HOME = $previousJavaHome
}
