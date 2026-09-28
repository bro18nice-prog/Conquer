const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
let p = root + "/android/app/build.gradle",
  s = fs.readFileSync(p, "utf8");
s = s
  .replace(/versionCode \d+/, "versionCode 6")
  .replace(/versionName "[^"]+"/, 'versionName "0.5.0"');
if (!s.includes("CONQUER_STORE_PASSWORD"))
  s = s.replace(
    "    signingConfigs {",
    () =>
      '    signingConfigs {\n        release {\n            storeFile file(System.getenv("CONQUER_KEYSTORE"))\n            storePassword System.getenv("CONQUER_STORE_PASSWORD")\n            keyAlias "conquer"\n            keyPassword System.getenv("CONQUER_STORE_PASSWORD")\n        }',
  );
s = s.replace(
  /release \{\s*\/\/ Caution![\s\S]*?signingConfig signingConfigs.debug/,
  () => "release {\n            signingConfig signingConfigs.release",
);
fs.writeFileSync(p, s);
p = root + "/android/app/src/main/AndroidManifest.xml";
s = fs.readFileSync(p, "utf8");
for (const perm of [
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "SYSTEM_ALERT_WINDOW",
])
  s = s.replace(
    new RegExp(
      '  <uses-permission android:name="android.permission.' +
        perm +
        '"[^>]*\\/>',
    ),
    () =>
      '  <uses-permission android:name="android.permission.' +
      perm +
      '" tools:node="remove"/>',
  );
fs.writeFileSync(p, s);

// Persisted GPS jobs require this Android normal permission (Expo issue #48935).
if (!s.includes("android.permission.RECEIVE_BOOT_COMPLETED"))
  s = s.replace(
    "<queries>",
    () =>
      '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>\n  <queries>',
  );
fs.writeFileSync(p, s);
