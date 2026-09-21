export type PitchMode = 'constant' | 'variable';

export interface TrackInput {
  name: string;
  durationSec: number;
  /** 动态系数(仅可变沟距模式),0.5~2 */
  dynamicCoeff?: number;
}

export interface PlanParams {
  rpm: number;
  outerRadiusMm: number;
  innerRadiusMm: number;
  gapWidthMm: number;
  minPitchUm: number;
  /** 缺省视为 constant(兼容旧方案) */
  mode?: PitchMode;
}

export interface TrackLayout {
  index: number;
  name: string;
  durationSec: number;
  dynamicCoeff: number;
  revolutions: number;
  pitchUm: number;
  widthMm: number;
  outerRadiusMm: number;
  innerRadiusMm: number;
}

export interface SideCalc {
  mode: PitchMode;
  firstTrack: number;
  lastTrack: number;
  trackCount: number;
  musicSec: number;
  revolutions: number;
  gapCount: number;
  gapWidthTotalMm: number;
  totalWidthMm: number;
  usableWidthMm: number;
  /** 恒定沟距(仅恒定模式) */
  pitchUm: number | null;
  /** 可变模式基准沟距 λ(仅可变模式) */
  lambdaUm: number | null;
  /** 留白刻录沟距 */
  gapPitchUm: number | null;
  gapSec: number;
  totalSec: number;
  /** 可变模式逐轨布局 */
  tracks: TrackLayout[] | null;
  ok: boolean;
  reasons: string[];
}

export interface Candidate {
  cutAfter: number;
  sideA: SideCalc;
  sideB: SideCalc;
  feasible: boolean;
  reasons: string[];
  worsePitchUm: number | null;
  worseLambdaUm: number | null;
  durationDiffSec: number | null;
}

export interface PlanResult {
  mode: PitchMode;
  candidates: Candidate[];
  bestCutAfter: number | null;
}

export interface ProjectMeta {
  id: number;
  name: string;
  created_at: string;
}

export interface ProjectDetail extends ProjectMeta {
  payload: { tracks: TrackInput[]; params: PlanParams };
}
