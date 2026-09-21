import type { Candidate, PlanResult, SideCalc } from '../types';
import { fmt, formatDuration } from '../time';

function SideDetail({ label, side }: { label: string; side: SideCalc }) {
  return (
    <div className={`side-detail ${side.ok ? 'ok' : 'bad'}`}>
      <h4>
        {label} <span className="range">曲目 {side.firstTrack}–{side.lastTrack}</span>
      </h4>
      <table>
        <tbody>
          <tr>
            <td>音乐时长</td>
            <td>
              {formatDuration(side.musicSec)}({side.musicSec.toFixed(0)} 秒)
            </td>
          </tr>
          <tr>
            <td>总转数 N = 时长 × 转速 ÷ 60</td>
            <td>{fmt(side.revolutions, 1)} 转</td>
          </tr>
          <tr>
            <td>可用径向宽度(外 − 内)</td>
            <td>{fmt(side.totalWidthMm, 2, ' mm')}</td>
          </tr>
          <tr>
            <td>留白扣除({side.gapCount} 条)</td>
            <td>− {fmt(side.gapWidthTotalMm, 2, ' mm')}</td>
          </tr>
          <tr>
            <td>净径向宽度 Wn</td>
            <td>{fmt(side.usableWidthMm, 2, ' mm')}</td>
          </tr>
          <tr className="pitch-row">
            <td>恒定沟距 p = Wn × 1000 ÷ N</td>
            <td>{fmt(side.pitchUm, 1, ' µm')}</td>
          </tr>
          <tr>
            <td>留白播放耗时</td>
            <td>{fmt(side.gapSec, 1, ' 秒')}</td>
          </tr>
          <tr>
            <td>该面总时长</td>
            <td>
              {formatDuration(side.totalSec)}({side.totalSec.toFixed(0)} 秒)
            </td>
          </tr>
        </tbody>
      </table>
      {side.reasons.length > 0 && (
        <ul className="reasons">
          {side.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  isBest,
}: {
  candidate: Candidate;
  isBest: boolean;
}) {
  const c = candidate;
  return (
    <div className={`candidate ${c.feasible ? 'feasible' : 'rejected'} ${isBest ? 'best' : ''}`}>
      <div className="candidate-head">
        <span className="cut">切点:第 {c.cutAfter} 首之后</span>
        {isBest && <span className="badge best-badge">★ 最优方案</span>}
        {!c.feasible && <span className="badge reject-badge">淘汰</span>}
        {c.feasible && !isBest && <span className="badge ok-badge">合格</span>}
      </div>

      <div className="candidate-summary">
        <span>
          A 面沟距 <strong>{fmt(c.sideA.pitchUm, 1, ' µm')}</strong>
        </span>
        <span>
          B 面沟距 <strong>{fmt(c.sideB.pitchUm, 1, ' µm')}</strong>
        </span>
        <span>
          较差面 <strong>{fmt(c.worsePitchUm, 1, ' µm')}</strong>
        </span>
        <span>
          时长差 <strong>{c.durationDiffSec === null ? '—' : `${c.durationDiffSec.toFixed(1)} 秒`}</strong>
        </span>
      </div>

      {c.reasons.length > 0 && (
        <ul className="reasons">
          {c.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <details>
        <summary>计算明细</summary>
        <div className="sides">
          <SideDetail label="A 面" side={c.sideA} />
          <SideDetail label="B 面" side={c.sideB} />
        </div>
      </details>
    </div>
  );
}

export default function ResultsView({ result }: { result: PlanResult }) {
  const feasibleCount = result.candidates.filter((c) => c.feasible).length;
  return (
    <section className="panel results">
      <h2>候选切点({result.candidates.length} 个,合格 {feasibleCount} 个)</h2>

      {result.bestCutAfter !== null ? (
        <div className="best-banner">
          最优切点:第 <strong>{result.bestCutAfter}</strong> 首之后 ——
          先最大化较差一面沟距,再最小化两面时长差
        </div>
      ) : (
        <div className="best-banner none">
          没有满足安全阈值的方案:请放宽最小沟距、减小留白、缩短曲目或扩大有效半径范围
        </div>
      )}

      {result.candidates.map((c) => (
        <CandidateCard key={c.cutAfter} candidate={c} isBest={c.cutAfter === result.bestCutAfter} />
      ))}
    </section>
  );
}
