import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "fs";

interface Target {
  hit: number;
  found: number;
}

type Test<I> = Record<string, I>;

interface LcovRecord {
  filename: string;
  // Count maps line number to { test name: execution count }
  lines: Target & { count: Record<number, Test<number>> };
  // Count maps function name to { test name: execution count }
  functions: Target & { count: Record<string, Test<number>> };
  // Count maps line number to { test name: { branch number: branch taken } }
  branches: Target & { count: Record<number, Test<Record<number, number>>> };
}

// Parse lcov file into records
function parseLcov(text: string): LcovRecord[] {
  const records: LcovRecord[] = [];
  const lines = text.split("\n");
  let current: LcovRecord | null = null;
  let test: string = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    // TN = Test Name
    // TN:[test name]
    if (line.startsWith("TN:")) {
      test = line.slice(3);
      continue;
    }
    // SF = Source File
    // SF:[filename]
    if (line.startsWith("SF:")) {
      current = {
        filename: line.slice(3),
        lines: { found: 0, hit: 0, count: {} },
        functions: { found: 0, hit: 0, count: {} },
        branches: { found: 0, hit: 0, count: {} },
      };
      continue;
    }
    // Skip if no active record
    if (!current) continue;

    // DA = line DAta
    // DA:[line number],[execution count]
    if (line.startsWith("DA:")) {
      const [lineNumStr, countStr] = line.slice(3).split(",");
      const lineNum = Number(lineNumStr);
      const count = Number(countStr);
      if (lineNum >= 0 && count >= 0) {
        if (!(lineNum in current.lines.count)) {
          current.lines.count[lineNum] = {};
        }
        const line = current.lines.count[lineNum]!;
        if (!(test in line)) {
          line[test] = 0;
        }
        line[test]! += count;
      }
    }
    // FNDA = FuNction DAta
    // FNDA:[line number],[function name]
    else if (line.startsWith("FNDA:")) {
      const [countStr, functionName] = line.slice(5).split(",");
      const count = Number(countStr);
      if (count >= 0) {
        if (!(functionName! in current.functions.count)) {
          current.functions.count[functionName!] = {};
        }
        const fn = current.functions.count[functionName!]!;
        if (!(test in fn)) {
          fn[test] = 0;
        }
        fn[test]! += count;
      }
    }
    // BRDA = BRanch DAta
    // BRDA:[line number],[block number],[branch number],[taken]
    else if (line.startsWith("BRDA:")) {
      const [lineNumStr, blockNumStr, branchNumStr, takenStr] = line
        .slice(5)
        .split(",");
      const lineNum = Number(lineNumStr);
      const blockNum = Number(blockNumStr);
      const branchNum = Number(branchNumStr);
      const taken = Number(takenStr);
      if (lineNum >= 0 && blockNum >= 0 && branchNum >= 0 && taken >= 0) {
        if (!(lineNum in current.branches.count)) {
          current.branches.count[lineNum] = {};
        }
        const line = current.branches.count[lineNum]!;
        if (!(test in line)) {
          line[test] = {};
        }
        const branch = line[test]!;
        if (!(branchNum in branch)) {
          branch[branchNum] = 0;
        }
        branch[branchNum]! += taken;
      }
    }
    // LF = Lines Found
    // LF:[number of lines found]
    else if (line.startsWith("LF:")) {
      const hit = Number(line.slice(3));
      if (hit >= 0) current.lines.found = hit;
    }
    // LH = Lines Hit
    // LH:[number of lines hit]
    else if (line.startsWith("LH:")) {
      const hit = Number(line.slice(3));
      if (hit >= 0) current.lines.hit = hit;
    }
    // FNF = FuNctions Found
    // FNF:[number of functions found]
    else if (line.startsWith("FNF:")) {
      const found = Number(line.slice(4));
      if (found >= 0) current.functions.found = found;
    }
    // FNH = FuNctions Hit
    // FNH:[number of functions hit]
    else if (line.startsWith("FNH:")) {
      const hit = Number(line.slice(4));
      if (hit >= 0) current.functions.hit = hit;
    }
    // BRF = BRanches Found
    // BRF:[number of branches found]
    else if (line.startsWith("BRF:")) {
      const found = Number(line.slice(4));
      if (found >= 0) current.branches.found = found;
    }
    // BRH = BRanches Hit
    // BRH:[number of branches hit]
    else if (line.startsWith("BRH:")) {
      const hit = Number(line.slice(4));
      if (hit >= 0) current.branches.hit = hit;
    }
    // end_of_record
    else if (line === "end_of_record") {
      if (current) records.push(current);
      current = null;
    }
  }

  return records;
}

// Pretty print tabular data
function printPretty(headers: string[], rows: string[][]): string {
  const columns = headers.length;
  let widths = headers.map((h) => h.length);
  // One pass to find maximum width of each column
  for (const row of rows) {
    // Fail if any row has incorrect number of columns
    if (row.length != columns) {
      return "";
    }
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(widths[i]!, row[i]!.length);
    }
  }

  const lines: string[] = [];
  // Append headers
  const headerLine =
    "| " + headers.map((h, i) => h.padEnd(widths[i]!)).join(" | ") + " |";
  const delimiterLine =
    "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";
  lines.push(headerLine, delimiterLine);
  // Append rows
  for (const row of rows) {
    const rowLine =
      "| " + row.map((r, i) => r.padEnd(widths[i]!)).join(" | ") + " |";
    lines.push(rowLine);
  }
  return lines.join("\n");
}

function pct(hit: number, found: number): string {
  if (found === 0) {
    return "100.0%";
  }
  return ((100 * hit) / found).toPrecision(4) + "%";
}

// Pretty print a Github Markdown table for the coverage report
function printTable(records: LcovRecord[]): string {
  const headers = [
    "Filename",
    "Lines",
    "Line Coverage",
    "Functions",
    "Function Coverage",
    "Branches",
    "Branch Coverage",
  ];

  const rows = records.map((r) => [
    r.filename,
    `${r.lines.hit}/${r.lines.found}`,
    pct(r.lines.hit, r.lines.found),
    `${r.functions.hit}/${r.functions.found}`,
    pct(r.functions.hit, r.functions.found),
    `${r.branches.hit}/${r.branches.found}`,
    pct(r.branches.hit, r.branches.found),
  ]);
  return printPretty(headers, rows);
}

// Print coverage summary
function printSummary(records: LcovRecord[]): string {
  let linesHit = 0;
  let linesFound = 0;
  let functionsHit = 0;
  let functionsFound = 0;
  let branchesHit = 0;
  let branchesFound = 0;
  for (const record of records) {
    linesHit += record.lines.hit;
    linesFound += record.lines.found;
    functionsHit += record.functions.hit;
    functionsFound += record.functions.found;
    branchesHit += record.branches.hit;
    branchesFound += record.branches.found;
  }
  return `Lines: ${linesHit}/${linesFound} ${pct(linesHit, linesFound)}\nFunctions: ${functionsHit}/${functionsFound} ${pct(functionsHit, functionsFound)}\nBranches: ${branchesHit}/${branchesFound} ${pct(branchesHit, branchesFound)}`;
}

async function run() {
  const token = core.getInput("github_token");
  const lcovPath = core.getInput("lcov_path");

  const octokit = github.getOctokit(token);
  const context = github.context;

  const { repo, owner } = context.repo;
  const prNumber = context.payload.pull_request?.number;

  if (!prNumber) {
    core.warning("Not a PR, skipping comment.");
    return;
  }

  const lcov = fs.readFileSync(lcovPath, "utf-8");
  const records = parseLcov(lcov);
  if (!records.length) {
    core.setFailed(`File at ${lcovPath} has no coverage records.`);
  }

  const table = printTable(records);
  const summary = printSummary(records);

  const body = `
### Code Coverage

${summary}

<details>
<summary>Details</summary>

${table}

</details>
<!-- coverage-report -->
`;

  // Look for existing comment
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find((c) =>
    c.body?.includes("<!-- coverage-report -->"),
  );

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

run();
