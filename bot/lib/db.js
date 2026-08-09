import initSqlJs from "sql.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const AGENT_HOME = process.env.AGENT_HOME;
if (!AGENT_HOME) throw new Error("AGENT_HOME is required");

const DATA_DIR = join(AGENT_HOME, "data");
const DB_PATH = join(DATA_DIR, "skrudzh.db");
const MIGRATIONS_DIR = process.env.SKRUDZH_MIGRATIONS_DIR || join(import.meta.dirname, "..", "migrations");

let db = null;
let saveTimer = null;
let dirty = false;

function saveToDisk() {
  if (!db) return;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, Buffer.from(db.export()));
  dirty = false;
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveToDisk(); } catch (error) { console.error("[db] save failed:", error.message); }
  }, 2000);
}

function runMigrations() {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  const applied = new Set((db.exec("SELECT version FROM schema_migrations")[0]?.values || []).map(([version]) => version));
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  let appliedCount = 0;

  for (const file of files) {
    const version = Number(file.match(/^\d+/)[0]);
    if (applied.has(version)) continue;
    const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    db.run("BEGIN");
    try {
      for (const statement of statements) db.run(statement);
      db.run("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
    console.error(`[db] applied ${file}`);
    appliedCount += 1;
  }
  return appliedCount;
}

export async function initDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  const SQL = await initSqlJs();
  db = new SQL.Database(existsSync(DB_PATH) ? readFileSync(DB_PATH) : undefined);
  // saveToDisk() только если реально что-то поменялось в схеме — иначе любой процесс,
  // даже read-only (сводка, проверка дублей), перезаписывает файл своим снапшотом
  // и может затереть изменения, сохранённые параллельно другим процессом.
  if (runMigrations() > 0) saveToDisk();
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database is not initialized");
  return db;
}

export function countTransactionsOn(date) {
  const result = getDb().exec("SELECT COUNT(*) FROM transactions WHERE date = ?", [date]);
  return result[0]?.values[0]?.[0] || 0;
}

export function findSimilarTransactions(amount, referenceDate = null, windowDays = 14, type = "expense") {
  const rows = getDb().exec(
    "SELECT id, date, amount, category, note, source FROM transactions WHERE amount = ? AND type = ? ORDER BY date DESC",
    [amount, type]
  )[0]?.values ?? [];
  if (!referenceDate) return rows;
  const reference = new Date(referenceDate).getTime();
  return rows.filter(([, date]) => Math.abs(new Date(date).getTime() - reference) <= windowDays * 86400000);
}

export function addTransaction({ date, amount, category, note = null, source = "text", type = "expense" }) {
  getDb().run(
    "INSERT INTO transactions (date, amount, category, note, source, type) VALUES (?, ?, ?, ?, ?, ?)",
    [date, amount, category, note, source, type]
  );
  scheduleSave();
  return getDb().exec("SELECT last_insert_rowid()")[0].values[0][0];
}

export function setLimit(category, amount) {
  getDb().run(
    "INSERT INTO limits (category, amount, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount, updated_at = CURRENT_TIMESTAMP",
    [category, amount]
  );
  scheduleSave();
}

function spentInMonth(category, monthPrefix) {
  const result = getDb().exec(
    "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE category = ? AND substr(date, 1, 7) = ?",
    [category, monthPrefix]
  );
  return result[0]?.values[0]?.[0] || 0;
}

export function getLimitStatus(category, monthPrefix) {
  const row = getDb().exec("SELECT amount FROM limits WHERE category = ?", [category]);
  const amount = row[0]?.values[0]?.[0];
  if (amount === undefined) return null;
  return { category, amount, spent: spentInMonth(category, monthPrefix) };
}

export function getAllLimitsStatus(monthPrefix) {
  const rows = getDb().exec("SELECT category, amount FROM limits")[0]?.values ?? [];
  return rows.map(([category, amount]) => ({ category, amount, spent: spentInMonth(category, monthPrefix) }));
}

export function createGoal({ name, targetAmount, targetDate = null }) {
  getDb().run(
    "INSERT INTO goals (name, target_amount, target_date) VALUES (?, ?, ?)",
    [name, targetAmount, targetDate]
  );
  scheduleSave();
  return getDb().exec("SELECT last_insert_rowid()")[0].values[0][0];
}

export function updateGoal(id, { targetAmount, targetDate }) {
  if (targetAmount !== undefined) getDb().run("UPDATE goals SET target_amount = ? WHERE id = ?", [targetAmount, id]);
  if (targetDate !== undefined) getDb().run("UPDATE goals SET target_date = ? WHERE id = ?", [targetDate, id]);
  scheduleSave();
}

export function addGoalEntry({ goalId, amount, date, note = null }) {
  getDb().run(
    "INSERT INTO goal_entries (goal_id, amount, date, note) VALUES (?, ?, ?, ?)",
    [goalId, amount, date, note]
  );
  scheduleSave();
  return getDb().exec("SELECT last_insert_rowid()")[0].values[0][0];
}

export function getGoalsWithProgress() {
  const goals = getDb().exec("SELECT id, name, target_amount, target_date FROM goals WHERE active = 1")[0]?.values ?? [];
  return goals.map(([id, name, targetAmount, targetDate]) => {
    const savedRow = getDb().exec("SELECT COALESCE(SUM(amount), 0) FROM goal_entries WHERE goal_id = ?", [id]);
    const saved = savedRow[0]?.values[0]?.[0] || 0;
    return { id, name, targetAmount, targetDate, saved };
  });
}

export function getTransactionById(id) {
  const row = getDb().exec(
    "SELECT id, date, amount, category, note, source FROM transactions WHERE id = ?",
    [id]
  )[0]?.values[0];
  if (!row) return null;
  const [rid, date, amount, category, note, source] = row;
  return { id: rid, date, amount, category, note, source };
}

export function deleteTransaction(id) {
  getDb().run("DELETE FROM transactions WHERE id = ?", [id]);
  scheduleSave();
}

export function addCategory(name) {
  getDb().run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [name]);
  scheduleSave();
}

export function getSummaryByCategory(from, to, type = "expense") {
  const rows = getDb().exec(
    "SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM transactions WHERE date >= ? AND date <= ? AND type = ? GROUP BY category ORDER BY total DESC",
    [from, to, type]
  )[0]?.values ?? [];
  const byCategory = rows.map(([category, total, count]) => ({ category, total, count }));
  const total = byCategory.reduce((sum, row) => sum + row.total, 0);
  return { from, to, total, byCategory };
}

export function getIncomeExpenseSummary(from, to) {
  const expense = getSummaryByCategory(from, to, "expense");
  const income = getSummaryByCategory(from, to, "income");
  return { from, to, expense, income, balance: income.total - expense.total };
}

export function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (dirty) saveToDisk();
}

export function closeDb() {
  saveNow();
  db?.close();
  db = null;
}
