import type { Candidate, PlanResult, SideCalc } from '../types';
import { fmt, formatDuration } from '../time';

/** 从外圈向内:把曲目与留白带按实际刻录顺序交错展开 */
function RadialLayout({ side }: { side: SideCalc }) {
  const rows: {
    key: string;
    label: string;
    coeff: string;
    pitch: number;
    width: number;
    start: number;
    end: number;
    isGap: boolean;
  }[] = [];

  side.tracks.forEach((t) => {
    rows.push({
      key: `t${t.trackNo}`,
      label: `${t.trackNo}. ${t.name}`,
      coeff: t.coeff === null ? '—' : t.coeff.toString(),
      pitch: t.pitchUm,
      width: t.widthMm,
      start: t.startRadiusMm,
      end: t.endRadiusMm,
      isGap: false,
    });
    const g = side.gaps.find((x) => x.afterTrack === t.trackNo);
    if (g) {
      rows.push({
        key: `g${g.afterTrack}`,
        label: `曲间留白(${g.sec.toFixed(1)} 秒)`,
        coeff: '—',
        pitch: g.pitchUm,
        width: g.widthMm,
        start: g.startRadiusMm,
        end: g.endRadiusMm,
        isGap: true,
      });
    }
  });

  return (
    <table className="radial-table">
      <thead>
        <tr>
          <th>轨道(外 → 内)</th>
          <th>系数</th>
          <th>沟距 (µm/转)</th>
          <th>占宽 (mm)</th>
          <th>起半径 (mm)</th>
          <th>止半径 (mm)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.isGap ? 'gap-row' : ''}>
            <td className="rl-name">{r.label}</td>
            <td>{r.coeff}</td>
            <td>{r.pitch.toFixed(1)}</td>
            <td>{r.width.toFixed(3)}</td>
            <td>{r.start.toFixed(2)}</td>
            <td>{r.end.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideDetail({ label, side }: { label: string; side: SideCalc }) {
  const variable = side.mode === 'variable';
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
          {variable ? (
            <>
              <tr className="pitch-row">
                <td>最大基准 λ(系数 1 的沟距)</td>
                <td>{fmt(side.lambdaUm, 1, ' µm')}</td>
              </tr>
              <tr>
                <td>各轨实际沟距最小值</td>
                <td>{fmt(side.minTrackPitchUm, 1, ' µm')}</td>
              </tr>
              <tr>
                <td>留白刻录沟距 max(最小沟距, λ)</td>
                <td>{fmt(side.gapPitchUm, 1, ' µm')}</td>
              </tr>
            </>
          ) : (
            <tr className="pitch-row">
              <td>恒定沟距 p = Wn × 1000 ÷ N</td>
              <td>{fmt(side.pitchUm, 1, ' µm')}</td>
            </tr>
          )}
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

      {side.ok && variable && side.tracks.length > 0 && (
        <details className="radial-details">
          <summary>每轨实际沟距与起止半径(外 → 内)</summary>
          <RadialLayout side={side} />
        </details>
      )}

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
  const variable = c.sideA.mode === 'variable';
  return (
    <div className={`candidate ${c.feasible ? 'feasible' : 'rejected'} ${isBest ? 'best' : ''}`}>
      <div className="candidate-head">
        <span className="cut">切点:第 {c.cutAfter} 首之后</span>
        {isBest && <span className="badge best-badge">★ 最优方案</span>}
        {!c.feasible && <span className="badge reject-badge">淘汰</span>}
        {c.feasible && !isBest && <span className="badge ok-badge">合格</span>}
      </div>

      <div className="candidate-summary">
        {variable ? (
          <>
            <span>
              A 面 λ <strong>{fmt(c.sideA.lambdaUm, 1, ' µm')}</strong>
            </span>
            <span>
              B 面 λ <strong>{fmt(c.sideB.lambdaUm, 1, ' µm')}</strong>
            </span>
            <span>
              较差面 λ <strong>{fmt(c.worseLambdaUm, 1, ' µm')}</strong>
            </span>
          </>
        ) : (
          <>
            <span>
              A 面沟距 <strong>{fmt(c.sideA.pitchUm, 1, ' µm')}</strong>
            </span>
            <span>
              B 面沟距 <strong>{fmt(c.sideB.pitchUm, 1, ' µm')}</strong>
            </span>
            <span>
              较差面 <strong>{fmt(c.worsePitchUm, 1, ' µm')}</strong>
            </span>
          </>
        )}
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
  const variable = result.candidates[0]?.sideA.mode === 'variable';
  return (
    <section className="panel results">
      <h2>
        候选切点({result.candidates.length} 个,合格 {feasibleCount} 个)
        {variable && <small> 已按较差面 λ 降序排列</small>}
      </h2>

      {result.bestCutAfter !== null ? (
        <div className="best-banner">
          最优切点:第 <strong>{result.bestCutAfter}</strong> 首之后 ——
          {variable
            ? '先最大化较差一面的基准 λ,再最小化两面时长差'
            : '先最大化较差一面沟距,再最小化两面时长差'}
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
