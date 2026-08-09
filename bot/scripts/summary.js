import { join } from "node:path";
import { parseArgs, output, periodRange } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  let from = args.from;
  let to = args.to;
  if (args.period) ({ from, to } = periodRange(args.period));
  if (!from || !to) throw new Error("нужен либо --period week|month, либо --from и --to");

  const { initDb, getIncomeExpenseSummary, closeDb } = await import("../lib/db.js");
  await initDb();
  const summary = getIncomeExpenseSummary(from, to);
  closeDb();
  output({ ok: true, ...summary }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
