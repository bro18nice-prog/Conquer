param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
if (-not $env:CONQUER_KEYSTORE -or -not $env:CONQUER_STORE_PASSWORD) {
    throw 'Set CONQUER_KEYSTORE and CONQUER_STORE_PASSWORD in this shell before building a signed release.'
}
if (-not (Test-Path -LiteralPath $env:CONQUER_KEYSTORE -PathType Leaf)) { throw 'Signing keystore does not exist.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'android/gradlew.bat'))) {
    throw 'Generate the native project first with npm run build:android.'
}
node (Join-Path $PSScriptRoot 'prepare-android-release.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Native configuration failed.' }
Push-Location (Join-Path $projectRoot 'android')
try {
    .\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a' --no-daemon --console=plain --max-workers=2
    if ($LASTEXITCODE -ne 0) { throw 'APK build failed.' }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'android/app/build/outputs/apk/release/app-release.apk') -Destination (Join-Path $OutputDirectory 'Conquer-release.apk')
} finally { Pop-Location }
