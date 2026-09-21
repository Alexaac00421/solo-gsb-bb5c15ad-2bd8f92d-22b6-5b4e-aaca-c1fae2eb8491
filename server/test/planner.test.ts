import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, validateInputs } from '../src/planner.js';
import { sampleParams, sampleTracks } from '../src/seed.js';
test('示例数据:最优切点在第 5 首之后,且较差面沟距最大', () => {
  const result = computePlan(sampleTracks, sampleParams);
  assert.equal(result.bestCutAfter, 5);

  const best = result.candidates.find((c) => c.cutAfter === result.bestCutAfter)!;
  assert.ok(best.feasible);
  // 较差面沟距约 121.2µm,且是所有合格方案中最大的
  assert.ok(Math.abs(best.worsePitchUm! - 121.2) < 0.1);
  const feasible = result.candidates.filter((c) => c.feasible);
  assert.ok(feasible.length > 0);
  for (const c of feasible) {
    assert.ok(c.worsePitchUm! <= best.worsePitchUm! + 1e-9);
  }
});

test('沟距低于安全阈值的方案被淘汰并记录原因', () => {
  const result = computePlan(sampleTracks, sampleParams);
  const cut2 = result.candidates.find((c) => c.cutAfter === 2)!;
  assert.equal(cut2.feasible, false);
  assert.ok(cut2.reasons.some((r) => r.includes('B 面') && r.includes('安全阈值')));
  assert.equal(cut2.worsePitchUm, null);
});

test('每面计算明细:转数、净宽度、沟距满足 p = Wn*1000/N', () => {
  const result = computePlan(sampleTracks, sampleParams);
  const cut5 = result.candidates.find((c) => c.cutAfter === 5)!;
  const a = cut5.sideA;
  assert.equal(a.trackCount, 5);
  assert.equal(a.gapCount, 4);
  assert.ok(Math.abs(a.gapWidthTotalMm - 4.8) < 1e-9);
  assert.ok(Math.abs(a.usableWidthMm - (146 - 60 - 4.8)) < 1e-9);
  assert.ok(Math.abs(a.revolutions - (a.musicSec * sampleParams.rpm) / 60) < 1e-9);
  assert.ok(Math.abs(a.pitchUm! - (a.usableWidthMm * 1000) / a.revolutions) < 1e-9);
  assert.ok(a.totalSec > a.musicSec); // 含留白耗时
});

test('字典序优选:较差面沟距并列时取时长差更小者', () => {
  // 构造对称曲目,使中间两个切点的较差面沟距接近,时长差不同
  const tracks = [
    { name: 't1', durationSec: 300 },
    { name: 't2', durationSec: 300 },
    { name: 't3', durationSec: 100 },
    { name: 't4', durationSec: 500 },
  ];
  const params = { rpm: 45, outerRadiusMm: 100, innerRadiusMm: 50, gapWidthMm: 0, minPitchUm: 10 };
  const result = computePlan(tracks, params);
  const best = result.candidates.find((c) => c.cutAfter === result.bestCutAfter)!;
  // 独立穷举验证优选规则
  const feasible = result.candidates.filter((c) => c.feasible);
  const maxPitch = Math.max(...feasible.map((c) => c.worsePitchUm!));
  const tied = feasible.filter((c) => Math.abs(c.worsePitchUm! - maxPitch) < 1e-6);
  const expected = tied.reduce((a, b) => (a.durationDiffSec! <= b.durationDiffSec! ? a : b));
  assert.equal(best.cutAfter, expected.cutAfter);
});

test('输入校验:少于 2 首曲目 / 非法参数直接抛错', () => {
  assert.throws(() => computePlan([{ name: 'x', durationSec: 60 }], sampleParams), /至少需要 2 首/);
  assert.throws(
    () =>
      computePlan(sampleTracks, { ...sampleParams, outerRadiusMm: 50, innerRadiusMm: 60 }),
    /外有效半径必须大于内有效半径/,
  );
  assert.ok(validateInputs(sampleTracks, sampleParams).length === 0);
});

test('留白过宽导致净宽度 ≤ 0 时给出淘汰原因', () => {
  // 3 首曲目:无论怎么切,总有一面含 2 首 → 1 条 100mm 留白超过 86mm 可用宽度
  const tracks = [
    { name: 'a', durationSec: 60 },
    { name: 'b', durationSec: 60 },
    { name: 'c', durationSec: 60 },
  ];
  const params = { ...sampleParams, gapWidthMm: 100 };
  const result = computePlan(tracks, params);
  assert.equal(result.bestCutAfter, null);
  assert.ok(result.candidates.every((c) => !c.feasible));
  assert.ok(result.candidates[0].reasons.some((r) => r.includes('净径向宽度')));
});

// ---------- 可变沟距模式 ----------

const vTracks = [
  { name: 'a', durationSec: 300, dynamicCoeff: 0.5 },
  { name: 'b', durationSec: 300, dynamicCoeff: 2 },
  { name: 'c', durationSec: 300, dynamicCoeff: 1 },
  { name: 'd', durationSec: 300, dynamicCoeff: 1 },
];
const vParams = {
  rpm: 45,
  outerRadiusMm: 100,
  innerRadiusMm: 50,
  gapWidthMm: 1,
  minPitchUm: 80,
  mode: 'variable' as const,
};

test('可变模式:结果标记 mode,且每面 λ 与逐轨沟距满足 p_i = max(p_min, λ·c_i)', () => {
  const result = computePlan(vTracks, vParams);
  assert.equal(result.mode, 'variable');
  assert.ok(result.bestCutAfter !== null);
  for (const c of result.candidates) {
    for (const side of [c.sideA, c.sideB]) {
      assert.equal(side.mode, 'variable');
      if (!side.ok) continue;
      const lambda = side.lambdaUm!;
      assert.ok(lambda > 0);
      assert.equal(side.pitchUm, null);
      assert.ok(side.tracks !== null && side.tracks.length === side.trackCount);
      let usedMm = 0;
      for (const tk of side.tracks!) {
        const expectedPitch = Math.max(vParams.minPitchUm, lambda * tk.dynamicCoeff);
        assert.ok(Math.abs(tk.pitchUm - expectedPitch) < 1e-9);
        assert.ok(Math.abs(tk.revolutions - (tk.durationSec * vParams.rpm) / 60) < 1e-9);
        assert.ok(Math.abs(tk.widthMm - (tk.revolutions * tk.pitchUm) / 1000) < 1e-9);
        usedMm += tk.widthMm;
      }
      // 曲轨占用宽度 + 留白 ≤ 净宽度约束(λ 取到最大时应恰好占满)
      assert.ok(usedMm <= side.usableWidthMm + 1e-6);
      assert.ok(Math.abs(usedMm - side.usableWidthMm) < 1e-5);
    }
  }
});

test('可变模式:逐轨起止半径从外向内,总长恰好为外半径 − 内半径', () => {
  const result = computePlan(vTracks, vParams);
  const best = result.candidates.find((c) => c.cutAfter === result.bestCutAfter)!;
  for (const side of [best.sideA, best.sideB]) {
    const layout = side.tracks!;
    assert.ok(Math.abs(layout[0].outerRadiusMm - vParams.outerRadiusMm) < 1e-9);
    // 相邻曲轨之间隔着固定留白
    for (let i = 1; i < layout.length; i++) {
      assert.ok(
        Math.abs(layout[i - 1].innerRadiusMm - layout[i].outerRadiusMm - vParams.gapWidthMm) < 1e-9,
      );
      assert.ok(layout[i].outerRadiusMm < layout[i - 1].outerRadiusMm);
    }
    const last = layout[layout.length - 1];
    assert.ok(Math.abs(last.innerRadiusMm - vParams.innerRadiusMm) < 1e-6);
  }
});

test('可变模式:全部系数为 1 时 λ 等于恒定模式沟距,排序与最优切点一致', () => {
  const ones = sampleTracks.map((t) => ({ ...t, dynamicCoeff: 1 }));
  const varResult = computePlan(ones, { ...sampleParams, mode: 'variable' });
  const constResult = computePlan(sampleTracks, sampleParams);
  assert.equal(varResult.bestCutAfter, constResult.bestCutAfter);
  for (const cv of varResult.candidates) {
    const cc = constResult.candidates.find((x) => x.cutAfter === cv.cutAfter)!;
    assert.equal(cv.feasible, cc.feasible);
    if (cv.feasible) {
      assert.ok(Math.abs(cv.sideA.lambdaUm! - cc.sideA.pitchUm!) < 1e-7);
      assert.ok(Math.abs(cv.sideB.lambdaUm! - cc.sideB.pitchUm!) < 1e-7);
      assert.ok(Math.abs(cv.worseLambdaUm! - cc.worsePitchUm!) < 1e-7);
      assert.ok(Math.abs(cv.durationDiffSec! - cc.durationDiffSec!) < 1e-7);
    }
  }
});

test('可变模式:连最低沟距都容不下时淘汰并给出原因', () => {
  // 4 首 × 300 秒 @45rpm = 225 转/首,单面 2 首按 80µm 需 36mm 曲轨宽,
  // 再给 40mm 留白即可把净宽度压到不足 36mm(总宽 50mm)
  const params = { ...vParams, gapWidthMm: 40 };
  const result = computePlan(vTracks, params);
  assert.equal(result.bestCutAfter, null);
  assert.ok(result.candidates.every((c) => !c.feasible));
  assert.ok(result.candidates.some((c) => c.reasons.some((r) => r.includes('最低沟距'))));
});

test('可变模式:按 min(λA, λB) 最大化、再按时长差最小化选优', () => {
  const result = computePlan(vTracks, vParams);
  const feasible = result.candidates.filter((c) => c.feasible);
  assert.ok(feasible.length > 0);
  const maxLambda = Math.max(...feasible.map((c) => c.worseLambdaUm!));
  for (const c of feasible) {
    assert.ok(c.worseLambdaUm! <= maxLambda + 1e-9);
  }
  const tied = feasible.filter((c) => Math.abs(c.worseLambdaUm! - maxLambda) < 1e-6);
  const expected = tied.reduce((a, b) => (a.durationDiffSec! <= b.durationDiffSec! ? a : b));
  assert.equal(result.bestCutAfter, expected.cutAfter);
});

test('可变模式:动态系数越界或缺席时报校验错误;恒定模式忽略系数', () => {
  const bad = [
    { name: 'a', durationSec: 300, dynamicCoeff: 0.4 },
    { name: 'b', durationSec: 300, dynamicCoeff: 1 },
  ];
  assert.throws(() => computePlan(bad, vParams), /动态系数/);
  const missing = [
    { name: 'a', durationSec: 300 },
    { name: 'b', durationSec: 300 },
  ];
  assert.throws(() => computePlan(missing, vParams), /动态系数/);
  assert.ok(validateInputs(missing, sampleParams).length === 0);
  assert.ok(validateInputs(vTracks, { ...vParams, mode: 'constant' }).length === 0);
  assert.throws(
    () => computePlan(vTracks, { ...vParams, mode: 'weird' as never }),
    /沟距模式/,
  );
});

test('求解器:λ 落在最低档/比例档混合区间,各轨宽度独立验证', () => {
  // 构造净宽度 46mm 的单面(切点在第 2 首之后,A 面 = lo + hi):
  //   lo:400 转、系数 0.5 → 断点 160µm,期望压在 80µm 最低档
  //   hi: 50 转、系数 2   → 断点 40µm,期望走比例档
  //   预算 46000µm:λ = (46000 − 400×80) ÷ (50×2) = 140µm,恰在 (40, 160) 区间内
  const tracks = [
    { name: 'lo', durationSec: 720, dynamicCoeff: 0.5 },
    { name: 'hi', durationSec: 90, dynamicCoeff: 2 },
    { name: 'rest', durationSec: 60, dynamicCoeff: 1 },
  ];
  const params = {
    rpm: 33.333,
    outerRadiusMm: 100,
    innerRadiusMm: 54,
    gapWidthMm: 0,
    minPitchUm: 80,
    mode: 'variable' as const,
  };
  const result = computePlan(tracks, params);
  const side = result.candidates.find((c) => c.cutAfter === 2)!.sideA;
  assert.equal(side.ok, true);
  const lambda = side.lambdaUm!;
  const [lo, hi] = side.tracks!;
  assert.ok(Math.abs(lo.pitchUm - 80) < 1e-9);
  assert.ok(hi.pitchUm > 80);
  assert.ok(Math.abs(hi.pitchUm - lambda * 2) < 1e-9);
  const budgetUm = side.usableWidthMm * 1000;
  const lambdaHand = (budgetUm - lo.revolutions * 80) / (hi.revolutions * 2);
  assert.ok(Math.abs(lambda - lambdaHand) < 1e-6);
  assert.ok(Math.abs(lambda - 140) < 0.01);
});
