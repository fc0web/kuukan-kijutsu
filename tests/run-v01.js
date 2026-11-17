// tests/run-v01.js
// cases.json の各ケースを v0.1 ロジックで処理し、
// 発見の並びを標準形にして v01-answers.json に書き出す。
// 新 shapes 形式 → v0.1 state 変換：(x_grid, y_grid) → (x_grid*30, -y_grid*30)

"use strict";

const fs = require("fs");
const path = require("path");
const { analyze, GRID } = require("./v01-logic.js");
const { canonicalizeV01 } = require("./canonical.js");

function toV01State(space) {
  const pts = [];
  const segs = [];
  for (const s of space.shapes) {
    if (s.kind === "point") {
      pts.push({ id: s.id, x: s.x * GRID, y: -s.y * GRID });
    } else if (s.kind === "segment") {
      segs.push({ a: s.a, b: s.b });
    }
    // circle / curve は accepts 外相当として v0.1 では無視（この版にはそもそも扱いがない）
  }
  return { pts, segs, nextId: 1 + Math.max(0, ...space.shapes.map(s => s.id || 0)) };
}

const casesPath = path.join(__dirname, "cases.json");
const outPath = path.join(__dirname, "v01-answers.json");
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")).cases;

const answers = {};
for (const c of cases) {
  const state = toV01State(c.space);
  const result = analyze(state, { snap: true });
  answers[c.name] = {
    description: c.description,
    findings: canonicalizeV01(result)
  };
}

fs.writeFileSync(outPath, JSON.stringify(answers, null, 2), "utf8");
console.log("wrote", outPath);
console.log("cases:", Object.keys(answers).length);
for (const [name, a] of Object.entries(answers)) {
  console.log("  " + name + ": " + a.findings.length + " findings");
}
