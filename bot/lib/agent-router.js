// ─── AGENT ROUTER ────────────────────────────────────────────────────────────
// Общая точка входа для вызова CLI-агентов (claude, позже codex/kimi) с
// автопереключением при исчерпании лимита. Файл состояния (cooldown) — общий
// для всех ботов агента (Ксюша, продюсер, оба Скруджа): они работают под одним
// Linux-пользователем `agent` на сервере и делят одну подписку Claude, поэтому
// если лимит исчерпан у одного бота — он исчерпан у всех сразу.

import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_STATE_PATH = "/home/agent/.agent-router-state.json";

// Паттерны подтверждены разбором бинарника @anthropic-ai/claude-code (14.08.2026):
// внутренний классификатор статуса различает "billing_error" (лимит подписки или
// баланса исчерпан — нужно переключать провайдера) и "rate_limit"/"overloaded"
// (временное ограничение — просто подождать и повторить у того же провайдера).
const USAGE_LIMIT_RE = /usage limit reached|billing_error|credit balance.{0,20}too low|usage credit limit|monthly usage limit|group's usage limit/i;
const RATE_LIMIT_RE = /rate_limit_error|rate limited|overloaded|server_error/i;

const DEFAULT_COOLDOWN_MS = {
  usage_limit: 5 * 60 * 60 * 1000, // консервативная пауза — лимит подписки Claude сбрасывается максимум раз в 5ч
  rate_limit: 2 * 60 * 1000,
};

function statePath() {
  return process.env.AGENT_ROUTER_STATE || DEFAULT_STATE_PATH;
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return { providers: {} };
  }
}

function saveState(state) {
  try {
    writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[agent-router] не смог сохранить состояние:", e.message);
  }
}

function isOnCooldown(provider) {
  const until = loadState().providers[provider]?.cooldownUntil;
  return typeof until === "number" && Date.now() < until;
}

function markCooldown(provider, kind, detail) {
  const state = loadState();
  state.providers[provider] = {
    cooldownUntil: Date.now() + (DEFAULT_COOLDOWN_MS[kind] || DEFAULT_COOLDOWN_MS.rate_limit),
    kind,
    detail: (detail || "").slice(0, 200),
    markedAt: Date.now(),
  };
  saveState(state);
}

function clearCooldown(provider) {
  const state = loadState();
  if (state.providers[provider]) {
    delete state.providers[provider];
    saveState(state);
  }
}

// null — сбой не распознан (обычная ошибка), "usage_limit" — лимит/баланс исчерпан
// (переключаем провайдера), "rate_limit" — временное ограничение (ждём и повторяем
// у того же провайдера, НЕ переключаем).
function detectFailure(text) {
  if (!text) return null;
  if (USAGE_LIMIT_RE.test(text)) return "usage_limit";
  if (RATE_LIMIT_RE.test(text)) return "rate_limit";
  return null;
}

// providers: [{ name, call: async (prompt, sessionId, opts) => ({ text, sessionId, cost }) }, ...]
// в порядке приоритета. Провайдеры на cooldown пропускаются. При обнаруженном
// usage_limit/rate_limit — ставит cooldown и пробует следующего провайдера;
// на любой другой ошибке пробрасывает её как есть (не провайдерский сбой).
async function callWithFailover(providers, prompt, sessionId, opts = {}) {
  const { onSwitch } = opts;
  let lastErr = null;
  let tried = 0;

  for (const provider of providers) {
    if (isOnCooldown(provider.name)) continue;
    tried++;
    try {
      const result = await provider.call(prompt, sessionId, opts);
      return { ...result, provider: provider.name };
    } catch (err) {
      const failure = detectFailure(err.message || "");
      lastErr = err;
      if (failure) {
        markCooldown(provider.name, failure, err.message);
        if (onSwitch) onSwitch(provider.name, failure);
        continue; // пробуем следующего провайдера в списке
      }
      throw err; // не провайдерский сбой — пробрасываем сразу, без перебора
    }
  }

  if (tried === 0) {
    throw new Error("Все провайдеры на паузе (cooldown) — подожди восстановления лимита");
  }
  throw lastErr;
}

export {
  statePath,
  loadState,
  saveState,
  isOnCooldown,
  markCooldown,
  clearCooldown,
  detectFailure,
  callWithFailover,
  DEFAULT_COOLDOWN_MS,
};
