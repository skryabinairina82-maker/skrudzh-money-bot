import { join } from "node:path";
import { parseArgs, output } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  const { initDb, createGoal, updateGoal, closeDb } = await import("../lib/db.js");
  await initDb();

  if (args.id) {
    const id = Number(args.id);
    const patch = {};
    if (args.amount) patch.targetAmount = Number(args.amount.replace(",", "."));
    if (args.date) patch.targetDate = args.date;
    updateGoal(id, patch);
    closeDb();
    output({ ok: true, id }, 0);
  } else {
    if (!args.name) throw new Error("обязателен параметр --name (или --id для обновления существующей цели)");
    if (!args.amount) throw new Error("обязателен параметр --amount");
    const targetAmount = Number(args.amount.replace(",", "."));
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) throw new Error("--amount должен быть положительным числом");
    const id = createGoal({ name: args.name, targetAmount, targetDate: args.date ?? null });
    closeDb();
    output({ ok: true, id }, 0);
  }
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
