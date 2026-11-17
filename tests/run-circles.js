// tests/run-circles.js
// circle-cases.json の各ケースに幾何読み手を通し、
// 期待される発見と照合する（v0.1 に答えがないので期待値は手計算）。
// 結果を circle-answers.json と circle-report.json に書き出す。

"use strict";

const fs = require("fs");
const path = require("path");
const Reader = require("../readers/geometry.js");

function roundN(v, n) { const k = 10 ** n; return Math.round(v * k) / k; }

function canonCircleFinding(f, space) {
  const segments = space.shapes.filter(s => s.kind === "segment");
  if (f.type === "circle:basic") {
    return {
      category: "circle", type: "basic",
      refs: f.refs.slice(),
      metrics: {
        r: roundN(f.value.r, 4),
        circumference: roundN(f.value.circumference, 4),
        area: roundN(f.value.area, 4)
      }
    };
  }
  if (f.type && f.type.startsWith("circle-line:")) {
    const rel = f.type.slice("circle-line:".length);
    const [cid, sid] = f.refs;
    const s = segments.find(x => x.id === sid);
    const segRef = s ? (s.a < s.b ? s.a + "-" + s.b : s.b + "-" + s.a) : "?-?";
    return { category: "circle-line", type: rel, refs: [cid, segRef] };
  }
  if (f.type && f.type.startsWith("circle-circle:")) {
    const rel = f.type.slice("circle-circle:".length);
    return { category: "circle-circle", type: rel, refs: [...f.refs].sort((a, b) => a - b) };
  }
  if (f.type && f.type.startsWith("circle-triangle:")) {
    const rel = f.type.slice("circle-triangle:".length);
    const [cid, triIds] = f.refs;
    return { category: "circle-triangle", type: rel, refs: [cid, [...triIds].sort((a, b) => a - b)] };
  }
  return null;
}

function key(f) { return f.category + "|" + f.type + "|" + JSON.stringify(f.refs); }

function compareMetrics(expected, actual) {
  // expected が指定したキーだけ照合。数値は 0.1% 相対 or 1e-3 絶対。
  const problems = [];
  if (!expected) return problems;
  for (const k of Object.keys(expected)) {
    const ex = expected[k];
    const ac = actual ? actual[k] : undefined;
    if (typeof ex === "number") {
      if (typeof ac !== "number") { problems.push({ metric: k, expected: ex, actual: ac }); continue; }
      const delta = Math.abs(ex - ac);
      const relOk = delta < 0.001 * Math.max(Math.abs(ex), 1);
      const absOk = delta < 1e-3;
      if (!relOk && !absOk) problems.push({ metric: k, expected: ex, actual: ac });
    } else if (ex !== ac) {
      problems.push({ metric: k, expected: ex, actual: ac });
    }
  }
  return problems;
}

function compareCase(expected, actual) {
  const e = new Map(expected.map(f => [key(f), f]));
  const a = new Map(actual.map(f => [key(f), f]));
  const missing = [], extra = [], metricsDiff = [];
  for (const [k, ex] of e) {
    if (!a.has(k)) { missing.push(ex); continue; }
    const probs = compareMetrics(ex.metrics, a.get(k).metrics);
    if (probs.length) metricsDiff.push({ key: k, problems: probs });
  }
  for (const [k, ac] of a) if (!e.has(k)) extra.push(ac);
  return { missing, extra, metricsDiff };
}

const casesPath = path.join(__dirname, "circle-cases.json");
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")).cases;
const outPath = path.join(__dirname, "circle-answers.json");
const reportPath = path.join(__dirname, "circle-report.json");

const answers = {};
const report = {};
let allOk = true;
let matchTotal = 0, missingTotal = 0, extraTotal = 0, metricsDiffTotal = 0;

for (const c of cases) {
  const raw = Reader.read(c.space);
  const checked = [];
  const rejected = [];
  for (const f of raw) {
    const r = Reader.check(f, c.space);
    if (r.pass) checked.push({ ...f, checked: true, method: r.method });
    else rejected.push({ finding_type: f.type, refs: f.refs, certainty: f.certainty, method: r.method });
  }
  // 円に関する発見のみを抽出
  const circleFindings = checked.filter(f => f.type && (
    f.type === "circle:basic" ||
    f.type.startsWith("circle-line:") ||
    f.type.startsWith("circle-circle:") ||
    f.type.startsWith("circle-triangle:")
  ));
  const canon = circleFindings.map(f => canonCircleFinding(f, c.space)).filter(Boolean)
    .sort((a, b) => key(a).localeCompare(key(b)));
  const expected = [...(c.expected || [])].sort((a, b) => key(a).localeCompare(key(b)));
  const d = compareCase(expected, canon);
  const ok = d.missing.length === 0 && d.extra.length === 0 && d.metricsDiff.length === 0;
  if (!ok) allOk = false;
  const matched = expected.length - d.missing.length;
  matchTotal += matched;
  missingTotal += d.missing.length;
  extraTotal += d.extra.length;
  metricsDiffTotal += d.metricsDiff.length;

  answers[c.name] = {
    description: c.description, rationale: c.rationale,
    findings: canon, rejected
  };
  report[c.name] = {
    description: c.description,
    expected: expected.length,
    actual: canon.length,
    matched,
    missing: d.missing,
    extra: d.extra,
    metrics_diff: d.metricsDiff,
    rejected_by_check: rejected,
    ok
  };
}

const fullReport = { reader_settings: Reader.settings(), cases: report };
fs.writeFileSync(outPath, JSON.stringify(answers, null, 2), "utf8");
fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2), "utf8");

console.log("wrote", outPath);
console.log("wrote", reportPath);
console.log("");
console.log("=== 読み手の設定値（" + Reader.id + " v" + Reader.version + "） ===");
const cfg = Reader.settings();
console.log("説明：" + cfg.description);
console.log("[snap]    TOL=" + cfg.tolerance.snap.TOL + "、ANG=" + cfg.tolerance.snap.ANG_deg + "° ・" + cfg.tolerance.snap.note);
console.log("[nonsnap] TOL=" + cfg.tolerance.nonsnap.TOL + "、ANG=" + cfg.tolerance.nonsnap.ANG_deg + "° ・" + cfg.tolerance.nonsnap.note);
console.log("種類ごとの許容：");
for (const k of Object.keys(cfg.byFinding)) console.log("  " + k + "：" + cfg.byFinding[k]);
console.log("");
console.log("=== 円のケース照合 ===");
console.log("ケース数:", cases.length);
console.log("一致:", matchTotal);
console.log("期待されたが出なかった (missing):", missingTotal);
console.log("期待されていないのに出た (extra):", extraTotal);
console.log("metrics 差分:", metricsDiffTotal);
console.log("");
for (const name of Object.keys(report)) {
  const r = report[name];
  const flag = r.ok ? "" : " ⚠";
  console.log(`  ${name}: 期待=${r.expected} / 実際=${r.actual} / 一致=${r.matched} / check 落ち=${r.rejected_by_check.length}${flag}`);
}

process.exit(allOk ? 0 : 1);
