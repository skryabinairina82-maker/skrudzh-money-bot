import { Bot, InputFile } from "grammy";
import cron from "node-cron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { initDb, countTransactionsOn, getGoalsWithProgress, closeDb } from "./lib/db.js";

const AGENT_HOME = process.env.AGENT_HOME;
if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
const ENV_PATH = join(AGENT_HOME, ".env");
// dotenv/config loads the default cwd .env; explicitly load the instance file as well.
const { config } = await import("dotenv");
config({ path: ENV_PATH, override: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_NAME = process.env.OWNER_NAME || "владелец";
if (!BOT_TOKEN) throw new Error(`TELEGRAM_BOT_TOKEN is missing in ${ENV_PATH}`);

const DATA_DIR = join(AGENT_HOME, "data");
const SESSION_PATH = join(DATA_DIR, "sessions.json");
mkdirSync(DATA_DIR, { recursive: true });

const PERSONA = readFileSync(join(import.meta.dirname, "persona.md"), "utf8");

let sessions = {};
try { sessions = JSON.parse(readFileSync(SESSION_PATH, "utf8")); } catch {}
let ownerChatId = null;
let queue = Promise.resolve();

function saveSessions() { writeFileSync(SESSION_PATH, JSON.stringify(sessions, null, 2)); }
function today() { return new Intl.DateTimeFormat("en-CA").format(new Date()); }

function enqueueClaude(prompt, sessionId) {
  const task = queue.then(() => callClaude(prompt, sessionId));
  queue = task.catch(() => {});
  return task;
}

function callClaude(prompt, sessionId) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--max-turns", "15", "--append-system-prompt", PERSONA, "--dangerously-skip-permissions"];
    if (sessionId) args.push("--resume", sessionId);
    const child = spawn("claude", args, { cwd: AGENT_HOME, env: process.env, timeout: 600000 });
    let buffer = "";
    let answer = "";
    let newSessionId = sessionId || null;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant") {
            const text = event.message?.content?.filter((part) => part.type === "text").map((part) => part.text).join("");
            if (text) answer = text;
          }
          if (event.type === "result") { answer = event.result || answer; newSessionId = event.session_id || newSessionId; }
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !answer) return reject(new Error(`Claude exited ${code}: ${stderr.slice(0, 300)}`));
      resolve({ text: answer || "Не получил ответа, а чтоб мой килт! Попробуй ещё раз.", sessionId: newSessionId });
    });
    child.stdin.end();
  });
}

function keepTyping(ctx, action = "typing") {
  const send = () => ctx.replyWithChatAction(action).catch(() => {});
  send();
  const interval = setInterval(send, 4000);
  return () => clearInterval(interval);
}

const PHOTO_TAG = /\[ФОТО:\s*(\S+)(?:\s+([^\]]*))?\]/g;

async function replyFromClaude(ctx, prompt) {
  const userId = String(ctx.from.id);
  const result = await enqueueClaude(prompt, sessions[userId] || null);
  if (result.sessionId) { sessions[userId] = result.sessionId; saveSessions(); }

  const photos = [...result.text.matchAll(PHOTO_TAG)].map(([, path, caption]) => ({ path, caption: caption?.trim() || undefined }));
  const text = result.text.replace(PHOTO_TAG, "").trim();
  if (text) await ctx.reply(text, { parse_mode: "HTML" });
  for (const photo of photos) {
    if (!existsSync(photo.path)) continue;
    const options = { parse_mode: "HTML", ...(photo.caption ? { caption: photo.caption } : {}) };
    await ctx.replyWithPhoto(new InputFile(photo.path), options);
    if (photo.path.startsWith("/tmp/skrudzh_chart_")) unlinkSync(photo.path);
  }
}

function isOwner(ctx) {
  if (!ownerChatId) ownerChatId = String(ctx.chat.id);
  return String(ctx.chat.id) === ownerChatId;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) return reject(new Error(`Telegram file download: HTTP ${response.statusCode}`));
      pipeline(response, createWriteStream(destination)).then(resolve).catch(reject);
    }).on("error", reject);
  });
}

async function transcribeVoice(filePath) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  const audio = readFileSync(filePath);
  const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&language=ru&smart_format=true", {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "audio/ogg" },
    body: audio,
  });
  if (!response.ok) throw new Error(`Deepgram HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
}

const bot = new Bot(BOT_TOKEN);

const welcomeBullets = [
  "💵 Записываю траты — текстом, фото чека или голосовым",
  "💰 Записываю и доходы — зарплату, возврат долга, подработку и прочее — отдельно от трат",
  "🏦 Отличаю скриншот банка от чека, не даю задвоить одну и ту же трату (и не путаю перевод между своими картами с доходом)",
  "🧮 Лимиты по статьям — подскажу, если разошёлся",
  "🎯 Цели накопления — заведи цель, отмечай взносы, сверим 1 числа",
  "📊 Спроси «сводку за неделю» или «за месяц» — покажу расходы и доходы по статьям, картинку-график и сальдо (доход минус расход)",
  "🗂️ Статьи уже заведены, но если понадобится своя — просто скажи, заведём вместе",
  "🌙 Вечером в 21:00 спрошу, все ли траты скинул за день",
];

const WELCOME_TEXT = `🎩 Скрудж на связи, ${OWNER_NAME}!

Веду учёт твоих личных денег — так же дотошно, как считал каждый цент, прежде чем он попадал в мой денежный чан.

Что умею:
${welcomeBullets.join("\n")}

Просто пиши или присылай — остальное беру на себя. Ничто на свете не пахнет лучше, чем чистые деньги! 🧧`;

const ONBOARDING_TEXT = `А чтоб мой килт, хочешь сразу глянуть, как это работает? 🧐

Скинь мне траты за прошлый месяц — чеками, голосом или просто текстом, как удобно. А как занесёшь, напиши «дай сводку за прошлый месяц» — покажу, куда уходили деньги, по статьям и с итогом. 💰📊`;

bot.command("start", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(WELCOME_TEXT);
  await ctx.reply(ONBOARDING_TEXT);
});

bot.command("summary", async (ctx) => {
  if (!isOwner(ctx)) return;
  const stopTyping = keepTyping(ctx, "typing");
  try { await replyFromClaude(ctx, "Пользователь нажал кнопку меню «Сводка» — дай сводку за текущий месяц."); }
  catch (error) { console.error("[summary]", error.message); await ctx.reply("А чтоб мой килт! Не смог собрать сводку. Попробуй ещё раз или напиши текстом."); }
  finally { stopTyping(); }
});

bot.command("status", async (ctx) => {
  if (!isOwner(ctx)) return;
  const stopTyping = keepTyping(ctx, "typing");
  try { await replyFromClaude(ctx, "Пользователь нажал кнопку меню «Статус» — покажи лимиты по статьям и цели накопления."); }
  catch (error) { console.error("[status]", error.message); await ctx.reply("А чтоб мой килт! Не смог собрать статус. Попробуй ещё раз или напиши текстом."); }
  finally { stopTyping(); }
});

bot.command("help", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(`🎩 Вот что я умею:\n\n${welcomeBullets.join("\n")}`);
});

bot.on("message:text", async (ctx) => {
  if (!isOwner(ctx)) return;
  const stopTyping = keepTyping(ctx, "typing");
  try { await replyFromClaude(ctx, `Текст от пользователя:\n${ctx.message.text}`); }
  catch (error) { console.error("[text]", error.message); await ctx.reply("А чтоб мой килт! Не смог обработать запись. Попробуй ещё раз."); }
  finally { stopTyping(); }
});

bot.on("message:photo", async (ctx) => {
  if (!isOwner(ctx)) return;
  const stopTyping = keepTyping(ctx, "typing");
  const fileId = ctx.message.photo.at(-1).file_id;
  const file = await ctx.api.getFile(fileId);
  const tempPath = `/tmp/skrudzh_receipt_${Date.now()}_${fileId.slice(-8)}.jpg`;
  try {
    await download(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`, tempPath);
    const caption = ctx.message.caption ? `\nПодпись: ${ctx.message.caption}` : "";
    await replyFromClaude(ctx, `Пользователь прислал фото. Открой файл через Read и определи, это фото чека или скриншот банковского приложения: ${tempPath}${caption}`);
  } catch (error) { console.error("[photo]", error.message); await ctx.reply("Не удалось прочитать чек. Пришли фото ещё раз, 💰"); }
  finally { stopTyping(); if (existsSync(tempPath)) unlinkSync(tempPath); }
});

bot.on("message:voice", async (ctx) => {
  if (!isOwner(ctx)) return;
  if (!process.env.DEEPGRAM_API_KEY) {
    await ctx.reply("Голосовые распознаю после подключения Deepgram. Опиши трату текстом, а чтоб мой килт! 🎤");
    return;
  }
  const stopTyping = keepTyping(ctx, "typing");
  const fileId = ctx.message.voice.file_id;
  const file = await ctx.api.getFile(fileId);
  const tempPath = `/tmp/skrudzh_voice_${Date.now()}_${fileId.slice(-8)}.ogg`;
  try {
    await download(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`, tempPath);
    const transcript = await transcribeVoice(tempPath);
    if (!transcript) { await ctx.reply("Не расслышал, а чтоб мой килт! Скажи ещё раз или напиши текстом. 🎤"); return; }
    await replyFromClaude(ctx, `Голосовое сообщение (расшифровка): ${transcript}`);
  } catch (error) { console.error("[voice]", error.message); await ctx.reply("Не смог распознать голосовое. Попробуй ещё раз или напиши текстом. 🎤"); }
  finally { stopTyping(); if (existsSync(tempPath)) unlinkSync(tempPath); }
});

cron.schedule("0 21 * * *", async () => {
  if (!ownerChatId) return;
  const count = countTransactionsOn(today());
  const message = count === 0
    ? "🎩 Ничто на свете не пахнет лучше, чем чистые деньги — особенно учтённые. Сегодня записей нет. Скинь все траты, а чтоб мой килт! 💰🧮"
    : "💰 Вижу записи за сегодня. Все траты скинул? Каждая копейка — как моя монетка Число-Один — на счету. 🧐";
  await bot.api.sendMessage(ownerChatId, message);
}, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

cron.schedule("0 10 1 * *", async () => {
  if (!ownerChatId) return;
  const goals = getGoalsWithProgress();
  const message = goals.length === 0
    ? "🎩 Новый месяц — самое время завести цель накопления! На отпуск, технику, что угодно. Скажи, на что и сколько нужно — учту. 💰🧧"
    : `💰 Новый месяц, сверим цели:\n${goals.map((g) => `• ${g.name}: ${g.saved.toLocaleString("ru-RU")} из ${g.targetAmount.toLocaleString("ru-RU")} ₽`).join("\n")}\nОтложил в этом месяце? Напиши сумму — учту. 🧐`;
  await bot.api.sendMessage(ownerChatId, message);
}, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

bot.catch((error) => console.error("[telegram]", error.message));

await initDb();
await bot.api.setMyCommands([
  { command: "start", description: "Познакомиться со мной" },
  { command: "summary", description: "Сводка за месяц" },
  { command: "status", description: "Лимиты и цели" },
  { command: "help", description: "Что я умею" },
]);
process.once("SIGINT", () => { closeDb(); bot.stop(); });
process.once("SIGTERM", () => { closeDb(); bot.stop(); });
bot.start({ drop_pending_updates: true, onStart: () => console.log(`[skrudzh] started for ${OWNER_NAME}`) });
