/**
 * 黑胶唱片 A/B 面切分规划核心算法(纯函数,不依赖 Express / SQLite)。
 *
 * 两种沟距模式:
 *
 * 1) 恒定沟距(constant,历史默认行为):
 *   - 有效径向宽度 W = 外有效半径 - 内有效半径 (mm)
 *   - 面内 k 首曲目之间有 (k-1) 条留白带,每条占径向宽度 gapWidthMm
 *   - 扣除留白后的净宽度 Wn = W - (k-1) * gapWidthMm
 *   - 该面音乐总时长 T(秒)在转速 rpm 下需要的总转数 N = T * rpm / 60
 *   - 恒定沟距 p = Wn * 1000 / N  (µm/转)
 *   - 安全约束:p >= minPitchUm,且 Wn > 0
 *   - 留白带自身耗时:以相同沟距刻录,rev_gap = 留白宽*1000/p,耗时 = rev_gap / rpm * 60
 *
 * 2) 可变沟距(variable):
 *   - 每首曲目 i 带动态系数 c_i ∈ [0.5, 2](响度/调制需求越大系数越大)
 *   - 对给定基准 λ(µm/转,系数 1 对应的沟距),各轨实际沟距
 *       p_i = max(minPitchUm, λ * c_i)
 *   - 曲间留白是固定径向宽度(已从可用宽度中扣除),其播放耗时按
 *     p_gap = max(minPitchUm, λ) 的沟距折算
 *   - 该面音乐部分径向占用:
 *       D(λ) = Σ_i n_i * p_i   (n_i 为第 i 轨转数;单位 µm)
 *   - 求不超过净宽度预算 Wn*1000 的最大 λ(音乐铺满净宽度)
 *   - D 关于 λ 是分段线性单调函数:每轨在 λ < 阈值前取最低沟距常量,
 *     越过阈值 kink_i = minPitchUm / c_i 后转为 λ*c_i 线性项;
 *     按转折点升序逐段求解即可
 *   - 连所有曲目都取最低沟距仍超出 Wn → 该切点该面被淘汰
 *
 * 枚举与优选:
 *   - 曲目顺序固定,切点 c ∈ [1, n-1],A 面 = 1..c,B 面 = c+1..n
 *   - 任一面不满足安全约束 → 淘汰,并记录原因
 *   - 恒定模式:先最大化 min(pA, pB),再最小化 |TA - TB|
 *   - 可变模式:先最大化 min(λA, λB)(较差一面的基准沟距),再最小化 |TA - TB|
 */

export type PitchMode = 'constant' | 'variable';

/** 动态系数允许范围 */
export const MIN_COEFF = 0.5;
export const MAX_COEFF = 2;

export interface TrackInput {
  name: string;
  /** 曲目时长(秒) */
  durationSec: number;
  /** 可变沟距模式下的动态系数(0.5~2);恒定模式下可缺省 */
  dynamicCoeff?: number;
}

export interface PlanParams {
  /** 沟距模式:缺省视为 'constant'(兼容旧方案) */
  mode?: PitchMode;
  /** 转速(转/分钟),如 33.333 或 45 */
  rpm: number;
  /** 外有效半径 mm(最外圈沟槽半径) */
  outerRadiusMm: number;
  /** 内有效半径 mm(最内圈沟槽半径) */
  innerRadiusMm: number;
  /** 曲间留白:每条留白带占用的径向宽度 mm */
  gapWidthMm: number;
  /** 最小沟距(安全阈值)µm/转 */
  minPitchUm: number;
}

/** 单轨的径向排布(从外圈向内刻录) */
export interface TrackLayout {
  /** 全局曲目序号(从 1 开始) */
  trackNo: number;
  name: string;
  durationSec: number;
  /** 动态系数(可变模式);恒定模式为 null */
  coeff: number | null;
  /** 该轨转数 */
  revolutions: number;
  /** 该轨实际刻录沟距 µm/转 */
  pitchUm: number;
  /** 该轨音乐部分径向占用 mm */
  widthMm: number;
  /** 从外圈向内:该轨音乐起始半径 mm */
  startRadiusMm: number;
  /** 从外圈向内:该轨音乐结束半径 mm(进入留白或抵达内有效半径) */
  endRadiusMm: number;
}

/** 曲间留白带的径向排布 */
export interface GapLayout {
  /** 该留白位于全局第 afterTrack 首曲目之后 */
  afterTrack: number;
  /** 留白带径向宽度 mm */
  widthMm: number;
  /** 留白刻录沟距 µm/转 */
  pitchUm: number;
  /** 留白播放耗时(秒) */
  sec: number;
  startRadiusMm: number;
  endRadiusMm: number;
}

export interface SideCalc {
  /** 该面使用的沟距模式 */
  mode: PitchMode;
  /** 该面第 1 首曲目的全局序号(从 1 开始) */
  firstTrack: number;
  /** 该面最后一首曲目的全局序号 */
  lastTrack: number;
  trackCount: number;
  /** 音乐总时长(秒,不含留白) */
  musicSec: number;
  /** 该面总转数 N = musicSec * rpm / 60 */
  revolutions: number;
  /** 面内留白带数量 = trackCount - 1 */
  gapCount: number;
  /** 留白带总径向宽度 mm */
  gapWidthTotalMm: number;
  /** 可用径向总宽度 mm(外半径 - 内半径) */
  totalWidthMm: number;
  /** 扣除留白后的净径向宽度 mm */
  usableWidthMm: number;
  /** 恒定沟距 µm/转(仅恒定模式;净宽度 ≤ 0 或可变模式为 null) */
  pitchUm: number | null;
  /** 可变模式解出的最大基准 λ µm/转(系数 1 对应沟距);失败或恒定模式为 null */
  lambdaUm: number | null;
  /** 可变模式各轨实际沟距的最小值 µm;恒定模式为 null */
  minTrackPitchUm: number | null;
  /** 可变模式留白刻录沟距 max(minPitchUm, λ) µm;恒定模式为 null */
  gapPitchUm: number | null;
  /** 留白带播放总耗时(秒) */
  gapSec: number;
  /** 该面总时长(秒,音乐 + 留白) */
  totalSec: number;
  /** 每轨实际沟距与从外圈向内的起止半径 */
  tracks: TrackLayout[];
  /** 各条曲间留白带的排布 */
  gaps: GapLayout[];
  ok: boolean;
  /** 不满足安全约束的原因 */
  reasons: string[];
}

export interface Candidate {
  /** 切点:A 面为第 1..cutAfter 首,B 面为其余 */
  cutAfter: number;
  sideA: SideCalc;
  sideB: SideCalc;
  feasible: boolean;
  /** 淘汰原因(合格时为空数组) */
  reasons: string[];
  /** 较差一面的恒定沟距 µm(仅恒定模式合格方案) */
  worsePitchUm: number | null;
  /** 较差一面的基准 λ µm(仅可变模式合格方案) */
  worseLambdaUm: number | null;
  /** 两面总时长差(秒,仅合格方案) */
  durationDiffSec: number | null;
}

export interface PlanResult {
  candidates: Candidate[];
  /** 最优方案切点;无合格方案时为 null */
  bestCutAfter: number | null;
}

const EPS = 1e-6;
/** 宽度(µm)比较容差,µm 量级下远小于可感知误差 */
const WIDTH_EPS_UM = 1e-4;

export function normalizeMode(mode: unknown): PitchMode {
  return mode === 'variable' ? 'variable' : 'constant';
}

export function validateInputs(tracks: TrackInput[], params: PlanParams): string[] {
  const errors: string[] = [];
  const mode = normalizeMode(params?.mode);
  if (!Array.isArray(tracks) || tracks.length < 2) {
    errors.push('至少需要 2 首曲目才能划分 A/B 两面');
  } else {
    tracks.forEach((t, i) => {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) {
        errors.push(`第 ${i + 1} 首曲目缺少名称`);
      }
      if (!t || !Number.isFinite(t.durationSec) || t.durationSec <= 0) {
        errors.push(`第 ${i + 1} 首曲目时长必须为正数(秒)`);
      }
      if (mode === 'variable') {
        const c = t?.dynamicCoeff;
        if (
          typeof c !== 'number' ||
          !Number.isFinite(c) ||
          c < MIN_COEFF - EPS ||
          c > MAX_COEFF + EPS
        ) {
          errors.push(
            `第 ${i + 1} 首曲目动态系数必须为 ${MIN_COEFF}~${MAX_COEFF} 之间的数值`,
          );
        }
      }
    });
  }
  if (!params || typeof params !== 'object') {
    errors.push('缺少参数');
    return errors;
  }
  if (params.mode !== undefined && params.mode !== 'constant' && params.mode !== 'variable') {
    errors.push('沟距模式不合法(仅支持 constant 恒定沟距 / variable 可变沟距)');
  }
  if (!(params.rpm > 0)) errors.push('转速必须为正数');
  if (!(params.innerRadiusMm > 0)) errors.push('内有效半径必须为正数');
  if (!(params.outerRadiusMm > params.innerRadiusMm)) errors.push('外有效半径必须大于内有效半径');
  if (!(params.gapWidthMm >= 0)) errors.push('曲间留白宽度不能为负数');
  if (!(params.minPitchUm > 0)) errors.push('最小沟距必须为正数');
  return errors;
}

/**
 * 可变沟距模式:求使音乐部分径向占用恰好不超过预算的最大 λ。
 *
 * 曲间留白是固定径向宽度(已在净宽度 Wn 中扣除),不参与宽度方程;
 * 留白只按 max(min, λ) 的沟距计算播放耗时。
 *
 *   D(λ) = Σ_i n_i·max(min, λ·c_i) ≤ Wn·1000
 *
 * D 是分段线性(斜率只增不减)的单调函数,转折点为 min/c_i;
 * 按转折点升序逐段做线性求根。全部取最低沟距仍超预算 → null。
 */
function solveMaxLambda(
  coeffs: number[],
  revs: number[],
  minPitchUm: number,
  usableWidthMm: number,
): { lambdaUm: number; minTrackPitchUm: number } | null {
  const budgetUm = usableWidthMm * 1000;

  // λ 足够小时的平台占用:所有曲目都压在最低沟距
  const totalRev = revs.reduce((s, n) => s + n, 0);
  let floorWidthUm = totalRev * minPitchUm;
  if (floorWidthUm > budgetUm + WIDTH_EPS_UM) return null;

  // 转折点(数值相同的归为一组,避免零宽区间)
  const kinks = coeffs
    .map((c, index) => ({ at: minPitchUm / c, index }))
    .sort((a, b) => a.at - b.at);

  // 平台恰好铺满:λ 取首个转折点(再大则最高系数曲目开始扩张而超限)
  if (Math.abs(floorWidthUm - budgetUm) <= WIDTH_EPS_UM) {
    return { lambdaUm: kinks[0].at, minTrackPitchUm: minPitchUm };
  }

  // 分段状态:开区间 (prevKink, kink) 上
  //   已激活曲目按 λ·c 计费 → slope 累加 n·c
  //   未激活曲目按最低沟距计费 → floorWidthUm 中保留 n·min
  let slope = 0;
  let prevKink = 0;

  let i = 0;
  while (i < kinks.length) {
    const at = kinks[i].at;
    // 当前段 D(λ) = floorWidthUm + slope·λ;slope=0 为平台(必然低于预算)
    if (slope > 0) {
      const lambda = (budgetUm - floorWidthUm) / slope;
      // 根落在本段 [prevKink, at] 内即答案(端点归属下一段但取值相同)
      if (lambda >= prevKink - EPS && lambda <= at + EPS) {
        return finalize(Math.min(lambda, at), coeffs, minPitchUm);
      }
    }
    // 激活本转折值对应的全部曲目:从常量项移到线性项
    while (i < kinks.length && Math.abs(kinks[i].at - at) <= EPS) {
      const { index } = kinks[i];
      floorWidthUm -= revs[index] * minPitchUm;
      slope += revs[index] * coeffs[index];
      i++;
    }
    prevKink = at;
  }

  // 末段:全部曲目已激活,D(λ) = slope·λ
  return finalize(budgetUm / slope, coeffs, minPitchUm);
}

function finalize(
  lambdaUm: number,
  coeffs: number[],
  minPitchUm: number,
): { lambdaUm: number; minTrackPitchUm: number } {
  let minTrackPitchUm = Infinity;
  for (const c of coeffs) {
    const p = Math.max(minPitchUm, lambdaUm * c);
    if (p < minTrackPitchUm) minTrackPitchUm = p;
  }
  return { lambdaUm, minTrackPitchUm };
}

/** 按给定的每轨沟距与留白沟距,从外圈向内排布,生成半径明细 */
function buildLayouts(
  sideTracks: TrackInput[],
  params: PlanParams,
  firstTrack: number,
  mode: PitchMode,
  trackPitchesUm: number[],
  gapPitchUm: number,
): { tracks: TrackLayout[]; gaps: GapLayout[] } {
  let r = params.outerRadiusMm;
  const tracks: TrackLayout[] = [];
  const gaps: GapLayout[] = [];

  sideTracks.forEach((t, i) => {
    const revolutions = (t.durationSec * params.rpm) / 60;
    const pitchUm = trackPitchesUm[i];
    const widthMm = (revolutions * pitchUm) / 1000;
    const startRadiusMm = r;
    r -= widthMm;
    tracks.push({
      trackNo: firstTrack + i,
      name: t.name,
      durationSec: t.durationSec,
      coeff: mode === 'variable' ? t.dynamicCoeff! : null,
      revolutions,
      pitchUm,
      widthMm,
      startRadiusMm,
      endRadiusMm: r,
    });

    if (i < sideTracks.length - 1) {
      const gapStart = r;
      r -= params.gapWidthMm;
      gaps.push({
        afterTrack: firstTrack + i,
        widthMm: params.gapWidthMm,
        pitchUm: gapPitchUm,
        sec: ((params.gapWidthMm * 1000) / gapPitchUm / params.rpm) * 60,
        startRadiusMm: gapStart,
        endRadiusMm: r,
      });
    }
  });

  return { tracks, gaps };
}

function calcSide(
  sideTracks: TrackInput[],
  params: PlanParams,
  firstTrack: number,
  mode: PitchMode,
): SideCalc {
  const musicSec = sideTracks.reduce((s, t) => s + t.durationSec, 0);
  const revolutions = (musicSec * params.rpm) / 60;
  const gapCount = Math.max(0, sideTracks.length - 1);
  const gapWidthTotalMm = gapCount * params.gapWidthMm;
  const totalWidthMm = params.outerRadiusMm - params.innerRadiusMm;
  const usableWidthMm = totalWidthMm - gapWidthTotalMm;

  const base = {
    mode,
    firstTrack,
    lastTrack: firstTrack + sideTracks.length - 1,
    trackCount: sideTracks.length,
    musicSec,
    revolutions,
    gapCount,
    gapWidthTotalMm,
    totalWidthMm,
    usableWidthMm,
  };

  const reasons: string[] = [];

  if (usableWidthMm <= 0) {
    reasons.push(
      `扣除 ${gapCount} 条留白(共 ${gapWidthTotalMm.toFixed(2)}mm)后净径向宽度为 ` +
        `${usableWidthMm.toFixed(2)}mm ≤ 0(可用总宽 ${totalWidthMm.toFixed(2)}mm)`,
    );
    return {
      ...base,
      pitchUm: null,
      lambdaUm: null,
      minTrackPitchUm: null,
      gapPitchUm: null,
      gapSec: 0,
      totalSec: musicSec,
      tracks: [],
      gaps: [],
      ok: false,
      reasons,
    };
  }

  if (mode === 'constant') {
    const pitchUm = (usableWidthMm * 1000) / revolutions;
    if (pitchUm < params.minPitchUm - EPS) {
      reasons.push(`沟距 ${pitchUm.toFixed(1)}µm 低于安全阈值 ${params.minPitchUm}µm`);
    }
    const { tracks, gaps } = buildLayouts(
      sideTracks,
      params,
      firstTrack,
      'constant',
      sideTracks.map(() => pitchUm),
      pitchUm,
    );
    const gapSec = ((gapWidthTotalMm * 1000) / pitchUm / params.rpm) * 60;
    return {
      ...base,
      pitchUm,
      lambdaUm: null,
      minTrackPitchUm: null,
      gapPitchUm: null,
      gapSec,
      totalSec: musicSec + gapSec,
      tracks,
      gaps,
      ok: reasons.length === 0,
      reasons,
    };
  }

  // 可变沟距模式
  const coeffs = sideTracks.map((t) => t.dynamicCoeff!);
  const perRevs = sideTracks.map((t) => (t.durationSec * params.rpm) / 60);
  const solved = solveMaxLambda(
    coeffs,
    perRevs,
    params.minPitchUm,
    usableWidthMm,
  );

  if (solved === null) {
    // 连最低沟距都容不下:按最低沟距排布(会越过内有效半径)并淘汰
    const floorPitch = params.minPitchUm;
    const { tracks, gaps } = buildLayouts(
      sideTracks,
      params,
      firstTrack,
      'variable',
      coeffs.map(() => floorPitch),
      floorPitch,
    );
    // 音乐按最低沟距所需径向宽度 + 留白固定宽度
    const musicFloorMm = (revolutions * floorPitch) / 1000;
    reasons.push(
      `即使 ${sideTracks.length} 首曲目全部按最低沟距 ${floorPitch}µm 刻录,` +
        `仍需音乐 ${musicFloorMm.toFixed(2)}mm + 留白 ${gapWidthTotalMm.toFixed(2)}mm ` +
        `= ${(musicFloorMm + gapWidthTotalMm).toFixed(2)}mm > 净径向宽度 ${usableWidthMm.toFixed(2)}mm`,
    );
    const gapSec = ((gapWidthTotalMm * 1000) / floorPitch / params.rpm) * 60;
    return {
      ...base,
      pitchUm: null,
      lambdaUm: null,
      minTrackPitchUm: floorPitch,
      gapPitchUm: floorPitch,
      gapSec,
      totalSec: musicSec + gapSec,
      tracks,
      gaps,
      ok: false,
      reasons,
    };
  }

  const { lambdaUm, minTrackPitchUm } = solved;
  const trackPitchesUm = coeffs.map((c) => Math.max(params.minPitchUm, lambdaUm * c));
  const gapPitchUm = Math.max(params.minPitchUm, lambdaUm);
  const { tracks, gaps } = buildLayouts(
    sideTracks,
    params,
    firstTrack,
    'variable',
    trackPitchesUm,
    gapPitchUm,
  );
  const gapSec = ((gapWidthTotalMm * 1000) / gapPitchUm / params.rpm) * 60;
  return {
    ...base,
    pitchUm: null,
    lambdaUm,
    minTrackPitchUm,
    gapPitchUm,
    gapSec,
    totalSec: musicSec + gapSec,
    tracks,
    gaps,
    ok: true,
    reasons: [],
  };
}

export function computePlan(tracks: TrackInput[], params: PlanParams): PlanResult {
  const errors = validateInputs(tracks, params);
  if (errors.length > 0) {
    throw new Error(errors.join(';'));
  }
  const mode = normalizeMode(params.mode);

  const candidates: Candidate[] = [];
  for (let cut = 1; cut < tracks.length; cut++) {
    const sideA = calcSide(tracks.slice(0, cut), params, 1, mode);
    const sideB = calcSide(tracks.slice(cut), params, cut + 1, mode);
    const feasible = sideA.ok && sideB.ok;
    candidates.push({
      cutAfter: cut,
      sideA,
      sideB,
      feasible,
      reasons: [
        ...sideA.reasons.map((r) => `A 面:${r}`),
        ...sideB.reasons.map((r) => `B 面:${r}`),
      ],
      worsePitchUm:
        feasible && mode === 'constant' ? Math.min(sideA.pitchUm!, sideB.pitchUm!) : null,
      worseLambdaUm:
        feasible && mode === 'variable' ? Math.min(sideA.lambdaUm!, sideB.lambdaUm!) : null,
      durationDiffSec: feasible ? Math.abs(sideA.totalSec - sideB.totalSec) : null,
    });
  }

  // 字典序优选:
  //   恒定模式 ① 最大化较差一面沟距;可变模式 ① 最大化较差一面 λ
  //   ② 最小化两面总时长差
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (!c.feasible) continue;
    if (!best) {
      best = c;
      continue;
    }
    const dPrimary =
      mode === 'variable'
        ? c.worseLambdaUm! - best.worseLambdaUm!
        : c.worsePitchUm! - best.worsePitchUm!;
    if (
      dPrimary > EPS ||
      (Math.abs(dPrimary) <= EPS && c.durationDiffSec! < best.durationDiffSec! - EPS)
    ) {
      best = c;
    }
  }

  // 恒定模式保持按切点升序的原始展示;可变模式按「较差面 λ 降序、时长差升序」排列,
  // 淘汰方案沉底(仍按切点升序)
  const ordered =
    mode === 'variable'
      ? [...candidates].sort((a, b) => {
          if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
          if (a.feasible) {
            const dLambda = b.worseLambdaUm! - a.worseLambdaUm!;
            if (Math.abs(dLambda) > EPS) return dLambda;
            const dTime = a.durationDiffSec! - b.durationDiffSec!;
            if (Math.abs(dTime) > EPS) return dTime;
          }
          return a.cutAfter - b.cutAfter;
        })
      : candidates;

  return { candidates: ordered, bestCutAfter: best ? best.cutAfter : null };
}
