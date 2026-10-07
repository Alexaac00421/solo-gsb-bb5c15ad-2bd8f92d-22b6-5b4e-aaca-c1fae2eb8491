import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePlan,
  validateInputs,
  MIN_COEFF,
  MAX_COEFF,
  type PlanParams,
  type TrackInput,
} from '../src/planner.js';
import { sampleParams, sampleTracks } from '../src/seed.js';

const variableParams: PlanParams = { ...sampleParams, mode: 'variable' };
const coeffTracks = (coeffs: number[], durationSec = 300): TrackInput[] =>
  coeffs.map((c, i) => ({ name: `t${i + 1}`, durationSec, dynamicCoeff: c }));

test('可变模式:系数全为 1 时 λ 等于恒定模式沟距,且每轨沟距/时长完全一致', () => {
  const ones = sampleTracks.map((t) => ({ ...t, dynamicCoeff: 1 }));
  const v = computePlan(ones, variableParams);
  const c = computePlan(sampleTracks, sampleParams);
  assert.equal(v.bestCutAfter, c.bestCutAfter);

  for (const cv of v.candidates) {
    const cc = c.candidates.find((x) => x.cutAfter === cv.cutAfter)!;
    assert.equal(cv.feasible, cc.feasible);
    if (cv.feasible) {
      assert.ok(Math.abs(cv.sideA.lambdaUm! - cc.sideA.pitchUm!) < 1e-8);
      assert.ok(Math.abs(cv.sideB.lambdaUm! - cc.sideB.pitchUm!) < 1e-8);
      assert.ok(Math.abs(cv.worseLambdaUm! - cc.worsePitchUm!) < 1e-8);
      assert.ok(Math.abs(cv.durationDiffSec! - cc.durationDiffSec!) < 1e-8);
      for (const [sideV, sideC] of [
        [cv.sideA, cc.sideA],
        [cv.sideB, cc.sideB],
      ] as const) {
        assert.equal(sideV.tracks.length, sideC.tracks.length);
        sideV.tracks.forEach((tv, i) => {
          const tc = sideC.tracks[i];
          assert.ok(Math.abs(tv.pitchUm - tc.pitchUm) < 1e-8);
          assert.ok(Math.abs(tv.startRadiusMm - tc.startRadiusMm) < 1e-9);
          assert.ok(Math.abs(tv.endRadiusMm - tc.endRadiusMm) < 1e-9);
          assert.equal(tv.coeff, 1);
        });
        assert.ok(Math.abs(sideV.gapSec - sideC.gapSec) < 1e-8);
      }
    }
  }
});

test('可变模式:系数不一时 λ 解在分段线性段上,各轨沟距为 max(最小沟距, λ×系数)', () => {
  // 4 首曲目,切点在第 2 首后 → A 面含系数 0.5 与 2 的两轨
  const params: PlanParams = {
    mode: 'variable',
    rpm: 33.333,
    outerRadiusMm: 140,
    innerRadiusMm: 100,
    gapWidthMm: 0,
    minPitchUm: 80,
  };
  const result = computePlan(coeffTracks([0.5, 2, 1, 1]), params);
  const cut2 = result.candidates.find((c) => c.cutAfter === 2)!;
  assert.equal(cut2.feasible, true);
  const a = cut2.sideA;
  const lambda = a.lambdaUm!;

  // 每轨 300s × 33.333/60 = 166.665 转;净宽 40mm = 40000µm
  // 转折点:系数 2 → λ=40,系数 0.5 → λ=160
  // λ ∈ (40,160) 段:D = 166.665·80(系数 0.5 轨压底) + 166.665·2λ
  //   λ = (40000 − 13333.2) / 333.33 = 80.0004 ∈ (40,160) ✓
  assert.ok(lambda > 40 && lambda < 160);
  assert.ok(Math.abs(lambda - 80.0004) < 0.01);
  assert.equal(a.tracks[0].pitchUm, 80); // 系数 0.5:λ×0.5 ≈ 40 < 80 → 压到最低沟距
  assert.ok(Math.abs(a.tracks[1].pitchUm - lambda * 2) < 1e-8);
  // 音乐恰好铺满净宽度
  const usedUm = a.tracks.reduce((s, t) => s + t.revolutions * t.pitchUm, 0);
  assert.ok(Math.abs(usedUm - a.usableWidthMm * 1000) < 1e-4);
});

test('可变模式:可行场景下各轨半径从外圈向内首尾相接,首起外半径、末止内半径', () => {
  const params: PlanParams = {
    mode: 'variable',
    rpm: 33.333,
    outerRadiusMm: 150,
    innerRadiusMm: 100,
    gapWidthMm: 2,
    minPitchUm: 80,
  };
  // 每面 2 首 → 1 条 2mm 留白 → 净宽 48mm
  const result = computePlan(coeffTracks([0.5, 1, 2, 1]), params);
  const best = result.candidates.find((c) => c.cutAfter === result.bestCutAfter)!;
  assert.equal(best.feasible, true);

  for (const side of [best.sideA, best.sideB]) {
    const lambda = side.lambdaUm!;
    assert.ok(lambda > 0);
    let musicWidthUm = 0;
    for (const tr of side.tracks) {
      const expected = Math.max(params.minPitchUm, lambda * tr.coeff!);
      assert.ok(Math.abs(tr.pitchUm - expected) < 1e-7);
      musicWidthUm += tr.revolutions * tr.pitchUm;
    }
    // 音乐部分恰好铺满净宽度
    assert.ok(Math.abs(musicWidthUm / 1000 - side.usableWidthMm) < 1e-6);

    // 首轨起于外半径,末轨止于内半径
    assert.ok(Math.abs(side.tracks[0].startRadiusMm - params.outerRadiusMm) < 1e-9);
    assert.ok(
      Math.abs(side.tracks[side.tracks.length - 1].endRadiusMm - params.innerRadiusMm) < 1e-7,
    );
    // 从外圈向内:每个元素起点 = 上一元素终点;半径单调不增
    const seq: { start: number; end: number }[] = [];
    side.tracks.forEach((t) => {
      seq.push({ start: t.startRadiusMm, end: t.endRadiusMm });
      const g = side.gaps.find((x) => x.afterTrack === t.trackNo);
      if (g) seq.push({ start: g.startRadiusMm, end: g.endRadiusMm });
    });
    for (let i = 1; i < seq.length; i++) {
      assert.ok(Math.abs(seq[i].start - seq[i - 1].end) < 1e-9);
      assert.ok(seq[i].end <= seq[i].start + 1e-12);
    }
    // 留白宽度固定、耗时按 max(min, λ) 折算
    for (const g of side.gaps) {
      assert.ok(Math.abs(g.widthMm - params.gapWidthMm) < 1e-12);
      const expectSec =
        ((g.widthMm * 1000) / Math.max(params.minPitchUm, lambda) / params.rpm) * 60;
      assert.ok(Math.abs(g.sec - expectSec) < 1e-9);
    }
  }
});

test('可变模式:同宽同长下系数 2 的 λ 为系数 1 的一半,但实际沟距相同', () => {
  // 300s 单轨在 80µm 下需 13.33mm;W=15mm 可行
  const params: PlanParams = {
    mode: 'variable',
    rpm: 33.333,
    outerRadiusMm: 100,
    innerRadiusMm: 85,
    gapWidthMm: 0,
    minPitchUm: 80,
  };
  const ones = computePlan(coeffTracks([1, 1]), params);
  const twos = computePlan(coeffTracks([2, 2]), params);
  assert.equal(ones.candidates[0].feasible, true);
  assert.equal(twos.candidates[0].feasible, true);

  const lam1 = ones.candidates[0].sideA.lambdaUm!;
  const lam2 = twos.candidates[0].sideA.lambdaUm!;
  assert.ok(lam1 > 80);
  assert.ok(Math.abs(lam2 - lam1 / 2) < 1e-8);
  // 实际刻录沟距相同(系数 2 抵消 λ 减半),半径排布一致
  assert.ok(Math.abs(lam2 * 2 - lam1) < 1e-8);
  assert.ok(
    Math.abs(
      twos.candidates[0].sideA.tracks[0].endRadiusMm -
        ones.candidates[0].sideA.tracks[0].endRadiusMm,
    ) < 1e-9,
  );
});

test('可变模式:连最低沟距都容不下时淘汰并给出所需宽度原因', () => {
  // 300s 单轨最低沟距 80µm 需 13.33mm;净宽只有 10mm
  const params: PlanParams = {
    mode: 'variable',
    rpm: 33.333,
    outerRadiusMm: 100,
    innerRadiusMm: 90,
    gapWidthMm: 0,
    minPitchUm: 80,
  };
  const r = computePlan(coeffTracks([1, 1]), params);
  assert.equal(r.bestCutAfter, null);
  assert.ok(r.candidates.every((c) => !c.feasible));
  for (const c of r.candidates) {
    assert.ok(
      c.sideA.reasons.join('').includes('最低沟距') ||
        c.sideB.reasons.join('').includes('最低沟距'),
    );
  }
});

test('可变模式:候选按两面较小 λ 降序、再按总时长差升序排列', () => {
  const result = computePlan(sampleTracks, variableParams);
  const feasible = result.candidates.filter((c) => c.feasible);
  assert.ok(feasible.length >= 2);
  for (let i = 1; i < feasible.length; i++) {
    const prev = feasible[i - 1];
    const cur = feasible[i];
    assert.ok(prev.worseLambdaUm! >= cur.worseLambdaUm! - 1e-9);
    if (Math.abs(prev.worseLambdaUm! - cur.worseLambdaUm!) <= 1e-9) {
      assert.ok(prev.durationDiffSec! <= cur.durationDiffSec! + 1e-9);
    }
  }
  // 排首位者即最优切点
  assert.equal(feasible[0].cutAfter, result.bestCutAfter);
  // 淘汰方案沉底
  if (feasible.length < result.candidates.length) {
    assert.equal(result.candidates[result.candidates.length - 1].feasible, false);
  }
});

test('可变模式:动态系数缺失或越界(含边界)时报错', () => {
  const base = (coeffs: (number | undefined)[]) =>
    coeffs.map((c, i) => ({ name: `t${i}`, durationSec: 100, dynamicCoeff: c })) as TrackInput[];

  assert.equal(validateInputs(base([0.5, 2]), variableParams).length, 0);
  assert.equal(validateInputs(base([1, 1.5]), variableParams).length, 0);
  assert.throws(
    () => computePlan(base([undefined, 1]), variableParams),
    new RegExp(`动态系数必须为 ${MIN_COEFF}~${MAX_COEFF}`),
  );
  assert.equal(validateInputs(base([0.49, 2.01]), variableParams).length, 2);
  // 恒定模式不校验系数
  assert.equal(validateInputs(base([undefined, 3]), sampleParams).length, 0);
});

test('旧数据兼容:params 无 mode 字段时按恒定沟距处理,行为与原实现一致', () => {
  const legacyParams = { ...sampleParams } as PlanParams;
  delete (legacyParams as Partial<PlanParams>).mode;
  const result = computePlan(sampleTracks, legacyParams);
  assert.equal(result.bestCutAfter, 5);
  assert.equal(result.candidates[0].sideA.mode, 'constant');
  // 恒定模式下候选仍按切点升序(不重排)
  result.candidates.forEach((c, i) => assert.equal(c.cutAfter, i + 1));
});
