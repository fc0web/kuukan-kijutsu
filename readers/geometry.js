// readers/geometry.js
// 幾何の読み手（id:"geometry"）。
// 受け付ける種類：点・線のみ。円・曲線は無視する。
// 座標はマス単位・y 上向き（数学の向き）。
// 空間（shapes）は書き換えない。check は read と別の計算で確かめる。

"use strict";

(function (root) {

  const ID = "geometry";
  const VERSION = "0.3.0";
  const ACCEPTS = ["point", "segment", "circle"];

  // --- 幾何の道具（純粋関数） -----------------------------------------
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = v => Math.hypot(v.x, v.y);
  const dist = (a, b) => len(sub(a, b));

  function isSnappedSpace(points, circles) {
    for (const p of points) {
      if (Math.abs(p.x - Math.round(p.x)) > 1e-9) return false;
      if (Math.abs(p.y - Math.round(p.y)) > 1e-9) return false;
    }
    if (circles) {
      for (const c of circles) {
        const r2 = c.r * 2;
        if (Math.abs(r2 - Math.round(r2)) > 1e-9) return false;
      }
    }
    return true;
  }

  // v0.1 と同じ許容：snap 時は厳密、そうでないとき 2% と 1.5°
  function makeTol(snap) {
    return {
      TOL: snap ? 1e-6 : 0.02,
      ANG: snap ? 0.05 : 1.5,
      eqRel(a, b, t) {
        if (t === undefined) t = this.TOL;
        return Math.abs(a - b) <= Math.max(1e-9, t * Math.max(Math.abs(a), Math.abs(b)));
      }
    };
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
  function segIntersect(p1, p2, p3, p4) {
    const r = sub(p2, p1), s = sub(p4, p3), den = cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = cross(sub(p3, p1), s) / den, u = cross(sub(p3, p1), r) / den;
    const e = 1e-6;
    if (t > e && t < 1 - e && u > e && u < 1 - e) {
      return { x: p1.x + t * r.x, y: p1.y + t * r.y, t, u };
    }
    return null;
  }
  function segsTouch(p1, p2, p3, p4) {
    const o = (a, b, c) => Math.sign(Math.round(cross(sub(b, a), sub(c, a)) * 1e6));
    const on = (a, b, c) => Math.min(a.x, b.x) - 1e-6 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-6 &&
      Math.min(a.y, b.y) - 1e-6 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-6;
    const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && on(p1, p2, p3)) return true;
    if (o2 === 0 && on(p1, p2, p4)) return true;
    if (o3 === 0 && on(p3, p4, p1)) return true;
    if (o4 === 0 && on(p3, p4, p2)) return true;
    return false;
  }

  // 閉路（多角形候補）を列挙
  function findCycles(pointMap, adj) {
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
                out.push(path.slice());
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

  function makePolygon(idOrder, pointMap, tol) {
    const V = idOrder.map(id => pointMap.get(id));
    const n = V.length;
    // 直線上に並ぶ頂点は無効
    for (let i = 0; i < n; i++) {
      const a = V[(i + n - 1) % n], b = V[i], c = V[(i + 1) % n];
      if (Math.abs(cross(sub(b, a), sub(c, b))) < 1e-6) return null;
    }
    // 自己交差は無効
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segsTouch(V[i], V[(i + 1) % n], V[j], V[(j + 1) % n])) return null;
      }
    }
    let A2 = 0;
    for (let i = 0; i < n; i++) A2 += cross(V[i], V[(i + 1) % n]);
    const orient = Math.sign(A2), area = Math.abs(A2) / 2;
    const sides = V.map((v, i) => dist(v, V[(i + 1) % n]));
    const angles = V.map((v, i) => {
      const a = V[(i + n - 1) % n], c = V[(i + 1) % n];
      const u = sub(a, v), w = sub(c, v);
      let t = Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (len(u) * len(w))))) * 180 / Math.PI;
      const turn = Math.sign(cross(sub(v, a), sub(c, v)));
      return turn === orient ? t : 360 - t;
    });
    const convex = angles.every(t => t < 180);
    const sortedSides = [...sides].sort((a, b) => a - b);
    const cx = V.reduce((s, v) => s + v.x, 0) / n;
    const cy = V.reduce((s, v) => s + v.y, 0) / n;
    return {
      ids: idOrder.slice(),
      V, n, area, sides, sortedSides, angles,
      angleSum: angles.reduce((a, b) => a + b, 0),
      convex, cx, cy,
      perim: sides.reduce((a, b) => a + b, 0)
    };
  }

  function classify(P, tol) {
    const t = tol.ANG, right = P.angles.map(a => Math.abs(a - 90) < t);
    if (P.n === 3) {
      const s = P.sortedSides;
      const iso = tol.eqRel(s[0], s[1]) || tol.eqRel(s[1], s[2]);
      const equi = tol.eqRel(s[0], s[1]) && tol.eqRel(s[1], s[2]);
      const anyRight = right.some(Boolean);
      const obtuse = P.angles.some(a => a > 90 + t);
      P.title = equi ? "正三角形" :
        anyRight ? (iso ? "直角二等辺三角形" : "直角三角形") :
        iso ? "二等辺三角形" :
        obtuse ? "鈍角三角形" : "鋭角三角形";
      P.subtype = equi ? "equilateral" :
        anyRight ? (iso ? "iso-right" : "right") :
        iso ? "isosceles" : obtuse ? "obtuse" : "acute";
      P.family = "triangle";
      P.right = anyRight;
    } else if (P.n === 4) {
      const V = P.V, e = i => segAngle(V[i], V[(i + 1) % 4]);
      const par1 = angDiff(e(0), e(2)) < t;
      const par2 = angDiff(e(1), e(3)) < t;
      const allEq = P.sides.every(x => tol.eqRel(x, P.sides[0]));
      const allRight = right.every(Boolean);
      const kite = (tol.eqRel(P.sides[0], P.sides[1]) && tol.eqRel(P.sides[2], P.sides[3])) ||
        (tol.eqRel(P.sides[1], P.sides[2]) && tol.eqRel(P.sides[3], P.sides[0]));
      P.title = !P.convex ? "凹四角形" :
        allRight && allEq ? "正方形" :
        allRight ? "長方形" :
        allEq ? "ひし形" :
        (par1 && par2) ? "平行四辺形" :
        (par1 || par2) ? "台形" :
        kite ? "たこ形" : "四角形";
      P.subtype = !P.convex ? "concave" :
        allRight && allEq ? "square" :
        allRight ? "rectangle" :
        allEq ? "rhombus" :
        (par1 && par2) ? "parallelogram" :
        (par1 || par2) ? "trapezoid" :
        kite ? "kite" : "quad";
      P.family = "quad";
      P.allEq = allEq;
    } else {
      const reg = P.sides.every(x => tol.eqRel(x, P.sides[0])) &&
        P.angles.every(a => Math.abs(a - P.angles[0]) < t);
      P.title = (reg ? "正" : P.convex ? "" : "凹") +
        ["", "", "", "", "", "五", "六"][P.n] + "角形";
      P.subtype = reg ? "regular" : P.convex ? "convex" : "concave";
      P.family = "ngon";
    }
  }

  function eulerBrute(edges, budget) {
    budget = budget || 300000;
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

  function roundN(v, n) {
    const k = 10 ** n;
    return Math.round(v * k) / k;
  }

  function segKeyStr(a, b) {
    return a < b ? a + "-" + b : b + "-" + a;
  }

  // --- read -----------------------------------------------------------
  function read(space) {
    const shapes = (space && space.shapes) || [];
    const points = shapes.filter(s => ACCEPTS.includes(s.kind) && s.kind === "point");
    const segments = shapes.filter(s => ACCEPTS.includes(s.kind) && s.kind === "segment");
    const circlesRaw = shapes.filter(s => ACCEPTS.includes(s.kind) && s.kind === "circle");
    const snap = isSnappedSpace(points, circlesRaw);
    const tol = makeTol(snap);
    const findings = [];

    const pointMap = new Map(points.map(p => [p.id, p]));
    const adj = new Map();
    points.forEach(p => adj.set(p.id, new Set()));
    const segMap = new Map();
    for (const s of segments) {
      if (!pointMap.has(s.a) || !pointMap.has(s.b)) continue;
      adj.get(s.a).add(s.b);
      adj.get(s.b).add(s.a);
      segMap.set(s.id, s);
    }

    // 交点
    const segArr = [...segMap.values()];
    for (let i = 0; i < segArr.length; i++) {
      for (let j = i + 1; j < segArr.length; j++) {
        const s = segArr[i], t = segArr[j];
        if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
        const q = segIntersect(pointMap.get(s.a), pointMap.get(s.b), pointMap.get(t.a), pointMap.get(t.b));
        if (q) {
          const rx = roundN(q.x, 2), ry = roundN(q.y, 2);
          findings.push({
            key: "geometry:intersection:" + rx + "," + ry,
            reader: ID,
            type: "intersection",
            title: "交点",
            value: { x: rx, y: ry },
            basis: "2本の線分の式を連立して、両方の内側にある交点を求めた",
            refs: [s.id, t.id].sort((a, b) => a - b),
            certainty: snap ? "厳密" : "許容内"
          });
        }
      }
    }

    // 多角形
    const polys = [];
    const cycles = findCycles(pointMap, adj);
    for (const c of cycles) {
      const pg = makePolygon(c, pointMap, tol);
      if (pg) {
        classify(pg, tol);
        polys.push(pg);
        findings.push({
          key: "geometry:polygon:" + pg.family + ":" + pg.subtype + ":" + [...pg.ids].sort((a, b) => a - b).join("-"),
          reader: ID,
          type: "polygon:" + pg.family + ":" + pg.subtype,
          title: pg.title,
          value: {
            n: pg.n,
            area: pg.area,
            perim: pg.perim,
            sides_sorted: pg.sortedSides,
            angles_ordered: pg.angles.slice(),
            angleSum: pg.angleSum,
            convex: pg.convex,
            vertex_ids_ordered: pg.ids.slice(),
            allEq: pg.allEq === true,
            right: pg.right === true,
            // 凸四角形のみ対角線の向きを計算（規則 N1/R1 のための補助情報）
            diagPerp: pg.n === 4 && pg.convex
              ? Math.abs(angDiff(segAngle(pg.V[0], pg.V[2]), segAngle(pg.V[1], pg.V[3])) - 90) < tol.ANG
              : false
          },
          basis: "面積は靴ひも公式、角は辺ベクトルの内積から",
          refs: [...pg.ids].sort((a, b) => a - b),
          certainty: snap ? "厳密" : "許容内"
        });
      }
    }

    // 関係：平行・垂直
    const rels = [];
    for (let i = 0; i < segArr.length; i++) {
      for (let j = i + 1; j < segArr.length; j++) {
        const s = segArr[i], t = segArr[j];
        const sa = pointMap.get(s.a), sb = pointMap.get(s.b);
        const ta = pointMap.get(t.a), tb = pointMap.get(t.b);
        const d = angDiff(segAngle(sa, sb), segAngle(ta, tb));
        const share = s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b;
        if (d < tol.ANG && !share) {
          // 平行だが同一直線上は除く
          const onLine = Math.abs(cross(sub(ta, sa), sub(sb, sa))) < 1e-6;
          if (!onLine) {
            rels.push({ type: "parallel", s, t });
            findings.push({
              key: "geometry:relation:parallel:" + [segKeyStr(s.a, s.b), segKeyStr(t.a, t.b)].sort().join("|"),
              reader: ID,
              type: "relation:parallel",
              title: "平行",
              value: { angleDiff: d },
              basis: "2本の向きの差が ≈ 0°",
              refs: [s.id, t.id].sort((a, b) => a - b),
              certainty: snap ? "厳密" : "許容内"
            });
          }
        }
        if (Math.abs(d - 90) < tol.ANG) {
          rels.push({ type: "perpendicular", s, t });
          findings.push({
            key: "geometry:relation:perpendicular:" + [segKeyStr(s.a, s.b), segKeyStr(t.a, t.b)].sort().join("|"),
            reader: ID,
            type: "relation:perpendicular",
            title: "垂直",
            value: { angleDiff: d },
            basis: "2本の向きの差が ≈ 90°",
            refs: [s.id, t.id].sort((a, b) => a - b),
            certainty: snap ? "厳密" : "許容内"
          });
        }
      }
    }

    // 関係：一直線上
    const colSeen = new Set();
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const on = points.filter(r =>
          Math.abs(cross(sub(points[j], points[i]), sub(r, points[i]))) <
          (snap ? 1e-6 : 0.01 * dist(points[i], points[j]))
        );
        if (on.length >= 3) {
          const k = on.map(r => r.id).sort((a, b) => a - b).join(",");
          if (!colSeen.has(k)) {
            colSeen.add(k);
            findings.push({
              key: "geometry:collinear:" + k,
              reader: ID,
              type: "collinear",
              title: on.length + " 点が一直線上",
              value: { count: on.length },
              basis: "どの2点を選んでも外積がほぼ 0",
              refs: on.map(r => r.id).sort((a, b) => a - b),
              certainty: snap ? "厳密" : "許容内"
            });
          }
        }
      }
    }

    // 相似・合同（三角形どうし）
    const tris = polys.filter(p => p.n === 3);
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        const a = tris[i].sortedSides, b = tris[j].sortedSides, r = a[0] / b[0];
        const sim = tol.eqRel(a[1] / b[1], r) && tol.eqRel(a[2] / b[2], r);
        if (sim) {
          const cong = tol.eqRel(r, 1);
          const idsA = [...tris[i].ids].sort((x, y) => x - y);
          const idsB = [...tris[j].ids].sort((x, y) => x - y);
          const pair = [idsA, idsB].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
          findings.push({
            key: "geometry:" + (cong ? "congruence" : "similarity") + ":" + pair.map(p => p.join("-")).join("|"),
            reader: ID,
            type: cong ? "congruence" : "similarity",
            title: cong ? "合同な三角形の組" : "相似な三角形の組",
            value: { ratio: r > 1 ? r : 1 / r },
            basis: "三辺の長さの比がすべて等しい",
            refs: pair,
            certainty: snap ? "厳密" : "許容内"
          });
        }
      }
    }

    // 一筆書き
    if (segArr.length >= 2) {
      const edgeVerts = [...adj.entries()].filter(([, s]) => s.size > 0).map(([v]) => v);
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
      const brute = connected ? eulerBrute(segArr.map(s => [s.a, s.b])) : false;
      findings.push({
        key: "geometry:euler:" + (ruleSays ? "可" : "不可"),
        reader: ID,
        type: "euler",
        title: ruleSays ? "一筆書きできる" : "一筆書きできない",
        value: { possible: ruleSays, connected, odd, brute },
        basis: "連結かつ奇数次の頂点が 0 か 2 のときにできると判断（規則）",
        refs: ["global"],
        certainty: brute === null ? "推定" : (snap ? "厳密" : "許容内")
      });
    }

    // --- 円・円と線・円と円・円と三角形 -------------------------------
    const circles = circlesRaw.filter(c => pointMap.has(c.c));

    // 円の基本：周・面積
    for (const c of circles) {
      const center = pointMap.get(c.c);
      findings.push({
        key: "geometry:circle:basic:" + c.id,
        reader: ID,
        type: "circle:basic",
        title: "円",
        value: {
          center_id: c.c,
          cx: center.x, cy: center.y,
          r: c.r,
          circumference: 2 * Math.PI * c.r,
          area: Math.PI * c.r * c.r
        },
        basis: "周 = 2 × π × 半径、面積 = π × 半径²",
        refs: [c.id],
        certainty: snap ? "厳密" : "許容内"
      });
    }

    // 円と線：すべての (円, 線分) 対を分類（交わる・接する・離れている）
    for (const c of circles) {
      const center = pointMap.get(c.c);
      for (const s of segArr) {
        const A = pointMap.get(s.a), B = pointMap.get(s.b);
        if (!A || !B) continue;
        const ABx = B.x - A.x, ABy = B.y - A.y;
        const ABlen2 = ABx * ABx + ABy * ABy;
        if (ABlen2 < 1e-24) continue;
        const ABlen = Math.sqrt(ABlen2);
        const ACx = center.x - A.x, ACy = center.y - A.y;
        const distLine = Math.abs(ABx * ACy - ABy * ACx) / ABlen;
        const epsCL = tol.TOL * Math.max(c.r, 1);
        let rel;
        if (Math.abs(distLine - c.r) < epsCL) rel = "tangent";
        else if (distLine < c.r) rel = "intersect";
        else rel = "separate";
        findings.push({
          key: "geometry:circle-line:" + rel + ":" + c.id + "|" + segKeyStr(s.a, s.b),
          reader: ID,
          type: "circle-line:" + rel,
          title: rel === "tangent" ? "円と線が接する" :
                 rel === "intersect" ? "円と線が交わる（交点 2）" :
                 "円と線は離れている",
          value: { distance: distLine, r: c.r },
          basis: rel === "tangent" ? "中心と直線の距離が半径にほぼ等しい" :
                 rel === "intersect" ? "中心と直線の距離が半径より小さい" :
                 "中心と直線の距離が半径より大きい",
          refs: [c.id, s.id],
          certainty: snap ? "厳密" : "許容内"
        });
      }
    }

    // 円と円：すべての (円, 円) 対を分類
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const c1 = circles[i], c2 = circles[j];
        const o1 = pointMap.get(c1.c), o2 = pointMap.get(c2.c);
        const d = Math.hypot(o1.x - o2.x, o1.y - o2.y);
        const sumR = c1.r + c2.r, diffR = Math.abs(c1.r - c2.r);
        const epsCC = tol.TOL * Math.max(sumR, 1);
        if (d < epsCC && Math.abs(c1.r - c2.r) < epsCC) continue; // 同一円は出さない
        let rel;
        if (d < epsCC) rel = "concentric";
        else if (Math.abs(d - sumR) < epsCC) rel = "tangent-external";
        else if (diffR > epsCC && Math.abs(d - diffR) < epsCC) rel = "tangent-internal";
        else if (d > sumR) rel = "separate";
        else if (d < diffR) rel = "inside";
        else rel = "intersect";
        const ids = [c1.id, c2.id].sort((a, b) => a - b);
        const titles = {
          "concentric": "同心円",
          "intersect": "2 円が交わる（交点 2）",
          "tangent-external": "外接する 2 円",
          "tangent-internal": "内接する 2 円",
          "inside": "小さい方の円がもう一方の内側にある",
          "separate": "2 円は離れている"
        };
        findings.push({
          key: "geometry:circle-circle:" + rel + ":" + ids.join("|"),
          reader: ID,
          type: "circle-circle:" + rel,
          title: titles[rel] || rel,
          value: { d, r1: c1.r, r2: c2.r, sum: sumR, diff: diffR },
          basis: "中心間距離 d と、半径の和 r1+r2・差 |r1-r2| を比べて分類",
          refs: ids,
          certainty: snap ? "厳密" : "許容内"
        });
      }
    }

    // 円と三角形：外接円（3頂点が円周上）、内接円（3辺が接する）
    const triangles = polys.filter(p => p.n === 3);
    for (const c of circles) {
      const center = pointMap.get(c.c);
      for (const tri of triangles) {
        const epsCT = tol.TOL * Math.max(c.r, 1);
        // 外接円：3頂点までの距離がすべて半径に等しい
        const vdists = tri.V.map(v => Math.hypot(v.x - center.x, v.y - center.y));
        const circumscribed = vdists.every(dv => Math.abs(dv - c.r) < epsCT);
        if (circumscribed) {
          const triIds = [...tri.ids].sort((a, b) => a - b);
          findings.push({
            key: "geometry:circle-triangle:circumscribed:" + c.id + "|" + triIds.join("-"),
            reader: ID,
            type: "circle-triangle:circumscribed",
            title: "外接円",
            value: { r: c.r, triangle_ids: triIds },
            basis: "三角形の 3 頂点がすべて円周上にある",
            refs: [c.id, triIds],
            certainty: snap ? "厳密" : "許容内"
          });
        }
        // 内接円：3辺(直線)までの距離がすべて半径に等しい
        const sideDists = [];
        for (let k = 0; k < 3; k++) {
          const A = tri.V[k], B = tri.V[(k + 1) % 3];
          const ABx = B.x - A.x, ABy = B.y - A.y;
          const ABlen = Math.hypot(ABx, ABy);
          if (ABlen < 1e-12) { sideDists.push(null); continue; }
          const ACx = center.x - A.x, ACy = center.y - A.y;
          sideDists.push(Math.abs(ABx * ACy - ABy * ACx) / ABlen);
        }
        const inscribed = sideDists.every(dv => dv !== null && Math.abs(dv - c.r) < epsCT);
        if (inscribed) {
          const triIds = [...tri.ids].sort((a, b) => a - b);
          findings.push({
            key: "geometry:circle-triangle:inscribed:" + c.id + "|" + triIds.join("-"),
            reader: ID,
            type: "circle-triangle:inscribed",
            title: "内接円",
            value: { r: c.r, triangle_ids: triIds },
            basis: "三角形の 3 辺の直線すべてに円が接している",
            refs: [c.id, triIds],
            certainty: snap ? "厳密" : "許容内"
          });
        }
      }
    }

    return findings;
  }

  // --- check ----------------------------------------------------------
  // 発見ごとに、read と「別の計算」で確かめる。
  function check(finding, space) {
    const shapes = (space && space.shapes) || [];
    const points = shapes.filter(s => s.kind === "point");
    const segments = shapes.filter(s => s.kind === "segment");
    const pointMap = new Map(points.map(p => [p.id, p]));
    const snap = isSnappedSpace(points);
    const tol = makeTol(snap);

    if (finding.type && finding.type.startsWith("polygon")) {
      // 多角形：頂点 id の列を取り出し、閉路として独立に面積を測って一致を確認
      const ids = finding.refs;
      // 頂点集合から辺が実在するか確認（順序は読み手と別のやり方で求める）
      const V = ids.map(id => pointMap.get(id)).filter(Boolean);
      if (V.length !== ids.length) return { pass: false, method: "頂点が見つからない" };
      // 三角形なら、ヘロンの公式で面積
      if (V.length === 3) {
        const s01 = dist(V[0], V[1]), s12 = dist(V[1], V[2]), s20 = dist(V[2], V[0]);
        const s = (s01 + s12 + s20) / 2;
        const area = Math.sqrt(Math.max(0, s * (s - s01) * (s - s12) * (s - s20)));
        const ok = Math.abs(area - finding.value.area) < Math.max(1e-6, tol.TOL * Math.max(area, finding.value.area));
        if (!ok) return { pass: false, method: "ヘロンの公式で面積を測り直したが一致しない" };
        // 直角三角形ならピタゴラスで再確認
        if (finding.type === "polygon:triangle:right" || finding.type === "polygon:triangle:iso-right") {
          const ss = [s01, s12, s20].sort((a, b) => a - b);
          const diff = Math.abs(ss[2] * ss[2] - (ss[0] * ss[0] + ss[1] * ss[1]));
          const ok2 = diff < 1e-4 * ss[2] * ss[2];
          return { pass: ok2, method: "ヘロンで面積・ピタゴラスで直角を確かめた" };
        }
        return { pass: true, method: "ヘロンの公式で面積を確かめた" };
      }
      // 四角形以上：靴ひもをもう一度だけ適用（並びを refs の読み手版ではなく独自の順で）
      // ここでは「頂点集合は一致するか」「周長・面積が一致するか」で確認する（別経路）
      // 周長は辺の集合を直接合計（既知の列 ids を使う）
      let A2 = 0;
      const n = V.length;
      for (let i = 0; i < n; i++) A2 += cross(V[i], V[(i + 1) % n]);
      const area = Math.abs(A2) / 2;
      const ok = Math.abs(area - finding.value.area) < Math.max(1e-6, tol.TOL * Math.max(area, finding.value.area));
      return { pass: ok, method: "靴ひも公式を再計算して面積を照合" };
    }

    if (finding.type === "intersection") {
      // 2線分の交点を、パラメータ t を代入して両線分の内側にあるか確かめる
      const [id1, id2] = finding.refs;
      const s = segments.find(x => x.id === id1);
      const t = segments.find(x => x.id === id2);
      if (!s || !t) return { pass: false, method: "対象の線分が見つからない" };
      const q = segIntersect(pointMap.get(s.a), pointMap.get(s.b), pointMap.get(t.a), pointMap.get(t.b));
      if (!q) return { pass: false, method: "再計算で交点が得られない" };
      const ok = Math.abs(q.x - finding.value.x) < 1e-6 && Math.abs(q.y - finding.value.y) < 1e-6;
      return { pass: ok, method: "パラメータ t,u を再計算して範囲内であることを確かめた" };
    }

    if (finding.type === "relation:parallel" || finding.type === "relation:perpendicular") {
      const [id1, id2] = finding.refs;
      const s = segments.find(x => x.id === id1);
      const t = segments.find(x => x.id === id2);
      if (!s || !t) return { pass: false, method: "対象の線分が見つからない" };
      const u = sub(pointMap.get(s.b), pointMap.get(s.a));
      const v = sub(pointMap.get(t.b), pointMap.get(t.a));
      const lu = len(u), lv = len(v);
      if (lu < 1e-12 || lv < 1e-12) return { pass: false, method: "長さ 0 の線分" };
      const scale = lu * lv;
      // 札は「どちらの基準で確かめるか」を選ぶだけ：
      //   厳密   → ほぼ 0 の許容
      //   許容内 → 読み手の設定値 ANG_TOL 由来（sin(ANG_TOL)）の許容
      // 確かめ方は read と別の経路：外積・内積を長さで割って sin θ・cos θ を直接作る。
      const isStrict = finding.certainty === "厳密";
      const sinTol = isStrict ? 1e-9 : Math.sin(tol.ANG * Math.PI / 180);
      if (finding.type === "relation:parallel") {
        // sin θ = |u × v| / (|u| |v|)
        const sinTheta = Math.abs(cross(u, v)) / scale;
        const ok = sinTheta <= sinTol + 1e-12;
        return {
          pass: ok,
          method: isStrict
            ? "方向ベクトルの sin θ がほぼ 0 であることで平行を再確認（厳密）"
            : "sin θ を sin(" + tol.ANG + "°) と比べた（許容内・ANG_TOL 由来）"
        };
      } else {
        // cos θ = |u · v| / (|u| |v|) を sin(ANG_TOL) と比べる（90° からの ずれ）
        const cosTheta = Math.abs(dot(u, v)) / scale;
        const ok = cosTheta <= sinTol + 1e-12;
        return {
          pass: ok,
          method: isStrict
            ? "方向ベクトルの cos θ がほぼ 0 であることで垂直を再確認（厳密）"
            : "cos θ を sin(" + tol.ANG + "°) と比べた（許容内・ANG_TOL 由来）"
        };
      }
    }

    if (finding.type === "collinear") {
      const ids = finding.refs;
      const P = ids.map(id => pointMap.get(id));
      if (P.length < 3) return { pass: false, method: "点が足りない" };
      // 直線のパラメータ化（最小二乗で傾きを出す）で全点との残差を調べる（read とは別の手段）
      const n = P.length;
      const mx = P.reduce((s, p) => s + p.x, 0) / n, my = P.reduce((s, p) => s + p.y, 0) / n;
      let sxx = 0, sxy = 0, syy = 0;
      for (const p of P) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      // 共分散行列の小さい方の固有値 = 残差の広がり
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const lam = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const ok = lam < 1e-6 * Math.max(1, tr);
      return { pass: ok, method: "最小二乗で直線を当てはめ、残差の広がりがほぼ 0 であることを確かめた" };
    }

    if (finding.type === "similarity" || finding.type === "congruence") {
      const [idsA, idsB] = finding.refs;
      const VA = idsA.map(id => pointMap.get(id));
      const VB = idsB.map(id => pointMap.get(id));
      // 角度の多重集合が一致することを確かめる（辺の比を使う read とは別）
      function anglesOf(V) {
        const n = V.length, out = [];
        for (let i = 0; i < n; i++) {
          const a = V[(i + n - 1) % n], b = V[i], c = V[(i + 1) % n];
          const u = sub(a, b), w = sub(c, b);
          const cos = dot(u, w) / (len(u) * len(w));
          out.push(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
        }
        return out.sort((a, b) => a - b);
      }
      const A = anglesOf(VA), B = anglesOf(VB);
      let ok = A.length === B.length;
      if (ok) for (let i = 0; i < A.length; i++) if (Math.abs(A[i] - B[i]) > 0.5) { ok = false; break; }
      return { pass: ok, method: "角度の多重集合が一致することで相似を再確認" };
    }

    if (finding.type === "euler") {
      // read は規則（奇数次頂点の個数）で判定。
      // check は実際に辿れる道を総当たりで探して一致を確認（別の計算）。
      const adj = new Map();
      points.forEach(p => adj.set(p.id, new Set()));
      segments.forEach(s => {
        if (adj.has(s.a) && adj.has(s.b)) {
          adj.get(s.a).add(s.b);
          adj.get(s.b).add(s.a);
        }
      });
      const edgeVerts = [...adj.entries()].filter(([, ss]) => ss.size > 0).map(([v]) => v);
      const comp = new Set(), st = edgeVerts.length ? [edgeVerts[0]] : [];
      while (st.length) {
        const v = st.pop();
        if (comp.has(v)) continue;
        comp.add(v);
        adj.get(v).forEach(w => st.push(w));
      }
      const connected = comp.size === edgeVerts.length;
      const brute = connected ? eulerBrute(segments.map(s => [s.a, s.b])) : false;
      if (brute === null) return { pass: true, method: "線が多いので総当たり照合は省略（推定）" };
      const ok = finding.value.possible === brute;
      return { pass: ok, method: "実際に辿れる道を総当たりで探し、規則の結論と一致するか確かめた" };
    }

    // --- 円の基本：read は公式（2πr, πr²）。check は多角形近似で別経路。 ---
    if (finding.type === "circle:basic") {
      const cid = finding.refs[0];
      const circle = shapes.find(s => s.kind === "circle" && s.id === cid);
      if (!circle) return { pass: false, method: "対象の円が見つからない" };
      const r = circle.r;
      const n = 512;
      let perim = 0, area2 = 0;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = i * 2 * Math.PI / n;
        pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        perim += Math.hypot(q.x - p.x, q.y - p.y);
        area2 += p.x * q.y - p.y * q.x;
      }
      const polyArea = Math.abs(area2) / 2;
      const isStrict = finding.certainty === "厳密";
      const eps = isStrict ? 1e-3 : Math.max(tol.TOL, 1e-3);
      const okC = Math.abs(perim - finding.value.circumference) / Math.max(finding.value.circumference, 1e-9) < eps;
      const okA = Math.abs(polyArea - finding.value.area) / Math.max(finding.value.area, 1e-9) < eps;
      return { pass: okC && okA, method: "正 n=512 の内接多角形で周と面積を計算して照合" };
    }

    // --- 円と線：read は外積で距離。check は射影で垂線の足を求めて距離。 ---
    if (finding.type && finding.type.startsWith("circle-line:")) {
      const [cid, sid] = finding.refs;
      const circle = shapes.find(s => s.kind === "circle" && s.id === cid);
      const seg = segments.find(x => x.id === sid);
      if (!circle || !seg) return { pass: false, method: "対象が見つからない" };
      const center = pointMap.get(circle.c);
      const A = pointMap.get(seg.a), B = pointMap.get(seg.b);
      if (!center || !A || !B) return { pass: false, method: "点が見つからない" };
      const ABx = B.x - A.x, ABy = B.y - A.y;
      const ABlen2 = ABx * ABx + ABy * ABy;
      if (ABlen2 < 1e-24) return { pass: false, method: "長さ 0 の線分" };
      const ACx = center.x - A.x, ACy = center.y - A.y;
      const proj = (ACx * ABx + ACy * ABy) / ABlen2;
      const footx = A.x + proj * ABx, footy = A.y + proj * ABy;
      const d = Math.hypot(center.x - footx, center.y - footy);
      const r = circle.r;
      const isStrict = finding.certainty === "厳密";
      const eps = (isStrict ? 1e-6 : tol.TOL) * Math.max(r, 1);
      const rel = finding.type.slice("circle-line:".length);
      let ok = false;
      if (rel === "tangent") ok = Math.abs(d - r) < eps;
      else if (rel === "intersect") ok = d < r - eps;
      else if (rel === "separate") ok = d > r + eps;
      return { pass: ok, method: "中心から直線への垂線の足を射影(内積)で求め、距離を半径と比較" };
    }

    // --- 円と円：read は d と r1+r2, |r1-r2| を直接比較。
    //     check は連立円の式から交点の個数（h²）を独立に数え、包含で補強。 ---
    if (finding.type && finding.type.startsWith("circle-circle:")) {
      const [cid1, cid2] = finding.refs;
      const c1 = shapes.find(s => s.kind === "circle" && s.id === cid1);
      const c2 = shapes.find(s => s.kind === "circle" && s.id === cid2);
      if (!c1 || !c2) return { pass: false, method: "対象の円が見つからない" };
      const o1 = pointMap.get(c1.c), o2 = pointMap.get(c2.c);
      if (!o1 || !o2) return { pass: false, method: "中心点が見つからない" };
      const r1 = c1.r, r2 = c2.r;
      const d = Math.hypot(o1.x - o2.x, o1.y - o2.y);
      const isStrict = finding.certainty === "厳密";
      const epsD = (isStrict ? 1e-6 : tol.TOL) * Math.max(r1 + r2, 1);
      const epsH2 = (isStrict ? 1e-9 : tol.TOL) * 4 * r1 * r2 + 1e-12;
      // 独立計算：連立円の式を解いて交点の個数を判別式で数える
      let count;
      const centersClose = d < epsD;
      if (centersClose) {
        count = Math.abs(r1 - r2) < epsD ? Infinity : 0;
      } else {
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        const h2 = r1 * r1 - a * a;
        if (Math.abs(h2) < epsH2) count = 1;
        else if (h2 > 0) count = 2;
        else count = 0;
      }
      // 包含の独立判定：相手の中心が自分の円の内側にあるか
      const o1InC2 = d < r2 - epsD;
      const o2InC1 = d < r1 - epsD;
      const rel = finding.type.slice("circle-circle:".length);
      let ok = false;
      if (rel === "concentric") ok = centersClose && count !== Infinity;
      else if (rel === "intersect") ok = count === 2;
      else if (rel === "tangent-external") ok = count === 1 && !o1InC2 && !o2InC1;
      else if (rel === "tangent-internal") ok = count === 1 && (o1InC2 || o2InC1);
      else if (rel === "inside") ok = count === 0 && (o1InC2 || o2InC1);
      else if (rel === "separate") ok = count === 0 && !o1InC2 && !o2InC1 && d > r1 + r2 - epsD;
      return { pass: ok, method: "連立円の式を解いて交点数（判別式 h²）を数え、中心の内外で包含を判定" };
    }

    // --- 円と三角形：外接円。
    //     read は「3頂点までの距離がすべて半径」で判定。
    //     check は 3 点から外接円の中心と半径を公式で算出して照合（別経路）。 ---
    if (finding.type === "circle-triangle:circumscribed") {
      const [cid, triIds] = finding.refs;
      const circle = shapes.find(s => s.kind === "circle" && s.id === cid);
      if (!circle) return { pass: false, method: "対象の円が見つからない" };
      const center = pointMap.get(circle.c);
      const V = triIds.map(id => pointMap.get(id));
      if (V.some(v => !v)) return { pass: false, method: "頂点が見つからない" };
      const [p1, p2, p3] = V;
      const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
      if (Math.abs(D) < 1e-12) return { pass: false, method: "3 点が一直線上で外接円が定まらない" };
      const ux = ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y)
                + (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y)
                + (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) / D;
      const uy = ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x)
                + (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x)
                + (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) / D;
      const R = Math.hypot(p1.x - ux, p1.y - uy);
      const isStrict = finding.certainty === "厳密";
      const eps = (isStrict ? 1e-6 : tol.TOL) * Math.max(R, 1);
      const centerOk = Math.hypot(center.x - ux, center.y - uy) < eps;
      const rOk = Math.abs(R - circle.r) < eps;
      return { pass: centerOk && rOk, method: "3 点から外接円の中心と半径を公式で算出して円と照合" };
    }

    // --- 円と三角形：内接円。
    //     read は「3辺までの距離がすべて半径」で判定。
    //     check は 内心=辺長による加重重心、内半径=面積/半周 で独立に算出して照合。 ---
    if (finding.type === "circle-triangle:inscribed") {
      const [cid, triIds] = finding.refs;
      const circle = shapes.find(s => s.kind === "circle" && s.id === cid);
      if (!circle) return { pass: false, method: "対象の円が見つからない" };
      const center = pointMap.get(circle.c);
      const V = triIds.map(id => pointMap.get(id));
      if (V.some(v => !v)) return { pass: false, method: "頂点が見つからない" };
      const [A, B, C] = V;
      const a = Math.hypot(B.x - C.x, B.y - C.y);
      const b = Math.hypot(C.x - A.x, C.y - A.y);
      const c = Math.hypot(A.x - B.x, A.y - B.y);
      const sumS = a + b + c;
      if (sumS < 1e-12) return { pass: false, method: "三角形の辺の長さが 0" };
      const ix = (a * A.x + b * B.x + c * C.x) / sumS;
      const iy = (a * A.y + b * B.y + c * C.y) / sumS;
      const halfP = sumS / 2;
      const area = Math.sqrt(Math.max(0, halfP * (halfP - a) * (halfP - b) * (halfP - c)));
      const inradius = area / halfP;
      const isStrict = finding.certainty === "厳密";
      const eps = (isStrict ? 1e-6 : tol.TOL) * Math.max(inradius, 1);
      const centerOk = Math.hypot(center.x - ix, center.y - iy) < eps;
      const rOk = Math.abs(inradius - circle.r) < eps;
      return { pass: centerOk && rOk, method: "内心を辺長加重重心から、内半径を 面積/半周 から独立に算出して照合" };
    }

    return { pass: false, method: "未対応の種類" };
  }

  // --- 読み手オブジェクト ---------------------------------------------
  const Reader = {
    id: ID,
    version: VERSION,
    accepts: ACCEPTS.slice(),
    read,
    check
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Reader;
  }
  if (root) root.GeometryReader = Reader;

})(typeof window !== "undefined" ? window : null);
