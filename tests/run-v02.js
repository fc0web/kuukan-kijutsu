// tests/run-v02.js
// cases.json の各ケースを v0.2 の幾何読み手に渡し、
// 発見の並びを標準形にして v02-answers.json に書き出す。
// さらに v01-answers.json と差分を取り、compare-report.json に書き出す。

"use strict";

const fs = require("fs");
const path = require("path");
const Reader = require("../readers/geometry.js");
const { canonicalizeV01, canonicalKey, sortFindings, diff, roundN } = require("./canonical.js");

// v0.2 発見を canonical 形に正規化（v0.1 と比較できる形）
function toCanonical(f) {
  const out = { type: f.title, refs: f.refs };
  if (f.type.startsWith("polygon:")) {
    out.category = "polygon";
    out.metrics = {
      n: f.value.n,
      area: roundN(f.value.area, 4),
      perim: roundN(f.value.perim, 4),
      sides_sorted: f.value.sides_sorted.map(s => roundN(s, 4)).sort((a, b) => a - b),
      angleSum: roundN(f.value.angleSum, 2),
      convex: f.value.convex
    };
    out.refs = [...f.refs].sort((a, b) => a - b);
  } else if (f.type === "intersection") {
    out.category = "intersection";
    out.type = "交点";
    out.refs = [roundN(f.value.x, 2) + "," + roundN(f.value.y, 2)];
  } else if (f.type === "relation:parallel") {
    out.category = "relation:parallel";
    out.type = "平行";
    // refs: 線分 id → 端点 id ペア文字列に変換（v0.1 と揃える）
    out.refs = segsAsPairRefs(f);
  } else if (f.type === "relation:perpendicular") {
    out.category = "relation:perpendicular";
    out.type = "垂直";
    out.refs = segsAsPairRefs(f);
  } else if (f.type === "collinear") {
    out.category = "collinear";
    out.type = "一直線上";
    out.refs = [...f.refs].sort((a, b) => a - b);
  } else if (f.type === "similarity" || f.type === "congruence") {
    out.category = f.type;
    out.type = f.type === "congruence" ? "合同" : "相似";
    const pair = f.refs.map(arr => [...arr].sort((a, b) => a - b));
    out.refs = pair.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    out.metrics = { ratio: roundN(f.value.ratio, 4) };
  } else if (f.type === "euler") {
    out.category = "euler";
    out.type = f.value.possible ? "可" : "不可";
    out.refs = ["global"];
    out.metrics = {
      connected: f.value.connected,
      odd: f.value.odd,
      brute: f.value.brute
    };
  } else {
    out.category = f.type;
  }
  return out;
}

// 線分 id → "端点1-端点2" へ変換（canonical と揃える）
function segsAsPairRefs(f) {
  // f.refs = [seg_id_a, seg_id_b]。元の空間から端点 id を引く。
  // 空間アクセスのために __space をグローバルで渡す（この runner 内のみ）
  const space = toCanonical.__space;
  const segs = space.shapes.filter(s => s.kind === "segment");
  const refs = f.refs.map(sid => {
    const s = segs.find(x => x.id === sid);
    if (!s) return "?-?";
    return s.a < s.b ? s.a + "-" + s.b : s.b + "-" + s.a;
  });
  return refs.sort();
}

function canonicalizeFindings(findings, space) {
  toCanonical.__space = space;
  const out = findings.map(toCanonical);
  toCanonical.__space = null;
  return sortFindings(out);
}

const casesPath = path.join(__dirname, "cases.json");
const v01Path = path.join(__dirname, "v01-answers.json");
const outPath = path.join(__dirname, "v02-answers.json");
const reportPath = path.join(__dirname, "compare-report.json");

const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")).cases;
const v01 = JSON.parse(fs.readFileSync(v01Path, "utf8"));

const v02 = {};
const report = {};
let matchTotal = 0, mismatchTotal = 0, metricsDiffTotal = 0;

for (const c of cases) {
  const rawFindings = Reader.read(c.space);
  // check を個別にかけて pass したものだけ残す
  const checked = [];
  const rejected = [];
  for (const f of rawFindings) {
    const r = Reader.check(f, c.space);
    if (r.pass) {
      checked.push({ ...f, checked: true, method: r.method });
    } else {
      rejected.push({ finding: f, method: r.method });
    }
  }
  const canon = canonicalizeFindings(checked, c.space);
  v02[c.name] = { description: c.description, findings: canon, rejected };

  const v01Findings = v01[c.name].findings;
  const d = diff(v01Findings, canon);
  const match = v01Findings.length - d.onlyInA.length;
  matchTotal += match;
  mismatchTotal += d.onlyInA.length + d.onlyInB.length;
  metricsDiffTotal += d.metricsDiff.length;
  report[c.name] = {
    description: c.description,
    v01_count: v01Findings.length,
    v02_count: canon.length,
    matched: match,
    only_in_v01: d.onlyInA,
    only_in_v02: d.onlyInB,
    metrics_diff: d.metricsDiff,
    rejected_by_check: rejected
  };
}

fs.writeFileSync(outPath, JSON.stringify(v02, null, 2), "utf8");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("wrote", outPath);
console.log("wrote", reportPath);
console.log("");
console.log("=== 照合サマリー ===");
console.log("ケース数:", cases.length);
console.log("一致:", matchTotal);
console.log("不一致 (only_in_v01 + only_in_v02):", mismatchTotal);
console.log("metrics の差分:", metricsDiffTotal);
console.log("");
for (const name of Object.keys(report)) {
  const r = report[name];
  const flag = (r.only_in_v01.length || r.only_in_v02.length || r.metrics_diff.length) ? " ⚠" : "";
  console.log(`  ${name}: v0.1=${r.v01_count} / v0.2=${r.v02_count} / 一致=${r.matched} / check 落ち=${r.rejected_by_check.length}${flag}`);
}
