import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = resolve(root, ".project-test-results.json");
const txtPath = resolve(root, "PROJECT_ACCURACY_AND_OUTPUT.txt");
const vitestCli = resolve(root, "node_modules/vitest/vitest.mjs");
const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

let status = "NOT RUN";
let passed = 0;
let failed = 0;
let skipped = 0;
let total = 0;
let detail = "";

if (!existsSync(vitestCli)) {
  detail = "Vitest dependencies not found. Install project dependencies, then run again.";
} else {
  if (existsSync(jsonPath)) rmSync(jsonPath, { force: true });
  const run = spawnSync(process.execPath, [vitestCli, "run", "--reporter=json", `--outputFile=${jsonPath}`], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  try {
    if (existsSync(jsonPath)) {
      const report = JSON.parse(readFileSync(jsonPath, "utf8"));
      const counts = report.numTests ?? {};
      passed = counts.passed ?? 0;
      failed = counts.failed ?? 0;
      skipped = counts.pending ?? 0;
      total = counts.total ?? passed + failed + skipped;
      status = run.status === 0 && failed === 0 ? "PASS" : "FAIL";
      detail = `${report.numPassedTestSuites ?? 0} test suites passed; ${report.numFailedTestSuites ?? 0} failed.`;
    } else {
      status = run.error?.code === "ETIMEDOUT" ? "TIMEOUT" : "ERROR";
      detail = (run.error?.message || run.stderr || run.stdout || "Vitest did not produce a report.")
        .trim()
        .split("\n")
        .slice(0, 5)
        .join(" ")
        .slice(0, 500);
    }
  } catch (error) {
    status = "ERROR";
    detail = `Could not read Vitest JSON report: ${error.message}`;
  }
}

const rate = total > 0 ? `${((passed / total) * 100).toFixed(2)}%` : "N/A";
const rows = [
  ["Last updated", timestamp],
  ["Automated test run", status],
  ["Tests passed", String(passed)],
  ["Tests failed", String(failed)],
  ["Tests skipped/pending", String(skipped)],
  ["Total tests", String(total)],
  ["Test pass rate (passed / total)", rate],
];
const table = (headers, data) => {
  const widths = headers.map((header, index) => Math.max(header.length, ...data.map((row) => row[index].length)));
  const line = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const format = (row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [line, format(headers), line, ...data.map(format), line].join("\n");
};

const content = `NEXUSPAY — PROJECT ACCURACY AND OUTPUT
Generated automatically whenever the project is started, built, or tested.

1. LATEST AUTOMATED TEST RESULTS
${table(["Measure", "Current result"], rows)}

Run detail: ${detail.replace(/\s+/g, " ")}

Test pass rate is a software test metric, not machine-learning model accuracy. It measures passed automated checks divided by all reported tests. It does not establish banking transaction correctness in production.

2. ACCURACY RUBRIC (AS SHOWN IN THE PROVIDED RUBRIC)
${table(["Criterion", "Maximum", "Evidence / current assessment"], [
  ["Accuracy of Results", "10", `${status === "PASS" ? `Automated test pass rate: ${rate}` : `No verified pass result (${status})`}; no labeled benchmark is configured.`],
  ["Technical Competence", "10", "Not automatically scored; requires evaluator review."],
  ["Innovative and Sustainable Features", "10", "Not automatically scored; requires evaluator review."],
  ["Utility to Society", "10", "Not automatically scored; requires evaluator review."],
  ["Presentation Skills", "10", "Not automatically scored; requires evaluator review."],
  ["TOTAL", "50", "Only the test evidence above is updated automatically; rubric marks require human evaluation."],
])}

3. PROJECT OUTPUT SUMMARY
NexusPay provides PostgreSQL-backed account registration/login, multi-currency accounts, internal transfers, beneficiary management, and transaction history, plus MongoDB-backed notifications and activity logging. Banking routes use PostgreSQL; PostgreSQL schema migrations are applied by the API at startup. The dashboard still displays example banking data and is not yet wired to the account and transaction APIs.

Example successful transfer output (illustrative shape; live values depend on runtime data):
{
  "status": "completed",
  "amount": "100.50",
  "currency": "USD",
  "referenceId": "TXN-<generated-reference>"
}

4. DOCUMENTATION ACCURACY NOTES
- Transaction search uses PostgreSQL full-text search; it does not search MongoDB activity logs or notifications.
- The dashboard uses example data for banking screens. Backend resource APIs exist, but the dashboard does not yet call them.
- The single-transaction lookup endpoint currently returns HTTP 501.
- Automated tests do not establish production transaction correctness or search quality.
`;

writeFileSync(txtPath, content, "utf8");
if (existsSync(jsonPath)) rmSync(jsonPath, { force: true });
console.log(`Updated ${txtPath}`);
console.log(`Test status: ${status}; ${passed}/${total} passed (${rate}).`);

if (process.argv.includes("--strict") && (status === "FAIL" || status === "ERROR" || status === "TIMEOUT")) {
  process.exitCode = 1;
}
