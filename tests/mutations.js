// tests/mutations.js
// 確かめ役（geometry.check）の検査：わざと間違った発見を作って check に渡し、
// 全部 pass:false が返るかを確かめる。pass:true が1件でも出たら失敗。

"use strict";

const fs = require("fs");
const path = require("path");
const Reader = require("../readers/geometry.js");

// --- 検査に使う空間（整数座標・スナップ扱い） --------------------------
const spaces = {
  // 鈍角三角形（直角でない）
  obtuse: {
    schema: "kuukan/0.2",
    shapes: [
      { id: 1, kind: "point", x: 0, y: 0 },
      { id: 2, kind: "point", x: 6, y: 0 },
      { id: 3, kind: "point", x: 1, y: 1 },
      { id: 4, kind: "segment", a: 1, b: 2 },
      { id: 5, kind: "segment", a: 2, b: 3 },
      { id: 6, kind: "segment", a: 3, b: 1 }
    ],
    step: 0, source: "human"
  },
  // 平行でない2本 と 垂直でない2本 を同時に含む
  notPar: {
    schema: "kuukan/0.2",
    shapes: [
      { id: 1, kind: "point", x: 0, y: 0 },
      { id: 2, kind: "point", x: 5, y: 0 },
      { id: 3, kind: "point", x: 0, y: 1 },
      { id: 4, kind: "point", x: 5, y: 3 },        // 傾き 0.4 → 約22°
      { id: 5, kind: "segment", a: 1, b: 2 },     // 水平
      { id: 6, kind: "segment", a: 3, b: 4 }      // 22° 傾き
    ],
    step: 0, source: "human"
  },
  // 一筆書きできない（4次の点が2つ、奇数次 4 個）
  notEuler: {
    schema: "kuukan/0.2",
    shapes: [
      { id: 1, kind: "point", x: 0, y: 0 },
      { id: 2, kind: "point", x: 3, y: 0 },
      { id: 3, kind: "point", x: 3, y: 3 },
      { id: 4, kind: "point", x: 0, y: 3 },
      { id: 5, kind: "segment", a: 1, b: 2 },
      { id: 6, kind: "segment", a: 2, b: 3 },
      { id: 7, kind: "segment", a: 3, b: 4 },
      { id: 8, kind: "segment", a: 4, b: 1 },
      { id: 9, kind: "segment", a: 1, b: 3 },
      { id: 10, kind: "segment", a: 2, b: 4 }  // 対角線2本で全員次数3（奇数）
    ],
    step: 0, source: "human"
  },
  // 相似でない2つの三角形
  notSim: {
    schema: "kuukan/0.2",
    shapes: [
      { id: 1, kind: "point", x: 0, y: 0 },
      { id: 2, kind: "point", x: 4, y: 0 },
      { id: 3, kind: "point", x: 0, y: 3 },        // 直角3-4-5
      { id: 4, kind: "point", x: 7, y: 0 },
      { id: 5, kind: "point", x: 10, y: 0 },
      { id: 6, kind: "point", x: 7, y: 5 },        // 直角3-5-√34、辺の比が違う
      { id: 7, kind: "segment", a: 1, b: 2 },
      { id: 8, kind: "segment", a: 2, b: 3 },
      { id: 9, kind: "segment", a: 3, b: 1 },
      { id: 10, kind: "segment", a: 4, b: 5 },
      { id: 11, kind: "segment", a: 5, b: 6 },
      { id: 12, kind: "segment", a: 6, b: 4 }
    ],
    step: 0, source: "human"
  },
  // 3点が一直線上にない
  notCol: {
    schema: "kuukan/0.2",
    shapes: [
      { id: 1, kind: "point", x: 0, y: 0 },
      { id: 2, kind: "point", x: 2, y: 1 },     // わずかに上にずれている
      { id: 3, kind: "point", x: 4, y: 0 }
    ],
    step: 0, source: "human"
  },
  // 正方形（面積を少しずらして偽の finding を作る土台）
  sq: {
    schema: "kuukan/0.2",
    shapes: [
      { id: 1, kind: "point", x: 0, y: 0 },
      { id: 2, kind: "point", x: 3, y: 0 },
      { id: 3, kind: "point", x: 3, y: 3 },
      { id: 4, kind: "point", x: 0, y: 3 },
      { id: 5, kind: "segment", a: 1, b: 2 },
      { id: 6, kind: "segment", a: 2, b: 3 },
      { id: 7, kind: "segment", a: 3, b: 4 },
      { id: 8, kind: "segment", a: 4, b: 1 }
    ],
    step: 0, source: "human"
  }
};

// --- わざと間違った発見（mutation） ------------------------------------
const mutations = [
  {
    name: "wrong-right-triangle",
    note: "鈍角三角形に「直角三角形」の札を貼る（ピタゴラスで check 落ちするはず）",
    space: spaces.obtuse,
    finding: {
      key: "geometry:polygon:triangle:right:1-2-3",
      reader: "geometry",
      type: "polygon:triangle:right",
      title: "直角三角形",
      value: {
        n: 3, area: 3, perim: 13.48,
        sides_sorted: [Math.hypot(1, 1), 6, Math.hypot(5, 1)],
        angles_ordered: [60, 60, 60],       // わざと嘘
        angleSum: 180, convex: true,
        vertex_ids_ordered: [1, 2, 3],
        allEq: false, right: true,
        diagPerp: false
      },
      refs: [1, 2, 3], certainty: "厳密",
      basis: "（捏造）", method: "（捏造）"
    }
  },
  {
    name: "wrong-parallel",
    note: "22°傾いた2本に「平行」の札を貼る（外積がゼロでないので check 落ち）",
    space: spaces.notPar,
    finding: {
      key: "geometry:relation:parallel:1-2|3-4",
      reader: "geometry",
      type: "relation:parallel",
      title: "平行",
      value: { angleDiff: 0.0 },     // わざと嘘の値
      basis: "（捏造）",
      refs: [5, 6], certainty: "厳密"
    }
  },
  {
    name: "wrong-perpendicular",
    note: "平行に近い2本に「垂直」の札を貼る（内積がゼロでないので check 落ち）",
    space: spaces.notPar,
    finding: {
      key: "geometry:relation:perpendicular:1-2|3-4",
      reader: "geometry",
      type: "relation:perpendicular",
      title: "垂直",
      value: { angleDiff: 90.0 },    // わざと嘘
      basis: "（捏造）",
      refs: [5, 6], certainty: "厳密"
    }
  },
  {
    name: "wrong-euler-possible",
    note: "一筆書きできない図（奇数次 4 個）に「できる」の札を貼る",
    space: spaces.notEuler,
    finding: {
      key: "geometry:euler:可",
      reader: "geometry",
      type: "euler",
      title: "一筆書きできる",
      value: { possible: true, connected: true, odd: 4, brute: true },
      basis: "（捏造）",
      refs: ["global"], certainty: "厳密"
    }
  },
  {
    name: "wrong-similarity",
    note: "辺の比が違う2つの直角三角形に「相似」の札を貼る",
    space: spaces.notSim,
    finding: {
      key: "geometry:similarity:1-2-3|4-5-6",
      reader: "geometry",
      type: "similarity",
      title: "相似な三角形の組",
      value: { ratio: 1.5 },   // 捏造した比
      basis: "（捏造）",
      refs: [[1, 2, 3], [4, 5, 6]], certainty: "厳密"
    }
  },
  {
    name: "wrong-collinear",
    note: "直線上にない3点に「一直線上」の札を貼る",
    space: spaces.notCol,
    finding: {
      key: "geometry:collinear:1,2,3",
      reader: "geometry",
      type: "collinear",
      title: "3 点が一直線上",
      value: { count: 3 },
      basis: "（捏造）",
      refs: [1, 2, 3], certainty: "厳密"
    }
  },
  {
    name: "wrong-polygon-area",
    note: "正しい正方形の finding の面積だけを 9 → 9.5 に書き換える",
    space: spaces.sq,
    finding: {
      key: "geometry:polygon:quad:square:1-2-3-4",
      reader: "geometry",
      type: "polygon:quad:square",
      title: "正方形",
      value: {
        n: 4,
        area: 9.5,       // 本当は 9
        perim: 12,
        sides_sorted: [3, 3, 3, 3],
        angles_ordered: [90, 90, 90, 90],
        angleSum: 360, convex: true,
        vertex_ids_ordered: [1, 2, 3, 4],
        allEq: true, right: false, diagPerp: true
      },
      refs: [1, 2, 3, 4], certainty: "厳密"
    }
  }
];

// --- 実行 --------------------------------------------------------------
const outcome = [];
let passFail = 0;   // check が通ってしまった件数（＝検査の失敗数）
for (const m of mutations) {
  const r = Reader.check(m.finding, m.space);
  outcome.push({
    name: m.name,
    note: m.note,
    finding_type: m.finding.type,
    finding_title: m.finding.title,
    check_pass: r.pass,
    method: r.method,
    expected: "pass:false（間違った発見は check で落ちるべき）"
  });
  if (r.pass) passFail++;
}

const out = {
  count: mutations.length,
  all_rejected: passFail === 0,
  rejected_count: outcome.filter(o => !o.check_pass).length,
  passed_through_by_mistake: passFail,
  outcome
};

fs.writeFileSync(path.join(__dirname, "mutations-result.json"), JSON.stringify(out, null, 2), "utf8");

console.log("=== mutation test ===");
console.log("わざと間違った発見の数:", out.count);
console.log("check で落ちた数:", out.rejected_count);
console.log("通ってしまった数（＝検査の失敗）:", out.passed_through_by_mistake);
console.log("全部落ちたか:", out.all_rejected);
console.log("");
for (const o of outcome) {
  const flag = o.check_pass ? "❌ pass through（まずい）" : "✓ 落とした";
  console.log(`  [${flag}] ${o.name}: ${o.note}`);
  console.log(`      check の方法: ${o.method}`);
}

process.exit(out.all_rejected ? 0 : 1);
