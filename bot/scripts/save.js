import { join } from "node:path";
import { parseArgs, output } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  if (!args.goal_id) throw new Error("обязателен параметр --goal-id (узнать через scripts/status.js)");
  if (!args.amount) throw new Error("обязателен параметр --amount");
  if (!args.date) throw new Error("обязателен параметр --date");
  const goalId = Number(args.goal_id);
  const amount = Number(args.amount.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("--amount должен быть положительным числом");

  const { initDb, addGoalEntry, getGoalsWithProgress, closeDb } = await import("../lib/db.js");
  await initDb();
  addGoalEntry({ goalId, amount, date: args.date, note: args.note ?? null });
  const goal = getGoalsWithProgress().find((item) => item.id === goalId);
  closeDb();
  output({ ok: true, goal }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
