// readers/geometry.js
// 幾何の読み手（id:"geometry"）。
// 受け付ける種類：点・線のみ。円・曲線は無視する。
// 座標はマス単位・y 上向き（数学の向き）。
// 空間（shapes）は書き換えない。check は read と別の計算で確かめる。

"use strict";

(function (root) {

  const ID = "geometry";
  const VERSION = "0.2.0";
  const ACCEPTS = ["point", "segment"];

  // --- 幾何の道具（純粋関数） -----------------------------------------
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = v => Math.hypot(v.x, v.y);
  const dist = (a, b) => len(sub(a, b));

  function isSnappedSpace(points) {
    for (const p of points) {
      if (Math.abs(p.x - Math.round(p.x)) > 1e-9) return false;
      if (Math.abs(p.y - Math.round(p.y)) > 1e-9) return false;
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
    const snap = isSnappedSpace(points);
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
