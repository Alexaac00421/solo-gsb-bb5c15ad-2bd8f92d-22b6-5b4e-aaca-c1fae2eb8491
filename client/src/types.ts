export type PitchMode = 'constant' | 'variable';

export interface TrackInput {
  name: string;
  durationSec: number;
  /** 可变沟距模式下的动态系数(0.5~2) */
  dynamicCoeff?: number;
}

export interface PlanParams {
  mode?: PitchMode;
  rpm: number;
  outerRadiusMm: number;
  innerRadiusMm: number;
  gapWidthMm: number;
  minPitchUm: number;
}

/** 单轨径向排布(从外圈向内) */
export interface TrackLayout {
  trackNo: number;
  name: string;
  durationSec: number;
  coeff: number | null;
  revolutions: number;
  pitchUm: number;
  widthMm: number;
  startRadiusMm: number;
  endRadiusMm: number;
}

/** 曲间留白带径向排布 */
export interface GapLayout {
  afterTrack: number;
  widthMm: number;
  pitchUm: number;
  sec: number;
  startRadiusMm: number;
  endRadiusMm: number;
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
  /** 恒定沟距 µm/转(仅恒定模式) */
  pitchUm: number | null;
  /** 可变模式最大基准 λ µm/转 */
  lambdaUm: number | null;
  /** 可变模式各轨实际沟距最小值 µm */
  minTrackPitchUm: number | null;
  /** 可变模式留白刻录沟距 µm */
  gapPitchUm: number | null;
  gapSec: number;
  totalSec: number;
  tracks: TrackLayout[];
  gaps: GapLayout[];
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
