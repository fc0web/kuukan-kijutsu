// tests/v01-logic.js
// v0.1 の index.html から、DOM に触れない幾何判定部分だけを抜き出したもの。
// 中身は一切変えない（評価用の答え生成に使う）。
// state = {pts:[{id,x,y}], segs:[{a,b}]}, opts = {snap:true|false}

"use strict";

const GRID = 30;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = v => Math.hypot(v.x, v.y);
const dist = (a, b) => len(sub(a, b));
const U = v => v / GRID;
const fmt = (v, d = 2) => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return Number.isInteger(r) ? String(r) : r.toFixed(d).replace(/0+$/, "");
};

let SNAP = true;
const TOL = () => SNAP ? 1e-6 : 0.02;
const eqRel = (a, b, t) => {
  if (t === undefined) t = TOL();
  return Math.abs(a - b) <= Math.max(1e-9, t * Math.max(Math.abs(a), Math.abs(b)));
};
const ANG_TOL = () => SNAP ? 0.05 : 1.5;

function segIntersect(p1, p2, p3, p4) {
  const r = sub(p2, p1), s = sub(p4, p3), den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p3, p1), s) / den, u = cross(sub(p3, p1), r) / den;
  const e = 1e-6;
  if (t > e && t < 1 - e && u > e && u < 1 - e) return { x: p1.x + t * r.x, y: p1.y + t * r.y };
  return null;
}
function segsTouch(p1, p2, p3, p4) {
  const o = (a, b, c) => Math.sign(Math.round(cross(sub(b, a), sub(c, a)) * 1e6));
  const on = (a, b, c) => Math.min(a.x, b.x) - 1e-6 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-6 && Math.min(a.y, b.y) - 1e-6 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-6;
  const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && on(p1, p2, p3)) return true;
  if (o2 === 0 && on(p1, p2, p4)) return true;
  if (o3 === 0 && on(p3, p4, p1)) return true;
  if (o4 === 0 && on(p3, p4, p2)) return true;
  return false;
}
function segAngle(a, b) {
  let t = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  t = (t + 180) % 180;
  return t;
}
function angDiff(a, b) {
  let d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function findPolygons(P, adj) {
  const ids = [...adj.keys()].sort((a, b) => a - b), out = [], seen = new Set();
  for (const s of ids) {
    const stack = [[s, [s]]];
    while (stack.length && out.length < 60) {
      const [v, path] = stack.pop();
      for (const w of adj.get(v)) {
        if (w === s && path.length >= 3) {
          if (path[1] < path[path.length - 1]) {
            const key = [...path].sort((a, b) => a - b).join(",") + "|" + path.join(",");
            if (!seen.has(key)) {
              seen.add(key);
              const poly = makePoly(path.map(i => P.get(i)), path);
              if (poly) out.push(poly);
            }
          }
        } else if (w > s && !path.includes(w) && path.length < 6) {
          stack.push([w, [...path, w]]);
        }
      }
    }
  }
  return out;
}

function makePoly(V, ids) {
  const n = V.length;
  for (let i = 0; i < n; i++) {
    const a = V[(i + n - 1) % n], b = V[i], c = V[(i + 1) % n];
    if (Math.abs(cross(sub(b, a), sub(c, b))) < 1e-6) return null;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsTouch(V[i], V[(i + 1) % n], V[j], V[(j + 1) % n])) return null;
    }
  }
  let A2 = 0;
  for (let i = 0; i < n; i++) A2 += cross(V[i], V[(i + 1) % n]);
  const orient = Math.sign(A2), area = Math.abs(A2) / 2 / (GRID * GRID);
  const sides = V.map((v, i) => U(dist(v, V[(i + 1) % n])));
  const angles = V.map((v, i) => {
    const a = V[(i + n - 1) % n], c = V[(i + 1) % n];
    const u = sub(a, v), w = sub(c, v);
    let t = Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (len(u) * len(w))))) * 180 / Math.PI;
    const turn = Math.sign(cross(sub(v, a), sub(c, v)));
    return turn === orient ? t : 360 - t;
  });
  const convex = angles.every(t => t < 180);
  const cx = V.reduce((s, v) => s + v.x, 0) / n;
  const cy = V.reduce((s, v) => s + v.y, 0) / n;
  const key = "poly:" + V.map(v => v.x + "," + v.y).sort().join(";");
  const P = {
    n, V, ids, area, sides, angles,
    angleSum: angles.reduce((a, b) => a + b, 0),
    convex, cx, cy, key,
    perim: sides.reduce((a, b) => a + b, 0)
  };
  classify(P);
  return P;
}

function classify(P) {
  const t = ANG_TOL(), right = P.angles.map(a => Math.abs(a - 90) < t);
  if (P.n === 3) {
    const s = [...P.sides].sort((a, b) => a - b);
    const iso = eqRel(s[0], s[1]) || eqRel(s[1], s[2]);
    const equi = eqRel(s[0], s[1]) && eqRel(s[1], s[2]);
    P.right = right.some(Boolean);
    P.sortedSides = s;
    const obtuse = P.angles.some(a => a > 90 + t);
    P.type = equi ? "正三角形" :
      P.right ? (iso ? "直角二等辺三角形" : "直角三角形") :
      iso ? "二等辺三角形" :
      obtuse ? "鈍角三角形" : "鋭角三角形";
    P.family = "tri";
  } else if (P.n === 4) {
    const V = P.V, e = i => segAngle(V[i], V[(i + 1) % 4]);
    const par1 = angDiff(e(0), e(2)) < t;
    const par2 = angDiff(e(1), e(3)) < t;
    const allEq = P.sides.every(x => eqRel(x, P.sides[0]));
    const allRight = right.every(Boolean);
    P.type = !P.convex ? "凹四角形" :
      allRight && allEq ? "正方形" :
      allRight ? "長方形" :
      allEq ? "ひし形" :
      (par1 && par2) ? "平行四辺形" :
      (par1 || par2) ? "台形" :
      (eqRel(P.sides[0], P.sides[1]) && eqRel(P.sides[2], P.sides[3])) ||
      (eqRel(P.sides[1], P.sides[2]) && eqRel(P.sides[3], P.sides[0])) ? "たこ形" : "四角形";
    P.allEq = allEq;
    P.family = "quad";
    const d1 = sub(V[2], V[0]), d2 = sub(V[3], V[1]);
    P.diagPerp = P.convex && Math.abs(angDiff(segAngle(V[0], V[2]), segAngle(V[1], V[3])) - 90) < t;
  } else {
    const reg = P.sides.every(x => eqRel(x, P.sides[0])) &&
      P.angles.every(a => Math.abs(a - P.angles[0]) < t);
    P.type = (reg ? "正" : P.convex ? "" : "凹") +
      ["", "", "", "", "", "五", "六"][P.n] + "角形";
    P.family = "poly";
  }
}

function eulerBrute(edges, budget = 300000) {
  const m = edges.length;
  if (m > 14) return null;
  const used = new Array(m).fill(false);
  let calls = 0;
  const verts = [...new Set(edges.flat())];
  function go(v, k) {
    if (k === m) return true;
    if (++calls > budget) throw 0;
    for (let i = 0; i < m; i++) {
      if (!used[i] && (edges[i][0] === v || edges[i][1] === v)) {
        used[i] = true;
        const w = edges[i][0] === v ? edges[i][1] : edges[i][0];
        if (go(w, k + 1)) return true;
        used[i] = false;
      }
    }
    return false;
  }
  try {
    for (const v of verts) {
      if (go(v, 0)) return true;
    }
    return false;
  } catch (e) {
    return null;
  }
}

function analyze(state, opts) {
  opts = opts || {};
  SNAP = opts.snap !== false;
  const S = state;
  const P = new Map(S.pts.map(p => [p.id, p]));
  const segs = S.segs.map(s => ({ a: P.get(s.a), b: P.get(s.b), ia: s.a, ib: s.b })).filter(s => s.a && s.b);
  const facts = [];
  const adj = new Map();
  S.pts.forEach(p => adj.set(p.id, new Set()));
  segs.forEach(s => { adj.get(s.ia).add(s.ib); adj.get(s.ib).add(s.ia); });
  const segKey = s => [s.a.x + "," + s.a.y, s.b.x + "," + s.b.y].sort().join("-");

  // 交点
  const X = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.ia === t.ia || s.ia === t.ib || s.ib === t.ia || s.ib === t.ib) continue;
      const q = segIntersect(s.a, s.b, t.a, t.b);
      if (q) X.push(q);
    }
  }
  X.forEach(q => facts.push({
    key: "x:" + Math.round(q.x) + "," + Math.round(q.y),
    kind: "交点", fam: "x", x: q.x, y: q.y,
    text: `交点 (${fmt(U(q.x), 1)}, ${fmt(U(q.y), 1)})`,
    why: "2本の線の式を連立して、両方の線分の内側にある点を求めた"
  }));

  // 多角形
  const polys = findPolygons(P, adj);
  for (const pg of polys) {
    const angTxt = pg.angles.map(a => fmt(a, 1) + "°").join("・");
    facts.push({
      key: pg.key, kind: pg.type, fam: pg.family,
      x: pg.cx, y: pg.cy, poly: pg,
      text: `${pg.type}　面積 ${fmt(pg.area)} マス・周 ${fmt(pg.perim)}`,
      why: `面積は靴ひも公式。角は ${angTxt}、合計 ${fmt(pg.angleSum, 1)}°`
    });
  }

  // 関係：平行・垂直
  const rel = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      const d = angDiff(segAngle(s.a, s.b), segAngle(t.a, t.b));
      const share = s.ia === t.ia || s.ia === t.ib || s.ib === t.ia || s.ib === t.ib;
      const mid = { x: (s.a.x + s.b.x + t.a.x + t.b.x) / 4, y: (s.a.y + s.b.y + t.a.y + t.b.y) / 4 };
      const k = [segKey(s), segKey(t)].sort().join("|");
      if (d < ANG_TOL() && !share) {
        const onLine = Math.abs(cross(sub(t.a, s.a), sub(s.b, s.a))) < 1e-6;
        if (!onLine) {
          rel.push({ type: "par", s, t });
          facts.push({
            key: "par:" + k, kind: "平行", fam: "rel", x: mid.x, y: mid.y, s, t,
            text: `平行な2本（長さ ${fmt(U(dist(s.a, s.b)))} と ${fmt(U(dist(t.a, t.b)))}）`,
            why: `向きの差 ${fmt(d, 2)}°`
          });
        }
      }
      if (Math.abs(d - 90) < ANG_TOL()) {
        rel.push({ type: "perp", s, t });
        facts.push({
          key: "perp:" + k, kind: "垂直", fam: "rel", x: mid.x, y: mid.y, s, t,
          text: `直角に交わる向きの2本`,
          why: `向きの差 ${fmt(d, 2)}°（内積がほぼ 0）`
        });
      }
    }
  }

  // 関係：一直線上の点（3点以上）
  const pts = S.pts.slice(0, 80), lines = new Set();
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const on = pts.filter(r =>
        Math.abs(cross(sub(pts[j], pts[i]), sub(r, pts[i]))) <
        (SNAP ? 1e-6 : 0.01 * dist(pts[i], pts[j]) * GRID)
      );
      if (on.length >= 3) {
        const k = on.map(r => r.id).sort((a, b) => a - b).join(",");
        if (!lines.has(k)) {
          lines.add(k);
          const c = {
            x: on.reduce((s, r) => s + r.x, 0) / on.length,
            y: on.reduce((s, r) => s + r.y, 0) / on.length
          };
          facts.push({
            key: "col:" + on.map(r => r.x + "," + r.y).sort().join(";"),
            kind: "一直線上", fam: "rel", x: c.x, y: c.y, line: on,
            text: `${on.length} 点が一直線上`,
            why: "どの2点を選んでも傾きが同じ（外積が 0）"
          });
        }
      }
    }
  }

  // 関係：合同・相似（三角形どうし）
  const tris = polys.filter(p => p.n === 3);
  const pairs = [];
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      const a = tris[i].sortedSides, b = tris[j].sortedSides, r = a[0] / b[0];
      const sim = eqRel(a[1] / b[1], r) && eqRel(a[2] / b[2], r);
      pairs.push({ A: tris[i], B: tris[j], sim, r });
      if (sim) {
        const cong = eqRel(r, 1);
        const k = [tris[i].key, tris[j].key].sort().join("|");
        facts.push({
          key: (cong ? "cong:" : "sim:") + k,
          kind: cong ? "合同" : "相似",
          fam: "rel",
          x: (tris[i].cx + tris[j].cx) / 2,
          y: (tris[i].cy + tris[j].cy) / 2,
          text: cong ? "合同な三角形の組" : `相似な三角形の組（比 ${fmt(r > 1 ? r : 1 / r)} : 1）`,
          why: "三辺の長さの比がすべて等しい"
        });
      }
    }
  }

  // 一筆書き
  let euler = null;
  const edgeVerts = [...adj.entries()].filter(([, s]) => s.size > 0).map(([v]) => v);
  if (segs.length >= 2) {
    const comp = new Set(), st = edgeVerts.length ? [edgeVerts[0]] : [];
    while (st.length) {
      const v = st.pop();
      if (comp.has(v)) continue;
      comp.add(v);
      adj.get(v).forEach(w => st.push(w));
    }
    const connected = comp.size === edgeVerts.length;
    const odd = edgeVerts.filter(v => adj.get(v).size % 2 === 1).length;
    const ruleSays = connected && (odd === 0 || odd === 2);
    const brute = connected ? eulerBrute(segs.map(s => [s.ia, s.ib])) : false;
    euler = { connected, odd, ruleSays, brute, sig: segs.map(segKey).sort().join("|"), m: segs.length };
    const cx = S.pts.reduce((s, p) => s + p.x, 0) / (S.pts.length || 1);
    const cy = S.pts.reduce((s, p) => s + p.y, 0) / (S.pts.length || 1);
    facts.push({
      key: "euler:" + connected + ":" + ruleSays,
      kind: ruleSays ? "一筆書きできる" : "一筆書きできない",
      fam: "euler", x: cx, y: cy,
      text: !connected ? "線が離れているので一筆書きできない" :
        `一筆書き${ruleSays ? "できる" : "できない"}（奇数本の線が集まる点 ${odd} 個）`,
      why: brute === null ? "線が多いので総当たりの照合は省略" :
        `総当たりで実際に辿って照合：${brute ? "辿れた" : "辿れない"}`
    });
  }
  return { facts, polys, X, rel, pairs, euler, segs };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { analyze, GRID };
}
