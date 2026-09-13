import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../src/core.ts";
import { SttError } from "../src/providers/types.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFakeRecorder() {
  const rec = {
    started: false,
    canceled: false,
    stopped: false,
    outputPath: "/tmp/opencode-test.wav",
    async stop() {
      this.stopped = true;
      await sleep(10);
    },
    cancel() {
      this.canceled = true;
    },
  };
  return rec;
}

function makeFakeProvider({ text = "hello", delayMs = 50 } = {}) {
  return {
    id: "fake",
    transcribeCount: 0,
    async transcribe(_path, _opts) {
      this.transcribeCount++;
      await sleep(delayMs);
      return { text };
    },
  };
}

function makeRecordingDeps({ recorder, provider, insertDelayMs = 80 } = {}) {
  const events = [];
  const inserts = [];
  return {
    events,
    inserts,
    deps: {
      startRecording: async () => {
        events.push("start");
        return recorder;
      },
      getProvider: () => ({ ok: true, provider, language: "pt" }),
      insertAppend: async (text) => {
        events.push(`insert:start:${text}`);
        inserts.push(text);
        await sleep(insertDelayMs);
        events.push(`insert:done:${text}`);
      },
      insertSubmit: async (text) => {
        events.push(`insert-submit:${text}`);
      },
      cleanupFile: async () => {
        events.push("cleanup");
      },
      toast: (msg, variant = "info") => events.push(`toast:${variant}:${msg}`),
      persistRecorder: (rec) => events.push(rec ? "persist:set" : "persist:null"),
    },
  };
}

test("startToggle: first call starts recording and persists to state", async () => {
  const rec = makeFakeRecorder();
  const provider = makeFakeProvider();
  const { events, deps } = makeRecordingDeps({ recorder: rec, provider });

  const core = createCore(deps);
  await core.startToggle("append");

  assert.equal(events.filter((e) => e === "start").length, 1);
  assert.equal(events.filter((e) => e === "persist:set").length, 1);
  assert.ok(core.hasRecorder(), "core should own a recorder after start");
  assert.equal(rec.started, false);  // startRecording mock doesn't set this
  assert.ok(
    events.some((e) => e === "toast:info:Gravando… ctrl+alt+v para transcrever e inserir."),
    "expected the recording toast",
  );
});

test("startToggle reentrance: second call during transcribe is a no-op", async () => {
  const rec = makeFakeRecorder();
  const provider = makeFakeProvider({ text: "ola", delayMs: 120 });
  // Hang the insert long enough that the third toggle lands while busy=true.
  const { events, inserts, deps } = makeRecordingDeps({
    recorder: rec,
    provider,
    insertDelayMs: 200,
  });

  const core = createCore(deps);

  // 1) start recording
  await core.startToggle("append");
  assert.ok(core.hasRecorder());

  // 2) toggle: stops + transcribes (busy=true for ~320ms)
  const stopAndInsert = core.startToggle("append");

  // Let stop+transcribe begin so busy flips to true and recorder is cleared.
  await sleep(20);

  // 3) concurrent toggle while transcribe/insert is in flight: must be a no-op.
  const concurrent = core.startToggle("append");

  await Promise.all([stopAndInsert, concurrent]);

  // Exactly one transcribe, exactly one insert — no second cycle was kicked off.
  assert.equal(provider.transcribeCount, 1);
  assert.deepEqual(inserts, ["ola"]);
  assert.equal(events.filter((e) => e === "insert:done:ola").length, 1);
  assert.equal(events.filter((e) => e === "start").length, 1);
  assert.equal(core.hasRecorder(), false);
  // The concurrent no-op should surface as a warning toast.
  assert.ok(
    events.some((e) => e === "toast:warning:STT ocupado: aguarde o ciclo anterior terminar."),
    "expected a busy toast for the rejected concurrent toggle",
  );
});

test("startToggle reentrance: rapid double-tap during spawn does not leak state", async () => {
  const rec1 = makeFakeRecorder();
  const rec2 = makeFakeRecorder();
  const provider = makeFakeProvider();
  const events = [];
  const inserts = [];

  // Slow startRecording so the second tap lands before busy=true is released.
  let startCount = 0;
  const deps = {
    startRecording: async () => {
      startCount++;
      await sleep(80);
      return startCount === 1 ? rec1 : rec2;
    },
    getProvider: () => ({ ok: true, provider, language: "pt" }),
    insertAppend: async (text) => {
      inserts.push(text);
    },
    insertSubmit: async () => {},
    cleanupFile: async () => {},
    toast: (msg, variant = "info") => events.push(`toast:${variant}:${msg}`),
    persistRecorder: (rec) => events.push(rec ? "persist:set" : "persist:null"),
  };

  const core = createCore(deps);

  // Fire two startToggles without awaiting in between; busy guard must
  // serialise them so only one recording starts.
  const p1 = core.startToggle("append");
  // Yield so the first toggle has a chance to enter busy=true.
  await sleep(10);
  const p2 = core.startToggle("append");
  await Promise.all([p1, p2]);

  assert.equal(startCount, 1, "second toggle must not spawn a second startRecording");
  assert.ok(core.hasRecorder(), "first toggle should leave a recorder active");
  assert.equal(events.filter((e) => e === "toast:warning:STT ocupado: aguarde o ciclo anterior terminar.").length, 1);

  // cleanup so the test runner exits cleanly
  await core.startToggle("append");
  void inserts;
});

test("startToggle: finalize transcribe error surfaces as STT error toast", async () => {
  const rec = makeFakeRecorder();
  const failingProvider = {
    id: "fake",
    async transcribe() {
      await sleep(20);
      throw new SttError("http_500", "upstream boom");
    },
  };
  const { events, deps } = makeRecordingDeps({ recorder: rec, provider: failingProvider });
  const core = createCore(deps);

  await core.startToggle("append");      // start
  await core.startToggle("append");      // stop + finalize (fails)

  assert.ok(events.includes("cleanup"), "failed transcribe should still clean the file");
  assert.ok(
    events.some((e) => e === "toast:error:STT falhou: upstream boom"),
    "expected the failure toast with SttError message",
  );
  assert.equal(core.hasRecorder(), false);
});

test("startToggle: no-speech result shows warning and skips insert", async () => {
  const rec = makeFakeRecorder();
  const provider = makeFakeProvider({ text: "" });
  const { events, inserts, deps } = makeRecordingDeps({ recorder: rec, provider });
  const core = createCore(deps);

  await core.startToggle("append");
  await core.startToggle("append");

  assert.deepEqual(inserts, []);
  assert.ok(events.some((e) => e === "toast:warning:Nenhuma fala detectada."));
});

test("core.cancel: reaps recorder and is idempotent", async () => {
  const rec = makeFakeRecorder();
  const provider = makeFakeProvider();
  const { events, deps } = makeRecordingDeps({ recorder: rec, provider });
  const core = createCore(deps);

  await core.startToggle("append");
  assert.ok(core.hasRecorder());

  assert.equal(core.cancel(), true);
  assert.equal(rec.canceled, true);
  assert.equal(core.hasRecorder(), false);
  assert.equal(core.isBusy(), false, "core is idle after cancel");
  // Idempotent: a second cancel is a no-op.
  assert.equal(core.cancel(), false);
  void events;
});
