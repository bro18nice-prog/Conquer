import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
test("Android persisted GPS jobs declare the required boot permission", () => {
  const root = path.resolve(__dirname, "../..");
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  assert.ok(
    app.expo.android.permissions.includes(
      "android.permission.RECEIVE_BOOT_COMPLETED",
    ),
  );
  const native = path.join(root, "android/app/src/main/AndroidManifest.xml");
  if (fs.existsSync(native))
    assert.match(
      fs.readFileSync(native, "utf8"),
      /<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/,
    );
});
