import { join } from "node:path";
import { parseArgs, output } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  if (!args.id) throw new Error("обязателен параметр --id");
  const id = Number(args.id);

  const { initDb, getTransactionById, deleteTransaction, closeDb } = await import("../lib/db.js");
  await initDb();
  const transaction = getTransactionById(id);
  if (!transaction) {
    closeDb();
    output({ ok: false, error: `запись с id=${id} не найдена` }, 1);
  } else if (args.confirm === "yes") {
    deleteTransaction(id);
    closeDb();
    output({ ok: true, deleted: true, transaction }, 0);
  } else {
    closeDb();
    output({ ok: true, deleted: false, preview: transaction }, 0);
  }
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
