import { chmod, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderId = "minimax" | "openai-compat";
export type PresetId = "minimax" | "openai" | "groq" | "other";
export type ApiKeySource = "env" | "secrets";

export interface PluginOptions {
  readonly provider?: ProviderId;
  readonly apiKeyEnv?: string;
  readonly language?: string;
  readonly openai?: {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly apiKeyEnv?: string;
  };
}

export interface ProviderConfig {
  presetId: PresetId;
  provider: ProviderId;
  apiKeyEnv: string;
  baseUrl: string;
  model: string;
  label: string;
}

export const PRESETS: Record<
  Exclude<PresetId, "other">,
  {
    readonly label: string;
    readonly provider: ProviderId;
    readonly apiKeyEnv: string;
    readonly baseUrl?: string;
    readonly model?: string;
  }
> = {
  minimax: { label: "MiniMax", provider: "minimax", apiKeyEnv: "MINIMAX_API_KEY" },
  openai: {
    label: "OpenAI Whisper",
    provider: "openai-compat",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
  },
  groq: {
    label: "Groq",
    provider: "openai-compat",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
  },
};

export const MISSING_URL_ERROR =
  "Configure o provedor com /stt-config (baseUrl e model são obrigatórios).";

export function missingKeyError(apiKeyEnv: string): string {
  return `Chave de API não encontrada. Rode /stt-config ou exporte ${apiKeyEnv}.`;
}

export function defaultSecretsPath(): string {
  return join(homedir(), ".config/opencode/opencode-stt.secrets.json");
}

export function configFromPreset(id: Exclude<PresetId, "other">): ProviderConfig {
  const p = PRESETS[id];
  return {
    presetId: id,
    provider: p.provider,
    apiKeyEnv: p.apiKeyEnv,
    baseUrl: p.baseUrl ?? "",
    model: p.model ?? "",
    label: p.label,
  };
}

export function seedFromOptions(options: PluginOptions = {}): ProviderConfig {
  if (options.provider !== "openai-compat") {
    const base = configFromPreset("minimax");
    return options.apiKeyEnv ? { ...base, apiKeyEnv: options.apiKeyEnv } : base;
  }
  return {
    presetId: "other",
    provider: "openai-compat",
    apiKeyEnv: options.openai?.apiKeyEnv ?? "OPENAI_API_KEY",
    baseUrl: options.openai?.baseUrl ?? "",
    model: options.openai?.model ?? "",
    label: "Outro",
  };
}

/** Store (wizard) wins; otherwise options seed; otherwise MiniMax. */
export function resolveProviderConfig(
  stored: ProviderConfig | undefined,
  options: PluginOptions | undefined,
): ProviderConfig {
  if (stored) return stored;
  return seedFromOptions(options);
}

/** Env non-empty wins over the secrets file. Never log `apiKey`. */
export function resolveApiKey(
  apiKeyEnv: string,
  env: NodeJS.Dict<string | undefined>,
  secrets: Readonly<Record<string, string>>,
): { ok: true; apiKey: string; source: ApiKeySource } | { ok: false; source: "missing" } {
  const fromEnv = env[apiKeyEnv];
  if (fromEnv) return { ok: true, apiKey: fromEnv, source: "env" };
  const fromSecrets = secrets[apiKeyEnv];
  if (typeof fromSecrets === "string" && fromSecrets) {
    return { ok: true, apiKey: fromSecrets, source: "secrets" };
  }
  return { ok: false, source: "missing" };
}

export type ResolvedRuntime =
  | {
      readonly ok: true;
      readonly provider: "minimax";
      readonly apiKey: string;
      readonly apiKeySource: ApiKeySource;
    }
  | {
      readonly ok: true;
      readonly provider: "openai-compat";
      readonly apiKey: string;
      readonly apiKeySource: ApiKeySource;
      readonly baseUrl: string;
      readonly model: string;
    }
  | { readonly ok: false; readonly error: string };

export function resolveRuntime(
  stored: ProviderConfig | undefined,
  options: PluginOptions | undefined,
  env: NodeJS.Dict<string | undefined>,
  secrets: Readonly<Record<string, string>>,
): ResolvedRuntime {
  const cfg = resolveProviderConfig(stored, options);
  const key = resolveApiKey(cfg.apiKeyEnv, env, secrets);
  if (!key.ok) return { ok: false, error: missingKeyError(cfg.apiKeyEnv) };
  if (cfg.provider === "minimax") {
    return { ok: true, provider: "minimax", apiKey: key.apiKey, apiKeySource: key.source };
  }
  if (!cfg.baseUrl || !cfg.model) return { ok: false, error: MISSING_URL_ERROR };
  return {
    ok: true,
    provider: "openai-compat",
    apiKey: key.apiKey,
    apiKeySource: key.source,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  };
}

export function readSecretsSync(path = defaultSecretsPath()): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { keys?: unknown };
    const keys = parsed.keys;
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(keys as Record<string, unknown>)) {
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeSecret(
  envName: string,
  value: string,
  path = defaultSecretsPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const keys = readSecretsSync(path);
  keys[envName] = value;
  await writeFile(path, `${JSON.stringify({ keys }, null, 2)}\n`, { mode: 0o600 });
  // writeFile mode only applies on create; chmod covers an existing file.
  await chmod(path, 0o600);
}
