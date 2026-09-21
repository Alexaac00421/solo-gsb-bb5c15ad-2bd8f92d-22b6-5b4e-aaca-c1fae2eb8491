/**
 * 黑胶唱片 A/B 面切分规划核心算法(纯函数,不依赖 Express / SQLite)。
 *
 * 两种沟距模式:
 *
 * 1. 恒定沟距(constant,默认):
 *   - 有效径向宽度 W = 外有效半径 - 内有效半径 (mm)
 *   - 面内 k 首曲目之间有 (k-1) 条留白带,每条占径向宽度 gapWidthMm
 *   - 扣除留白后的净宽度 Wn = W - (k-1) * gapWidthMm
 *   - 该面音乐总时长 T(秒)在转速 rpm 下需要的总转数 N = T * rpm / 60
 *   - 恒定沟距 p = Wn * 1000 / N  (µm/转)
 *   - 留白带自身耗时:以相同沟距刻录,rev_gap = 留白宽*1000/p,耗时 = rev_gap / rpm * 60
 *
 * 2. 可变沟距(variable):
 *   - 每首曲目录入动态系数 c_i ∈ [0.5, 2],该轨实际沟距 p_i = max(p_min, λ·c_i)
 *   - 该轨消耗径向宽度 = N_i · p_i / 1000 (mm),N_i 为该轨转数
 *   - 曲间留白按系数 1 处理(留白沟距 = max(p_min, λ)),只占用固定径向宽度,
 *     不参与 λ 的求解(留白宽度已在 Wn 中扣除)
 *   - λ 取使 Σ N_i·p_i / 1000 ≤ Wn 的最大值:占用宽度关于 λ 为分段线性凸函数,
 *     在断点 λ = p_min/c_i 处该轨由「最低沟距档」转入「比例档」,按断点升序逐段求交即可
 *   - 连最低沟距都容不下(Σ N_i·p_min/1000 > Wn)→ 淘汰
 *
 * 枚举与优选:
 *   - 曲目顺序固定,切点 c ∈ [1, n-1],A 面 = 1..c,B 面 = c+1..n
 *   - 任一面不满足安全约束 → 淘汰,并记录原因
 *   - 合格方案中:
 *       恒定模式先最大化 min(pA, pB),可变模式先最大化 min(λA, λB);
 *       并列时再最小化 |TA - TB|(两面总时长差)
 */

export type PitchMode = 'constant' | 'variable';

export interface TrackInput {
  name: string;
  /** 曲目时长(秒) */
  durationSec: number;
  /** 动态系数(仅可变沟距模式使用),范围 0.5~2;恒定模式忽略 */
  dynamicCoeff?: number;
}

export interface PlanParams {
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
  /** 沟距模式:恒定(默认)或可变;缺省视为恒定,兼容旧数据 */
  mode?: PitchMode;
}

/** 可变沟距模式下单轨的刻录布局(从外圈向内排列) */
export interface TrackLayout {
  /** 全局曲目序号(从 1 开始) */
  index: number;
  name: string;
  durationSec: number;
  /** 该轨动态系数 */
  dynamicCoeff: number;
  /** 该轨转数 = durationSec * rpm / 60 */
  revolutions: number;
  /** 该轨实际沟距 µm/转 = max(最小沟距, λ×动态系数) */
  pitchUm: number;
  /** 该轨消耗径向宽度 mm */
  widthMm: number;
  /** 该轨外圈起始半径 mm */
  outerRadiusMm: number;
  /** 该轨内圈终止半径 mm */
  innerRadiusMm: number;
}

export interface SideCalc {
  /** 该面采用的沟距模式 */
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
  /** 恒定沟距 µm/转(仅恒定模式;净宽度 ≤ 0 等无解时为 null) */
  pitchUm: number | null;
  /** 可变模式的基准沟距 λ µm/转(仅可变模式;无解时为 null) */
  lambdaUm: number | null;
  /** 留白刻录沟距 µm/转:恒定模式等于 pitchUm,可变模式等于 max(最小沟距, λ) */
  gapPitchUm: number | null;
  /** 留白带播放耗时(秒) */
  gapSec: number;
  /** 该面总时长(秒,音乐 + 留白) */
  totalSec: number;
  /** 可变模式下逐轨布局(沟距、起止半径);恒定模式为 null */
  tracks: TrackLayout[] | null;
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
  /** 较差一面的 λ µm/转(仅可变模式合格方案) */
  worseLambdaUm: number | null;
  /** 两面总时长差(秒,仅合格方案) */
  durationDiffSec: number | null;
}

export interface PlanResult {
  /** 本次计算实际采用的沟距模式 */
  mode: PitchMode;
  candidates: Candidate[];
  /** 最优方案切点;无合格方案时为 null */
  bestCutAfter: number | null;
}

const EPS = 1e-6;

/** 动态系数允许范围 */
export const MIN_DYNAMIC_COEFF = 0.5;
export const MAX_DYNAMIC_COEFF = 2;

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
          c === undefined ||
          c === null ||
          !Number.isFinite(c) ||
          (c as number) < MIN_DYNAMIC_COEFF - EPS ||
          (c as number) > MAX_DYNAMIC_COEFF + EPS
        ) {
          errors.push(`第 ${i + 1} 首曲目的动态系数必须在 ${MIN_DYNAMIC_COEFF}~${MAX_DYNAMIC_COEFF} 之间`);
        }
      }
    });
  }
  if (!params || typeof params !== 'object') {
    errors.push('缺少参数');
    return errors;
  }
  if (
    params.mode !== undefined &&
    params.mode !== 'constant' &&
    params.mode !== 'variable'
  ) {
    errors.push('沟距模式只能是 constant(恒定)或 variable(可变)');
  }
  if (!(params.rpm > 0)) errors.push('转速必须为正数');
  if (!(params.innerRadiusMm > 0)) errors.push('内有效半径必须为正数');
  if (!(params.outerRadiusMm > params.innerRadiusMm)) errors.push('外有效半径必须大于内有效半径');
  if (!(params.gapWidthMm >= 0)) errors.push('曲间留白宽度不能为负数');
  if (!(params.minPitchUm > 0)) errors.push('最小沟距必须为正数');
  return errors;
}

/** 面内共有几何量 */
function sideGeometry(sideTracks: TrackInput[], params: PlanParams, firstTrack: number) {
  const musicSec = sideTracks.reduce((s, t) => s + t.durationSec, 0);
  const revolutions = (musicSec * params.rpm) / 60;
  const gapCount = Math.max(0, sideTracks.length - 1);
  const gapWidthTotalMm = gapCount * params.gapWidthMm;
  const totalWidthMm = params.outerRadiusMm - params.innerRadiusMm;
  const usableWidthMm = totalWidthMm - gapWidthTotalMm;
  return {
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
}

/** 恒定沟距模式:保持原计算行为 */
function calcConstantSide(sideTracks: TrackInput[], params: PlanParams, firstTrack: number): SideCalc {
  const g = sideGeometry(sideTracks, params, firstTrack);

  const reasons: string[] = [];
  let pitchUm: number | null = null;
  if (g.usableWidthMm <= 0) {
    reasons.push(
      `扣除 ${g.gapCount} 条留白(共 ${g.gapWidthTotalMm.toFixed(2)}mm)后净径向宽度为 ` +
        `${g.usableWidthMm.toFixed(2)}mm ≤ 0(可用总宽 ${g.totalWidthMm.toFixed(2)}mm)`,
    );
  } else {
    pitchUm = (g.usableWidthMm * 1000) / g.revolutions;
    if (pitchUm < params.minPitchUm - EPS) {
      reasons.push(`沟距 ${pitchUm.toFixed(1)}µm 低于安全阈值 ${params.minPitchUm}µm`);
    }
  }

  const gapPitchUm = pitchUm;
  const gapSec = pitchUm !== null ? ((g.gapWidthTotalMm * 1000) / pitchUm / params.rpm) * 60 : 0;

  return {
    mode: 'constant',
    ...g,
    pitchUm,
    lambdaUm: null,
    gapPitchUm,
    gapSec,
    totalSec: g.musicSec + gapSec,
    tracks: null,
    ok: reasons.length === 0,
    reasons,
  };
}

/**
 * 可变沟距模式:求不超过净径向宽度的最大 λ。
 *
 * 占用宽度(µm)f(λ) = Σ rev_i · max(p_min, λ·c_i),关于 λ 分段线性:
 *   - 断点 b_i = p_min / c_i;λ < b_i 时该轨走最低沟距档(贡献 rev_i·p_min 常数),
 *     λ ≥ b_i 时转比例档(贡献 rev_i·c_i·λ)
 *   - 按断点升序逐段推进,在某段内 f(λ) = flat + slope·λ,与预算 budget 求交
 *
 * @returns 最大 λ(µm/转);连最低沟距都容不下时返回 null
 */
function solveMaxLambda(
  revolutions: number[],
  coeffs: number[],
  minPitchUm: number,
  usableWidthMm: number,
): number | null {
  const budgetUm = usableWidthMm * 1000;

  // λ = 0 时所有曲目均走最低沟距档
  let flat = 0;
  for (let i = 0; i < revolutions.length; i++) {
    flat += revolutions[i] * minPitchUm;
  }
  if (budgetUm < flat - EPS) return null;

  // 断点升序:c 越大越早脱离最低档
  const order = coeffs
    .map((c, i) => ({ breakpoint: minPitchUm / c, index: i }))
    .sort((x, y) => x.breakpoint - y.breakpoint);

  let slope = 0;
  for (const { breakpoint, index } of order) {
    // 当前段 [上一断点, breakpoint] 内活动集合不变
    if (slope > 0) {
      const hit = (budgetUm - flat) / slope;
      if (hit <= breakpoint + EPS) return Math.max(0, hit);
    }
    // 越过该断点:该轨由最低档转为比例档
    flat -= revolutions[index] * minPitchUm;
    slope += revolutions[index] * coeffs[index];
  }
  // 全部曲目进入比例档
  return (budgetUm - flat) / slope;
}

/** 可变沟距模式 */
function calcVariableSide(sideTracks: TrackInput[], params: PlanParams, firstTrack: number): SideCalc {
  const g = sideGeometry(sideTracks, params, firstTrack);
  const revolutions = sideTracks.map((t) => (t.durationSec * params.rpm) / 60);
  const coeffs = sideTracks.map((t) => Number(t.dynamicCoeff));

  const reasons: string[] = [];
  let lambdaUm: number | null = null;
  let tracks: TrackLayout[] | null = null;
  let gapPitchUm: number | null = null;
  let gapSec = 0;

  if (g.usableWidthMm <= 0) {
    reasons.push(
      `扣除 ${g.gapCount} 条留白(共 ${g.gapWidthTotalMm.toFixed(2)}mm)后净径向宽度为 ` +
        `${g.usableWidthMm.toFixed(2)}mm ≤ 0(可用总宽 ${g.totalWidthMm.toFixed(2)}mm)`,
    );
  } else {
    lambdaUm = solveMaxLambda(revolutions, coeffs, params.minPitchUm, g.usableWidthMm);
    if (lambdaUm === null) {
      const floorWidthMm =
        (revolutions.reduce((s, r) => s + r * params.minPitchUm, 0)) / 1000;
      reasons.push(
        `即使所有曲目均按最低沟距 ${params.minPitchUm}µm 刻录,仍需径向宽度 ` +
          `${floorWidthMm.toFixed(2)}mm,超过净径向宽度 ${g.usableWidthMm.toFixed(2)}mm`,
      );
    } else {
      // 留白按系数 1 刻录:gapPitch = max(p_min, λ)
      gapPitchUm = Math.max(params.minPitchUm, lambdaUm);
      gapSec = ((g.gapWidthTotalMm * 1000) / gapPitchUm / params.rpm) * 60;

      // 从外圈向内逐轨排布:曲轨之间扣除固定留白宽
      let cursorRadiusMm = params.outerRadiusMm;
      tracks = sideTracks.map((t, i) => {
        const pitchUm = Math.max(params.minPitchUm, lambdaUm! * coeffs[i]);
        const widthMm = (revolutions[i] * pitchUm) / 1000;
        const outerRadiusMm = cursorRadiusMm;
        const innerRadiusMm = cursorRadiusMm - widthMm;
        cursorRadiusMm = innerRadiusMm;
        if (i < sideTracks.length - 1) cursorRadiusMm -= params.gapWidthMm;
        return {
          index: firstTrack + i,
          name: t.name,
          durationSec: t.durationSec,
          dynamicCoeff: coeffs[i],
          revolutions: revolutions[i],
          pitchUm,
          widthMm,
          outerRadiusMm,
          innerRadiusMm,
        };
      });
    }
  }

  return {
    mode: 'variable',
    ...g,
    pitchUm: null,
    lambdaUm,
    gapPitchUm,
    gapSec,
    totalSec: g.musicSec + gapSec,
    tracks,
    ok: reasons.length === 0,
    reasons,
  };
}

export function computePlan(tracks: TrackInput[], params: PlanParams): PlanResult {
  const errors = validateInputs(tracks, params);
  if (errors.length > 0) {
    throw new Error(errors.join(';'));
  }
  const mode = normalizeMode(params.mode);
  const calcSide = mode === 'variable' ? calcVariableSide : calcConstantSide;

  const candidates: Candidate[] = [];
  for (let cut = 1; cut < tracks.length; cut++) {
    const sideA = calcSide(tracks.slice(0, cut), params, 1);
    const sideB = calcSide(tracks.slice(cut), params, cut + 1);
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

  // 字典序优选:① 最大化较差一面的沟距(恒定)或 λ(可变);② 最小化两面时长差
  const worseMetric = (c: Candidate): number =>
    mode === 'variable' ? c.worseLambdaUm! : c.worsePitchUm!;

  let best: Candidate | null = null;
  for (const c of candidates) {
    if (!c.feasible) continue;
    if (!best) {
      best = c;
      continue;
    }
    const dMetric = worseMetric(c) - worseMetric(best);
    if (
      dMetric > EPS ||
      (Math.abs(dMetric) <= EPS && c.durationDiffSec! < best.durationDiffSec! - EPS)
    ) {
      best = c;
    }
  }

  return { mode, candidates, bestCutAfter: best ? best.cutAfter : null };
}
