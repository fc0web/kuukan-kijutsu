// tests/curve-cases.js
// 曲線のテストケース。pts を手計算で書くのは煩雑なので
// 生成器（円・四角・密化・8 の字など）を使って配列を作る。
// 期待値は手計算根拠（rationale）つきで添える。

"use strict";

// --- 生成器 ---------------------------------------------------------
function circlePts(cx, cy, r, step) {
  const pts = [];
  const n = Math.ceil(2 * Math.PI * r / step);
  for (let i = 0; i < n; i++) {
    const t = i * 2 * Math.PI / n;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

function squarePts(x0, y0, side, step) {
  const pts = [];
  const n = Math.round(side / step);
  for (let i = 0; i < n; i++) pts.push([x0 + step * i, y0]);
  for (let i = 0; i < n; i++) pts.push([x0 + side, y0 + step * i]);
  for (let i = 0; i < n; i++) pts.push([x0 + side - step * i, y0 + side]);
  for (let i = 0; i < n; i++) pts.push([x0, y0 + side - step * i]);
  return pts;
}

// 頂点の列を密化（各辺を step 間隔に）、最終頂点を 1 回だけ push する
function densifyPolyline(vertices, step) {
  const pts = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const [ax, ay] = vertices[i], [bx, by] = vertices[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([ax + dx * t, ay + dy * t]);
    }
  }
  pts.push(vertices[vertices.length - 1]);
  return pts;
}

// 8 の字：頂点 (-2,-1) → (-2,1) → (2,-1) → (2,1) → (-2,-1) を密化。
// 最終頂点を始点に戻すことでギャップ 0 で閉じる。
// 2 本の対角線（(-2,1)→(2,-1) と (2,1)→(-2,-1)）が原点で 1 回交わる。
function figureEightPts(step) {
  return densifyPolyline([[-2, -1], [-2, 1], [2, -1], [2, 1], [-2, -1]], step);
}

// 細かい揺れ（手ぶれ）を乗せた円。
// jitterAmp マスの振幅で、位相の違う2本のサイン波を足して決定的に生成。
function jitteredCirclePts(cx, cy, r, step, jitterAmp) {
  const pts = [];
  const n = Math.ceil(2 * Math.PI * r / step);
  for (let i = 0; i < n; i++) {
    const t = i * 2 * Math.PI / n;
    // 高めの周波数で震えを入れる（隣り合う点で向きが揺らぐように）
    const nx = jitterAmp * Math.sin(i * 1.7);
    const ny = jitterAmp * Math.cos(i * 1.9);
    pts.push([cx + r * Math.cos(t) + nx, cy + r * Math.sin(t) + ny]);
  }
  return pts;
}

// --- ケース ---------------------------------------------------------
const cases = [
  {
    name: "fine-circle",
    description: "半径 5 の円を 0.1 マス間隔でなぞる",
    rationale: "n=314 の正多角形近似。長さ = 2π·5·sin(π/n)/(π/n) ≈ 31.414、面積 = (n/2)·r²·sin(2π/n) ≈ 78.527。閉じている・自己交差なし。",
    shape: () => ({ id: 1, kind: "curve", pts: circlePts(0, 0, 5, 0.1), closed: true }),
    expected: { closed: true, crossings: 0, length_about: 31.414, length_tol: 0.02, area_about: 78.527, area_tol: 0.02 }
  },
  {
    name: "traced-square",
    description: "一辺 10 の正方形を 0.1 マス間隔でなぞる",
    rationale: "各辺 100 点、計 400 点。長さ（閉じ辺含む）= 40、面積 = 100。閉じている・自己交差なし。",
    shape: () => ({ id: 1, kind: "curve", pts: squarePts(0, 0, 10, 0.1), closed: true }),
    expected: { closed: true, crossings: 0, length_about: 40.0, length_tol: 0.005, area_about: 100.0, area_tol: 0.005 }
  },
  {
    name: "figure-eight",
    description: "交差する 2 本の対角線で作る 8 の字（密化）",
    rationale: "頂点 (-2,-1)→(-2,1)→(2,-1)→(2,1) を繋ぎ閉じる。対角線が原点で交わるので自己交差 1 回。長さ = 2 + 2√5 + 2 + 2√5 = 4 + 4√5 ≈ 12.944。自己交差があるので面積は出さない。",
    shape: () => ({ id: 1, kind: "curve", pts: figureEightPts(0.1), closed: true }),
    expected: { closed: true, crossings: 1, length_about: 4 + 4 * Math.sqrt(5), length_tol: 0.01, no_area: true }
  },
  {
    name: "open-zigzag",
    description: "開いたジグザグ（左右に 5 回振る）",
    rationale: "頂点 [(0,0),(1,1),(2,0),(3,1),(4,0),(5,1)] を密化。各辺 √2、計 5·√2 ≈ 7.071。始終点が離れているので開く。自己交差なし。開いているので面積は出さない。",
    shape: () => ({ id: 1, kind: "curve", pts: densifyPolyline([[0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 1]], 0.1), closed: false }),
    expected: { closed: false, crossings: 0, length_about: 5 * Math.sqrt(2), length_tol: 0.02, no_area: true }
  },
  {
    name: "barely-closed",
    description: "終点が始点の 0.25 マス以内で止まる（許容内）",
    rationale: "最終頂点を (0, 0.25) とすると、始点 (0,0) との距離 0.25 < 0.3（閉じ許容）なので closed=true。長さ = 2+2+2+1.75 + 閉じ辺 0.25 = 8。自己交差なし。面積は閉じ折れ線の靴ひも。",
    shape: () => ({ id: 1, kind: "curve", pts: densifyPolyline([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0.25]], 0.1), closed: true }),
    expected: { closed: true, crossings: 0, length_about: 8.0, length_tol: 0.02 }
  },
  {
    name: "barely-not-closed",
    description: "終点が始点から 0.35 マス離れて止まる（許容外）",
    rationale: "最終頂点を (0, 0.35) にすると、ギャップ 0.35 > 0.3 で closed=false。長さ = 2+2+2+1.65 = 7.65（閉じ辺なし）。開いているので面積なし。",
    shape: () => ({ id: 1, kind: "curve", pts: densifyPolyline([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0.35]], 0.1), closed: false }),
    expected: { closed: false, crossings: 0, length_about: 7.65, length_tol: 0.02, no_area: true }
  },
  {
    name: "small-triangle-closed",
    description: "3-4-5 直角三角形をなぞって閉じる",
    rationale: "頂点 (0,0)-(3,0)-(0,4)-(0,0) を密化。辺長 3+5+4=12、面積 6。始終点が同じなので閉じる・自己交差なし。",
    shape: () => ({ id: 1, kind: "curve", pts: densifyPolyline([[0, 0], [3, 0], [0, 4], [0, 0]], 0.1), closed: true }),
    expected: { closed: true, crossings: 0, length_about: 12.0, length_tol: 0.005, area_about: 6.0, area_tol: 0.005 }
  },
  {
    name: "open-L-path",
    description: "L 字の開いた経路（右・上・左・下）",
    rationale: "頂点 (0,0)→(3,0)→(3,3)→(1,3)→(1,1) を密化。長さ 3+3+2+2 = 10。自己交差なし。開いているので面積なし。",
    shape: () => ({ id: 1, kind: "curve", pts: densifyPolyline([[0, 0], [3, 0], [3, 3], [1, 3], [1, 1]], 0.1), closed: false }),
    expected: { closed: false, crossings: 0, length_about: 10.0, length_tol: 0.005, no_area: true }
  },
  {
    name: "jittered-circle",
    description: "半径 5 の円に細かい揺れ（振幅 0.05 マス）を乗せたなぞり（手ぶれ対策）",
    rationale: "半径 5・0.1 マス間隔の円に、位相の違う2本のサイン波（周波数 1.7 と 1.9 rad/点）で 0.05 マス振幅の揺れを乗せる。周波数が高いため隣り合う辺の向きが 20° を越えて揺らぎ、check の「角を守る間引き」は揺らぎの多くを「角」と誤認する → 残った点が多い → 間引きは効きにくいが、thinned と full が近いので ±1% は通る（頑健なフォールバック）。長さは折れ線として 36.560（元の円周の約 1.16 倍、揺れの寄り道を含む）、面積は揺れが平均化されて 78.534 で元の π·25 ≈ 78.540 に近い。",
    shape: () => ({ id: 1, kind: "curve", pts: jitteredCirclePts(0, 0, 5, 0.1, 0.05), closed: true }),
    expected: { closed: true, crossings: 0, length_about: 36.560, length_tol: 0.001, area_about: 78.534, area_tol: 0.001 }
  }
];

module.exports = { cases, circlePts, squarePts, densifyPolyline, figureEightPts, jitteredCirclePts };
