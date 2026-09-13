import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PRESETS,
  MISSING_URL_ERROR,
  configFromPreset,
  missingKeyError,
  readSecretsSync,
  resolveApiKey,
  resolveProviderConfig,
  resolveRuntime,
  seedFromOptions,
  writeSecret,
} from "../src/config.ts";

test("presets fill url/model for OpenAI and Groq", () => {
  const openai = configFromPreset("openai");
  assert.equal(openai.provider, "openai-compat");
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");
  assert.equal(openai.model, "whisper-1");
  assert.equal(openai.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(PRESETS.openai.baseUrl, openai.baseUrl);

  const groq = configFromPreset("groq");
  assert.equal(groq.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(groq.model, "whisper-large-v3-turbo");
  assert.equal(groq.apiKeyEnv, "GROQ_API_KEY");
});

test("MiniMax preset does not require baseUrl", () => {
  const minimax = configFromPreset("minimax");
  assert.equal(minimax.provider, "minimax");
  assert.equal(minimax.baseUrl, "");
  assert.equal(minimax.model, "");
  assert.equal(minimax.apiKeyEnv, "MINIMAX_API_KEY");

  const runtime = resolveRuntime(minimax, undefined, {}, { MINIMAX_API_KEY: "k" });
  assert.equal(runtime.ok, true);
  if (runtime.ok) assert.equal(runtime.provider, "minimax");
});

test("resolveApiKey: env wins over secrets", () => {
  const r = resolveApiKey(
    "MINIMAX_API_KEY",
    { MINIMAX_API_KEY: "from-env" },
    { MINIMAX_API_KEY: "from-file" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.source, "env");
    assert.equal(r.apiKey, "from-env");
  }
});

test("resolveApiKey: empty env falls through to secrets", () => {
  const r = resolveApiKey(
    "MINIMAX_API_KEY",
    { MINIMAX_API_KEY: "" },
    { MINIMAX_API_KEY: "from-file" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.source, "secrets");
    assert.equal(r.apiKey, "from-file");
  }
});

test("resolveApiKey: secrets fallback when env is absent", () => {
  const r = resolveApiKey("OPENAI_API_KEY", {}, { OPENAI_API_KEY: "from-file" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.source, "secrets");
    assert.equal(r.apiKey, "from-file");
  }
});

test("resolveApiKey: missing → error", () => {
  const r = resolveApiKey("GROQ_API_KEY", {}, {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.source, "missing");
});

test("resolveRuntime: missing key asks for /stt-config", () => {
  const r = resolveRuntime(configFromPreset("minimax"), undefined, {}, {});
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error, missingKeyError("MINIMAX_API_KEY"));
    assert.match(r.error, /\/stt-config/);
  }
});

test("resolveRuntime: env wins over secrets at call time", () => {
  const r = resolveRuntime(
    configFromPreset("openai"),
    undefined,
    { OPENAI_API_KEY: "from-env" },
    { OPENAI_API_KEY: "from-file" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.apiKeySource, "env");
    assert.equal(r.apiKey, "from-env");
    assert.equal(r.provider, "openai-compat");
    if (r.provider === "openai-compat") {
      assert.equal(r.baseUrl, PRESETS.openai.baseUrl);
      assert.equal(r.model, PRESETS.openai.model);
    }
  }
});

test("resolveRuntime: openai-compat without url/model errors", () => {
  const stored = { ...configFromPreset("openai"), baseUrl: "", model: "" };
  const r = resolveRuntime(stored, undefined, { OPENAI_API_KEY: "k" }, {});
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error, MISSING_URL_ERROR);
    assert.match(r.error, /\/stt-config/);
  }
});

test("resolveProviderConfig: store wins over options", () => {
  const stored = configFromPreset("groq");
  const r = resolveProviderConfig(stored, { provider: "minimax" });
  assert.equal(r.presetId, "groq");
  assert.equal(r.provider, "openai-compat");
});

test("resolveProviderConfig: options seed when store is empty", () => {
  const r = resolveProviderConfig(undefined, {
    provider: "openai-compat",
    openai: { baseUrl: "http://localhost:1234/v1", model: "local" },
  });
  assert.equal(r.provider, "openai-compat");
  assert.equal(r.baseUrl, "http://localhost:1234/v1");
  assert.equal(r.model, "local");
});

test("resolveProviderConfig: default MiniMax", () => {
  const r = resolveProviderConfig(undefined, undefined);
  assert.equal(r.provider, "minimax");
  assert.equal(r.presetId, "minimax");
});

test("seedFromOptions: MiniMax apiKeyEnv override", () => {
  const r = seedFromOptions({ apiKeyEnv: "CUSTOM_KEY" });
  assert.equal(r.provider, "minimax");
  assert.equal(r.apiKeyEnv, "CUSTOM_KEY");
});

test("writeSecret uses mode 600 and merges keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stt-secrets-"));
  const path = join(dir, "opencode-stt.secrets.json");
  try {
    await writeSecret("MINIMAX_API_KEY", "aaa", path);
    await writeSecret("OPENAI_API_KEY", "bbb", path);
    assert.deepEqual(readSecretsSync(path), {
      MINIMAX_API_KEY: "aaa",
      OPENAI_API_KEY: "bbb",
    });
    const st = await stat(path);
    assert.equal(st.mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSecretsSync: missing file is empty", () => {
  assert.deepEqual(readSecretsSync(join(tmpdir(), "no-such-stt-secrets.json")), {});
});
