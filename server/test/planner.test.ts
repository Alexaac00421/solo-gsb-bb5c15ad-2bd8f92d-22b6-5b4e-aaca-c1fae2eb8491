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
