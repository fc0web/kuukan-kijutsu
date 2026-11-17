// tests/run-curves.js
// curve-cases.js の各ケースに幾何読み手を通し、
// 期待値（手計算）と照合する。v0.1 に答えがないので rationale で裏取り。

"use strict";

const fs = require("fs");
const path = require("path");
const Reader = require("../readers/geometry.js");
const { cases } = require("./curve-cases.js");

function compareCase(expected, bytype) {
  const problems = [];
  const e = expected;

  // closure
  if (!bytype["curve:closure"]) problems.push("curve:closure finding missing");
  else if (bytype["curve:closure"].value.closed !== e.closed) {
    problems.push("closure: expected=" + e.closed + ", actual=" + bytype["curve:closure"].value.closed);
  }

  // self-intersection
  if (!bytype["curve:self-intersection"]) problems.push("curve:self-intersection finding missing");
  else if (bytype["curve:self-intersection"].value.count !== e.crossings) {
    problems.push("crossings: expected=" + e.crossings + ", actual=" + bytype["curve:self-intersection"].value.count);
  }

  // length
  if (!bytype["curve:length"]) problems.push("curve:length finding missing");
  else if (typeof e.length_about === "number") {
    const L = bytype["curve:length"].value.length;
    const tol = e.length_tol || 0.02;
    const rel = Math.abs(L - e.length_about) / Math.max(e.length_about, 1e-9);
    if (rel > tol) problems.push("length: expected ≈ " + e.length_about.toFixed(4) + ", actual=" + L.toFixed(4) + ", rel diff=" + (rel * 100).toFixed(2) + "%");
  }

  // area emission expectation
  const shouldHaveArea = e.closed && e.crossings === 0 && !e.no_area;
  if (shouldHaveArea) {
    if (!bytype["curve:area"]) {
      problems.push("curve:area finding missing (should be emitted)");
    } else if (typeof e.area_about === "number") {
      const A = bytype["curve:area"].value.area;
      const tol = e.area_tol || 0.02;
      const rel = Math.abs(A - e.area_about) / Math.max(e.area_about, 1e-9);
      if (rel > tol) problems.push("area: expected ≈ " + e.area_about.toFixed(4) + ", actual=" + A.toFixed(4) + ", rel diff=" + (rel * 100).toFixed(2) + "%");
    }
  } else {
    if (bytype["curve:area"]) problems.push("curve:area should NOT be emitted (closed=" + e.closed + ", crossings=" + e.crossings + ")");
  }

  return problems;
}

const answers = {};
const report = {};
let allOk = true;
let passCount = 0, failCount = 0;

for (const c of cases) {
  const shape = c.shape();
  const space = { schema: "kuukan/0.2", shapes: [shape], step: 0, source: "test" };
  const raw = Reader.read(space);
  const checked = [];
  const rejected = [];
  for (const f of raw) {
    const r = Reader.check(f, space);
    if (r.pass) checked.push({ ...f, checked: true, method: r.method });
    else rejected.push({ finding_type: f.type, refs: f.refs, method: r.method });
  }
  const curveFindings = checked.filter(f => f.type && f.type.startsWith("curve:"));
  const bytype = {};
  for (const f of curveFindings) bytype[f.type] = f;

  const problems = compareCase(c.expected, bytype);
  const ok = problems.length === 0 && rejected.length === 0;
  if (ok) passCount++; else { failCount++; allOk = false; }

  answers[c.name] = {
    description: c.description,
    rationale: c.rationale,
    pts_count: shape.pts.length,
    findings: curveFindings.map(f => ({
      type: f.type,
      value: f.value,
      certainty: f.certainty,
      basis: f.basis,
      method: f.method
    })),
    rejected
  };
  report[c.name] = {
    description: c.description,
    pts_count: shape.pts.length,
    expected: c.expected,
    actual: {
      closed: bytype["curve:closure"] ? bytype["curve:closure"].value.closed : null,
      crossings: bytype["curve:self-intersection"] ? bytype["curve:self-intersection"].value.count : null,
      length: bytype["curve:length"] ? bytype["curve:length"].value.length : null,
      has_area: !!bytype["curve:area"],
      area: bytype["curve:area"] ? bytype["curve:area"].value.area : null
    },
    problems, rejected, ok
  };
}

const outPath = path.join(__dirname, "curve-answers.json");
const reportPath = path.join(__dirname, "curve-report.json");
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
console.log("曲線の設定：max_points=" + cfg.curve.max_points + "、間引き間隔=" + cfg.curve.thinning_step_grid + " マス、閉じ許容=" + cfg.curve.closure_tol_grid + " マス、長さ/面積許容=" + (cfg.curve.length_tol_rel * 100) + "%");
console.log("種類ごとの許容：");
for (const k of Object.keys(cfg.byFinding)) console.log("  " + k + "：" + cfg.byFinding[k]);
console.log("");
console.log("=== 曲線のケース照合 ===");
console.log("ケース数:", cases.length, " 合格:", passCount, " 不合格:", failCount);
console.log("");
for (const name of Object.keys(report)) {
  const r = report[name];
  const flag = r.ok ? "" : " ⚠";
  const a = r.actual;
  console.log("  " + name + ": 点数=" + r.pts_count +
    " / closed=" + a.closed + " / crossings=" + a.crossings +
    " / length=" + (a.length !== null ? a.length.toFixed(3) : "?") +
    " / area=" + (a.has_area ? a.area.toFixed(3) : "(なし)") +
    " / check 落ち=" + r.rejected.length + flag);
  if (r.problems.length) for (const p of r.problems) console.log("     ⚠ " + p);
}

process.exit(allOk ? 0 : 1);
