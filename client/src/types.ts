export interface TrackInput {
  name: string;
  durationSec: number;
}

export interface PlanParams {
  rpm: number;
  outerRadiusMm: number;
  innerRadiusMm: number;
  gapWidthMm: number;
  minPitchUm: number;
}

export interface SideCalc {
  firstTrack: number;
  lastTrack: number;
  trackCount: number;
  musicSec: number;
  revolutions: number;
  gapCount: number;
  gapWidthTotalMm: number;
  totalWidthMm: number;
  usableWidthMm: number;
  pitchUm: number | null;
  gapSec: number;
  totalSec: number;
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
