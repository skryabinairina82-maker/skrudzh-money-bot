import { join } from "node:path";
import { output, currentMonthPrefix } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const { initDb, getAllLimitsStatus, getGoalsWithProgress, closeDb } = await import("../lib/db.js");
  await initDb();
  const limits = getAllLimitsStatus(currentMonthPrefix());
  const goals = getGoalsWithProgress();
  closeDb();
  output({ ok: true, limits, goals }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
