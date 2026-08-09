import { join } from "node:path";

const AGENT_HOME = process.env.AGENT_HOME;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`неизвестный аргумент: ${token}`);
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replaceAll("-", "_");
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`не указано значение для --${rawKey}`);
    values[key] = value;
  }
  return values;
}

function output(payload, exitCode) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = exitCode;
}

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  const required = ["date", "amount", "category"];
  for (const key of required) if (!args[key]) throw new Error(`обязателен параметр --${key}`);

  const amount = Number(args.amount.replace(",", "."));
  if (!Number.isFinite(amount)) throw new Error("--amount должен быть числом");
  const source = args.source ?? "text";
  if (!["text", "photo"].includes(source)) throw new Error("--source должен быть text или photo");
  const type = args.type ?? "expense";
  if (!["expense", "income"].includes(type)) throw new Error("--type должен быть expense или income");

  const { initDb, addTransaction, closeDb } = await import("../lib/db.js");
  await initDb();
  const entry = {
    date: args.date,
    amount,
    category: args.category,
    note: args.note ?? "",
    source,
    type,
  };
  const id = addTransaction(entry);
  closeDb();
  output({ ok: true, id }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
