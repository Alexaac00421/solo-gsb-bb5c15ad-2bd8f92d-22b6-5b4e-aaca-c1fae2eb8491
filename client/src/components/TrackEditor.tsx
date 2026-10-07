import { useState } from 'react';
import type { PitchMode, TrackInput } from '../types';
import { formatDuration, parseDuration } from '../time';

interface Props {
  tracks: TrackInput[];
  mode: PitchMode;
  onChange: (tracks: TrackInput[]) => void;
}

const MIN_COEFF = 0.5;
const MAX_COEFF = 2;

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

function CoeffCell({ value, onCommit }: { value: number; onCommit: (c: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const parsed = Number(text);
  const invalid = !Number.isFinite(parsed) || parsed < MIN_COEFF || parsed > MAX_COEFF;

  return (
    <input
      className={`coeff-input${editing && invalid ? ' invalid' : ''}`}
      value={editing ? text : String(value)}
      title={`动态系数 ${MIN_COEFF}~${MAX_COEFF}:响度/调制越大系数越大`}
      onFocus={() => {
        setText(String(value));
        setEditing(true);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= MIN_COEFF && v <= MAX_COEFF) onCommit(v);
      }}
      onBlur={() => {
        // 失焦时把非法/越界值回退到最近的合法系数
        const v = Number(text);
        if (!Number.isFinite(v)) {
          setText(String(value));
        } else {
          const clamped = Math.min(MAX_COEFF, Math.max(MIN_COEFF, v));
          onCommit(clamped);
          setText(String(clamped));
        }
        setEditing(false);
      }}
    />
  );
}

export default function TrackEditor({ tracks, mode, onChange }: Props) {
  const total = tracks.reduce((s, t) => s + t.durationSec, 0);

  const update = (i: number, patch: Partial<TrackInput>) =>
    onChange(tracks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tracks.length) return;
    const next = [...tracks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

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
            {mode === 'variable' && <th>动态系数 (0.5~2)</th>}
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
              {mode === 'variable' && (
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
      <button
        className="add-track"
        onClick={() =>
          onChange([
            ...tracks,
            { name: `新曲目 ${tracks.length + 1}`, durationSec: 180, dynamicCoeff: 1 },
          ])
        }
      >
        + 添加曲目
      </button>
    </section>
  );
}
