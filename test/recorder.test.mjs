import test from "node:test";
import assert from "node:assert/strict";
import { startRecording } from "../src/recorder.ts";

// When ffmpeg is missing, the spawn promise must reject with ENOENT so the
// caller can turn it into a toast. Before the spawn/error listener was added,
// the `error` event had no listener and crashed the TUI host with
// uncaughtException.
test("startRecording rejects with ENOENT when ffmpegPath is missing", async () => {
  // Surfacing uncaughtException during the test would fail it (Node's test
  // runner wires `process.on('uncaughtException')` to fail the current test).
  // We assert on the rejection directly — the listener inside startRecording
  // is what makes this safe.
  await assert.rejects(
    startRecording({ ffmpegPath: "/this/binary/does/not/exist/xyzzy" }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.code, "ENOENT");
      return true;
    },
  );
});
