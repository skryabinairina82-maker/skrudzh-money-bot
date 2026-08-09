import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { parseArgs, output, periodRange } from "./lib-cli.js";

const AGENT_HOME = process.env.AGENT_HOME;

// Последовательная синяя шкала (magnitude, light -> dark), шаги 200..700 из reference-палитры dataviz-скилла.
const SEQUENTIAL_BLUE = [
  "#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6",
  "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4",
];

try {
  if (!AGENT_HOME) throw new Error("AGENT_HOME is required");
  const { config } = await import("dotenv");
  config({ path: join(AGENT_HOME, ".env"), override: true });

  const args = parseArgs(process.argv.slice(2));
  let from = args.from;
  let to = args.to;
  if (args.period) ({ from, to } = periodRange(args.period));
  if (!from || !to) throw new Error("нужен либо --period week|month, либо --from и --to");
  const kind = args.kind === "income" ? "income" : "expense";

  const { initDb, getSummaryByCategory, closeDb } = await import("../lib/db.js");
  await initDb();
  const summary = getSummaryByCategory(from, to, kind);
  closeDb();

  if (summary.byCategory.length === 0) throw new Error("нет данных за период");

  // byCategory уже отсортирован по убыванию (SQL ORDER BY total DESC) — для горизонтального
  // бара разворачиваем, чтобы самая крупная статья была сверху, и красим по рангу: темнее — больше.
  const rows = [...summary.byCategory].reverse();
  const colorFor = (rank, count) => SEQUENTIAL_BLUE[Math.round((rank / Math.max(count - 1, 1)) * (SEQUENTIAL_BLUE.length - 1))];

  const chartConfig = {
    type: "horizontalBar",
    data: {
      labels: rows.map((row) => row.category),
      datasets: [{
        data: rows.map((row) => Math.round(row.total)),
        backgroundColor: rows.map((_, index) => colorFor(rows.length - 1 - index, rows.length)),
      }],
    },
    options: {
      title: { display: true, text: `${kind === "income" ? "Доходы" : "Расходы"} ${from} — ${to}`, fontSize: 20 },
      legend: { display: false },
      scales: {
        xAxes: [{ ticks: { beginAtZero: true, fontSize: 13 }, gridLines: { color: "#e1e0d9" } }],
        yAxes: [{ ticks: { fontSize: 14 }, gridLines: { display: false } }],
      },
      plugins: {
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#0b0b0b",
          font: { size: 13, weight: "bold" },
        },
      },
    },
  };

  const height = Math.max(260, 90 + rows.length * 55);

  const response = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chart: chartConfig, width: 800, height, backgroundColor: "white", format: "png", version: "2" }),
  });
  if (!response.ok) throw new Error(`QuickChart HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const path = `/tmp/skrudzh_chart_${Date.now()}.png`;
  writeFileSync(path, buffer);

  output({ ok: true, path, total: summary.total }, 0);
} catch (error) {
  output({ ok: false, error: error.message }, 1);
}
