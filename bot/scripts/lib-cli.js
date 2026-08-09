export function parseArgs(argv) {
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

export function output(payload, exitCode) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = exitCode;
}

export function currentMonthPrefix() {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit" }).format(new Date());
}

function toISODate(date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

export function periodRange(period) {
  const now = new Date();
  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: toISODate(from), to: toISODate(to) };
  }
  if (period === "week") {
    const day = (now.getDay() + 6) % 7; // 0 = Monday
    const from = new Date(now);
    from.setDate(now.getDate() - day);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from: toISODate(from), to: toISODate(to) };
  }
  throw new Error(`неизвестный период: ${period} (ожидается week или month)`);
}
