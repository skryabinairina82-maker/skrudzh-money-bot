import { join } from "node:path";
import { parseArgs, output } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  if (!args.amount) throw new Error("обязателен параметр --amount");
  const amount = Number(args.amount.replace(",", "."));
  if (!Number.isFinite(amount)) throw new Error("--amount должен быть числом");

  const type = args.type ?? "expense";
  if (!["expense", "income"].includes(type)) throw new Error("--type должен быть expense или income");

  const { initDb, findSimilarTransactions, closeDb } = await import("../lib/db.js");
  await initDb();
  const matches = findSimilarTransactions(amount, args.date ?? null, 14, type).map(
    ([id, date, amount, category, note, source]) => ({ id, date, amount, category, note, source })
  );
  closeDb();
  output({ ok: true, matches }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
