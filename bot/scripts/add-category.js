import { join } from "node:path";
import { parseArgs, output } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  if (!args.name) throw new Error("обязателен параметр --name");

  const { initDb, addCategory, closeDb } = await import("../lib/db.js");
  await initDb();
  addCategory(args.name);
  closeDb();
  output({ ok: true, name: args.name }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
