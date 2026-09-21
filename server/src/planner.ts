/**
 * 黑胶唱片 A/B 面切分规划核心算法(纯函数,不依赖 Express / SQLite)。
 *
 * 物理模型(恒定沟距):
 *   - 有效径向宽度 W = 外有效半径 - 内有效半径 (mm)
 *   - 面内 k 首曲目之间有 (k-1) 条留白带,每条占径向宽度 gapWidthMm
 *   - 扣除留白后的净宽度 Wn = W - (k-1) * gapWidthMm
 *   - 该面音乐总时长 T(秒)在转速 rpm 下需要的总转数 N = T * rpm / 60
 *   - 恒定沟距 p = Wn * 1000 / N  (µm/转)
 *   - 安全约束:p >= minPitchUm,且 Wn > 0
 *   - 留白带自身耗时:以相同沟距刻录,rev_gap = 留白宽*1000/p,耗时 = rev_gap / rpm * 60
 *
 * 枚举与优选:
 *   - 曲目顺序固定,切点 c ∈ [1, n-1],A 面 = 1..c,B 面 = c+1..n
 *   - 任一面不满足安全约束 → 淘汰,并记录原因
 *   - 合格方案中:先最大化 min(pA, pB)(较差一面的沟距),再最小化 |TA - TB|
 */

export interface TrackInput {
  name: string;
  /** 曲目时长(秒) */
  durationSec: number;
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
}

export interface SideCalc {
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
  /** 恒定沟距 µm/转;净宽度 ≤ 0 时为 null */
  pitchUm: number | null;
  /** 留白带播放耗时(秒) */
  gapSec: number;
  /** 该面总时长(秒,音乐 + 留白) */
  totalSec: number;
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
  /** 较差一面的沟距 µm(仅合格方案) */
  worsePitchUm: number | null;
  /** 两面总时长差(秒,仅合格方案) */
  durationDiffSec: number | null;
}

export interface PlanResult {
  candidates: Candidate[];
  /** 最优方案切点;无合格方案时为 null */
  bestCutAfter: number | null;
}

const EPS = 1e-6;

export function validateInputs(tracks: TrackInput[], params: PlanParams): string[] {
  const errors: string[] = [];
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
    });
  }
  if (!params || typeof params !== 'object') {
    errors.push('缺少参数');
    return errors;
  }
  if (!(params.rpm > 0)) errors.push('转速必须为正数');
  if (!(params.innerRadiusMm > 0)) errors.push('内有效半径必须为正数');
  if (!(params.outerRadiusMm > params.innerRadiusMm)) errors.push('外有效半径必须大于内有效半径');
  if (!(params.gapWidthMm >= 0)) errors.push('曲间留白宽度不能为负数');
  if (!(params.minPitchUm > 0)) errors.push('最小沟距必须为正数');
  return errors;
}

function calcSide(sideTracks: TrackInput[], params: PlanParams, firstTrack: number): SideCalc {
  const musicSec = sideTracks.reduce((s, t) => s + t.durationSec, 0);
  const revolutions = (musicSec * params.rpm) / 60;
  const gapCount = Math.max(0, sideTracks.length - 1);
  const gapWidthTotalMm = gapCount * params.gapWidthMm;
  const totalWidthMm = params.outerRadiusMm - params.innerRadiusMm;
  const usableWidthMm = totalWidthMm - gapWidthTotalMm;

  const reasons: string[] = [];
  let pitchUm: number | null = null;
  if (usableWidthMm <= 0) {
    reasons.push(
      `扣除 ${gapCount} 条留白(共 ${gapWidthTotalMm.toFixed(2)}mm)后净径向宽度为 ` +
        `${usableWidthMm.toFixed(2)}mm ≤ 0(可用总宽 ${totalWidthMm.toFixed(2)}mm)`,
    );
  } else {
    pitchUm = (usableWidthMm * 1000) / revolutions;
    if (pitchUm < params.minPitchUm - EPS) {
      reasons.push(`沟距 ${pitchUm.toFixed(1)}µm 低于安全阈值 ${params.minPitchUm}µm`);
    }
  }

  const gapSec = pitchUm !== null ? ((gapWidthTotalMm * 1000) / pitchUm / params.rpm) * 60 : 0;

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
    pitchUm,
    gapSec,
    totalSec: musicSec + gapSec,
    ok: reasons.length === 0,
    reasons,
  };
}

export function computePlan(tracks: TrackInput[], params: PlanParams): PlanResult {
  const errors = validateInputs(tracks, params);
  if (errors.length > 0) {
    throw new Error(errors.join(';'));
  }

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
      worsePitchUm: feasible ? Math.min(sideA.pitchUm!, sideB.pitchUm!) : null,
      durationDiffSec: feasible ? Math.abs(sideA.totalSec - sideB.totalSec) : null,
    });
  }

  // 字典序优选:① 最大化较差一面沟距;② 最小化两面时长差
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (!c.feasible) continue;
    if (!best) {
      best = c;
      continue;
    }
    const dPitch = c.worsePitchUm! - best.worsePitchUm!;
    if (
      dPitch > EPS ||
      (Math.abs(dPitch) <= EPS && c.durationDiffSec! < best.durationDiffSec! - EPS)
    ) {
      best = c;
    }
  }

  return { candidates, bestCutAfter: best ? best.cutAfter : null };
}
