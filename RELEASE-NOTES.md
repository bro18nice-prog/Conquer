# Conquer 0.3.0 — Android local pilot

Project: D:\Conquer\app. Release: D:\Conquer\outputs\Conquer-0.3.0.apk.
Build: powershell -File D:\Conquer\app\scripts\build-android.ps1
Checks: node node_modules/typescript/bin/tsc --noEmit; node scripts/test.cjs

## Shipped behavior
- Real GPS recording; original samples and completed activities saved locally.
- On launch, the latest activity and map are restored.
- Capture uses bounded faces of the GPS line plus the player's owned boundaries.
- Small GPS intersections no longer discard an otherwise valid closed surface.
- Excursions leaving and re-entering owned land capture new bounded land.
- Open tails never receive an invented closing chord. A return within 40m of the initial point may close the initial loop.
- Existing local runs are recalculated once with captureVersion 2. Originals remain at conquer:runs-before-v2.
- Export/import via Activities transfers local runs between browser and APK. Import preserves existing runs, deduplicates IDs, rejects conflicting payloads, and recalculates geometry.
- Minimum route 200m, new area 500m², max 10km², GPS accuracy <=35m, gaps <=120s, speed <=8m/s.

## Release and data
Signing key and password are kept outside the repository at D:\Conquer\private-signing.
Keep these files backed up privately; the same key is required for updates retaining Android app data.
Never publish the signing directory.
The Android APK is arm64-v8a, minSdk 24. JavaScript is embedded; no Metro/laptop required.
Do not uninstall to update. Browser storage and APK storage are independent; use Export then Import.

## Verification
49 automated tests passed (geometry, durable storage, backup and prepared backend).
Browser import + reload checked with synthetic data: route, 1.30km, duration and 0.106km² restored with filled map polygon.
Actual device GPS/background behavior still needs an outdoor test.
Online group is unconfigured. The prepared Supabase SQL is the earlier capture algorithm; port the bounded-face algorithm and add parity checks before enabling sync.
The captureVersion 2 algorithm is local-only in this release.


## 0.4.1
- XP bar and levels on the map; daily adjustable pushups/squats/crunches in Activities.
- Rewards: 25/30/25 XP plus 20 daily completion bonus. Calendar progression with caps.
- Run XP derived from unique real activities, 10/km capped at 100 + 1/500 new m² capped at 200.
- Backup schema v2 carries daily mission records; legacy v1 backups remain supported. Imports merge completed missions idempotently.
- Added android.permission.RECEIVE_BOOT_COMPLETED to app.json and native release preparation. Expo TaskManager schedules persisted GPS jobs with setPersisted(true) but its manifest omits this required permission. Matches reported first-GPS-fix crash and Expo issue #48935.
- 61 automated tests pass; UI completion awards 25 XP and hides the completed action. Final signed APK inspected with aapt: versionCode 5, versionName 0.4.1, boot permission present.
- Device crash log was not available; user must confirm fixed startup/GPS on their phone. No destructive reset, uninstall or route deletion used.
