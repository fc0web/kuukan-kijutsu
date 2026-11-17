// tests/canonical.js
// 発見の並びを、v0.1 と v0.2 で同じ形で並べ替えて比較できる「標準形」に変換する。
// - 多角形：種類 + 頂点 id の並び（昇順）
// - 平行・垂直：線の対（線を両端点 id の昇順ペアで表す）
// - 一直線上：点 id の並び（昇順）
// - 交点：マス座標（y 上向き、小数2桁丸め）
// - 相似・合同：2つの三角形の頂点 id 集合（辞書順で並べる）
// - 一筆書き：可／不可

"use strict";

const GRID = 30;

function roundN(v, n) {
  const k = 10 ** n;
  return Math.round(v * k) / k;
}

function segRef(ia, ib) {
  return (ia < ib ? ia + "-" + ib : ib + "-" + ia);
}

function canonicalizeV01(result) {
  const out = [];
  for (const pg of result.polys) {
    out.push({
      category: "polygon",
      type: pg.type,
      refs: [...pg.ids].sort((a, b) => a - b),
      metrics: {
        n: pg.n,
        area: roundN(pg.area, 4),
        perim: roundN(pg.perim, 4),
        sides_sorted: pg.sides.map(s => roundN(s, 4)).sort((a, b) => a - b),
        angleSum: roundN(pg.angleSum, 2),
        convex: pg.convex
      }
    });
  }
  for (const q of result.X) {
    out.push({
      category: "intersection",
      type: "交点",
      refs: [roundN(q.x / GRID, 2) + "," + roundN(-q.y / GRID, 2)]
    });
  }
  for (const r of result.rel) {
    out.push({
      category: r.type === "par" ? "relation:parallel" : "relation:perpendicular",
      type: r.type === "par" ? "平行" : "垂直",
      refs: [segRef(r.s.ia, r.s.ib), segRef(r.t.ia, r.t.ib)].sort()
    });
  }
  for (const f of result.facts.filter(f => f.kind === "一直線上")) {
    out.push({
      category: "collinear",
      type: "一直線上",
      refs: f.line.map(p => p.id).sort((a, b) => a - b)
    });
  }
  for (const p of result.pairs) {
    if (p.sim) {
      const cong = Math.abs(p.r - 1) < 1e-6;
      const a = [...p.A.ids].sort((a, b) => a - b);
      const b = [...p.B.ids].sort((a, b) => a - b);
      const refs = [a, b].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
      out.push({
        category: cong ? "congruence" : "similarity",
        type: cong ? "合同" : "相似",
        refs,
        metrics: { ratio: roundN(p.r > 1 ? p.r : 1 / p.r, 4) }
      });
    }
  }
  if (result.euler) {
    out.push({
      category: "euler",
      type: result.euler.ruleSays ? "可" : "不可",
      refs: ["global"],
      metrics: {
        connected: result.euler.connected,
        odd: result.euler.odd,
        brute: result.euler.brute
      }
    });
  }
  return sortFindings(out);
}

function canonicalizeV02(findings) {
  // v0.2 reader は最初から canonical に近い形で発見を返す前提。
  // ここでは metrics を四捨五入し、refs を並べ直すだけ。
  const out = findings.map(f => {
    const g = {
      category: f.category,
      type: f.type,
      refs: normalizeRefs(f.category, f.refs)
    };
    if (f.metrics) {
      g.metrics = normalizeMetrics(f.category, f.metrics);
    }
    return g;
  });
  return sortFindings(out);
}

function normalizeRefs(category, refs) {
  if (category === "similarity" || category === "congruence") {
    const pair = refs.map(arr => [...arr].sort((a, b) => a - b));
    return pair.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  }
  if (category === "intersection") {
    return refs.map(r => {
      if (typeof r === "string") return r;
      return roundN(r.x, 2) + "," + roundN(r.y, 2);
    });
  }
  if (Array.isArray(refs)) return [...refs].sort((a, b) => (typeof a === "number" ? a - b : String(a).localeCompare(String(b))));
  return refs;
}

function normalizeMetrics(category, m) {
  const o = {};
  if (category === "polygon") {
    o.n = m.n;
    o.area = roundN(m.area, 4);
    o.perim = roundN(m.perim, 4);
    o.sides_sorted = m.sides_sorted.map(s => roundN(s, 4)).sort((a, b) => a - b);
    o.angleSum = roundN(m.angleSum, 2);
    o.convex = m.convex;
  } else if (category === "similarity" || category === "congruence") {
    o.ratio = roundN(m.ratio, 4);
  } else if (category === "euler") {
    o.connected = m.connected;
    o.odd = m.odd;
    o.brute = m.brute;
  } else {
    Object.assign(o, m);
  }
  return o;
}

function canonicalKey(f) {
  return f.category + "|" + f.type + "|" + JSON.stringify(f.refs);
}

function sortFindings(arr) {
  return arr.slice().sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b)));
}

function diff(a, b) {
  const keyMap = x => new Map(x.map(f => [canonicalKey(f), f]));
  const A = keyMap(a), B = keyMap(b);
  const onlyInA = [], onlyInB = [], metricsDiff = [];
  for (const [k, va] of A) {
    if (!B.has(k)) onlyInA.push(va);
    else {
      const vb = B.get(k);
      const ma = JSON.stringify(va.metrics || null);
      const mb = JSON.stringify(vb.metrics || null);
      if (ma !== mb) metricsDiff.push({ key: k, v01: va.metrics, v02: vb.metrics });
    }
  }
  for (const [k, vb] of B) {
    if (!A.has(k)) onlyInB.push(vb);
  }
  return { onlyInA, onlyInB, metricsDiff };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { canonicalizeV01, canonicalizeV02, canonicalKey, sortFindings, diff, GRID, roundN };
}
