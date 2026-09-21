import { useState } from 'react';
import type { PitchMode, TrackInput } from '../types';
import { formatDuration, parseDuration } from '../time';

interface Props {
  tracks: TrackInput[];
  onChange: (tracks: TrackInput[]) => void;
  mode: PitchMode;
}

function DurationCell({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (sec: number) => void;
}) {
  const [text, setText] = useState(formatDuration(value));
  const [editing, setEditing] = useState(false);
  const invalid = parseDuration(text) === null;

  return (
    <input
      className={`duration-input${editing && invalid ? ' invalid' : ''}`}
      value={editing ? text : formatDuration(value)}
      title="支持 mm:ss 或秒数"
      onFocus={() => {
        setText(formatDuration(value));
        setEditing(true);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseDuration(e.target.value);
        if (v !== null) onCommit(v);
      }}
      onBlur={() => setEditing(false)}
    />
  );
}

/** 动态系数输入(0.5~2),非法值本地标红但不覆盖已提交值 */
function CoeffCell({ value, onCommit }: { value: number; onCommit: (c: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  const parsed = Number(text);
  const invalid = !Number.isFinite(parsed) || parsed < 0.5 || parsed > 2;

  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 0.5 && v <= 2) onCommit(v);
    setEditing(false);
  };

  return (
    <input
      className={`coeff-input${editing && invalid ? ' invalid' : ''}`}
      value={editing ? text : Number.isFinite(value) ? String(value) : '1'}
      title="动态系数 0.5~2:该轨沟距 = max(最小沟距, λ×系数)"
      onFocus={() => {
        setText(String(value));
        setEditing(true);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0.5 && v <= 2) onCommit(v);
      }}
      onBlur={commit}
      step={0.1}
      min={0.5}
      max={2}
    />
  );
}

export default function TrackEditor({ tracks, onChange, mode }: Props) {
  const total = tracks.reduce((s, t) => s + t.durationSec, 0);
  const variable = mode === 'variable';

  const update = (i: number, patch: Partial<TrackInput>) =>
    onChange(tracks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tracks.length) return;
    const next = [...tracks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const addTrack = () =>
    onChange([
      ...tracks,
      {
        name: `新曲目 ${tracks.length + 1}`,
        durationSec: 180,
        ...(variable ? { dynamicCoeff: 1 } : {}),
      },
    ]);

  return (
    <section className="panel">
      <h2>
        曲目顺序 <small>共 {tracks.length} 首 · {formatDuration(total)}</small>
      </h2>
      <table className="track-table">
        <thead>
          <tr>
            <th>#</th>
            <th>曲名</th>
            <th>时长 (mm:ss)</th>
            {variable && <th title="该轨沟距 = max(最小沟距, λ×动态系数)">动态系数</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t, i) => (
            <tr key={i}>
              <td className="idx">{i + 1}</td>
              <td>
                <input
                  className="name-input"
                  value={t.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </td>
              <td>
                <DurationCell value={t.durationSec} onCommit={(sec) => update(i, { durationSec: sec })} />
              </td>
              {variable && (
                <td>
                  <CoeffCell
                    value={t.dynamicCoeff ?? 1}
                    onCommit={(c) => update(i, { dynamicCoeff: c })}
                  />
                </td>
              )}
              <td className="row-actions">
                <button title="上移" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button title="下移" disabled={i === tracks.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button
                  title="删除"
                  disabled={tracks.length <= 2}
                  onClick={() => onChange(tracks.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="add-track" onClick={addTrack}>
        + 添加曲目
      </button>
    </section>
  );
}
