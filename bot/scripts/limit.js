import { join } from "node:path";
import { parseArgs, output } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  if (!args.category) throw new Error("обязателен параметр --category");
  if (!args.amount) throw new Error("обязателен параметр --amount");
  const amount = Number(args.amount.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("--amount должен быть положительным числом");

  const { initDb, setLimit, closeDb } = await import("../lib/db.js");
  await initDb();
  setLimit(args.category, amount);
  closeDb();
  output({ ok: true, category: args.category, amount }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
