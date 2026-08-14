// ─── DIALOG HISTORY ──────────────────────────────────────────────────────────
// Provider-agnostic рolling-лог последних реплик диалога — отдельно от
// provider-specific session id (--resume у claude, thread_id у codex, у kimi
// сессии вообще нет). Нужен, чтобы при переключении провайдера (лимит исчерпан
// или восстановился) новый провайдер получил кусок недавнего контекста текстом,
// а не отвечал так, будто видит пользователя впервые.
//
// Разделение ответственности с agent-router.js: роутер решает, КАКОЙ провайдер
// отвечает (перебор + cooldown), этот модуль решает, ЧТО из истории ему
// показать — считает то, что провайдер мог пропустить, пока отвечали другие.

import { readFileSync, writeFileSync } from "node:fs";

const MAX_TURNS = 16; // окно: сколько последних реплик держим (~8 обменов)
const MAX_CHARS = 6000; // суммарный бюджет символов окна
const MAX_TURN_CHARS = 800; // обрезка одной реплики перед сохранением

function load(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function save(state, path) {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[dialog-history] не смог сохранить состояние:", e.message);
  }
}

function trim(text, limit) {
  const s = String(text || "");
  return s.length > limit ? s.slice(0, limit) + "…" : s;
}

function ensureUser(state, userId) {
  if (!state[userId]) state[userId] = { seq: 0, turns: [], providerSeq: {} };
  return state[userId];
}

function pruneWindow(user) {
  while (user.turns.length > MAX_TURNS) user.turns.shift();
  let total = user.turns.reduce((sum, t) => sum + t.text.length, 0);
  while (total > MAX_CHARS && user.turns.length > 2) {
    total -= user.turns[0].text.length;
    user.turns.shift();
  }
}

// Реплики, которые provider ещё не видел — seq больше отметки его последнего
// успешного ответа этому пользователю. Имеет смысл ТОЛЬКО для провайдера с
// настоящей нативной сессией (claude --resume): он и так помнит всё до своего
// последнего ответа, нужен лишь пропуск — что случилось, пока отвечали другие.
// Для stateless-провайдеров (codex exec без resume, kimi без сессий вообще)
// используй getWindow — они не помнят даже свои же прошлые ответы.
function getGap(state, userId, provider) {
  const user = state[userId];
  if (!user) return [];
  const lastSeen = user.providerSeq[provider] || 0;
  return user.turns.filter((t) => t.seq > lastSeen);
}

// Всё окно целиком — для провайдеров без собственной памяти между вызовами.
// В отличие от getGap, не смотрит на providerSeq: даже если этот провайдер
// отвечал прошлым ходом, к следующему вызову он это уже забыл.
function getWindow(state, userId) {
  const user = state[userId];
  return user ? user.turns : [];
}

function formatGapBlock(gap) {
  if (!gap.length) return "";
  const lines = gap.map((t) => `${t.role === "user" ? "Пользователь" : "Ты"}: ${t.text}`);
  return `[Контекст — это было в диалоге, пока отвечал другой провайдер, тебе его не показывали:]\n${lines.join("\n")}\n[Конец контекста, дальше — текущее сообщение пользователя:]\n\n`;
}

// Вызывать после КАЖДОГО успешного ответа, независимо от провайдера: фиксирует
// обмен в окне и продвигает отметку ответившего провайдера до последней реплики.
function recordTurn(state, userId, provider, userText, assistantText) {
  const user = ensureUser(state, userId);
  user.seq++;
  user.turns.push({ seq: user.seq, role: "user", text: trim(userText, MAX_TURN_CHARS) });
  user.seq++;
  user.turns.push({ seq: user.seq, role: "assistant", text: trim(assistantText, MAX_TURN_CHARS) });
  pruneWindow(user);
  user.providerSeq[provider] = user.seq;
}

export { load, save, getGap, getWindow, formatGapBlock, recordTurn };
