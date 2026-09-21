import { useState } from 'react';
import type { TrackInput } from '../types';
import { formatDuration, parseDuration } from '../time';

interface Props {
  tracks: TrackInput[];
  onChange: (tracks: TrackInput[]) => void;
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

export default function TrackEditor({ tracks, onChange }: Props) {
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
          onChange([...tracks, { name: `新曲目 ${tracks.length + 1}`, durationSec: 180 }])
        }
      >
        + 添加曲目
      </button>
    </section>
  );
}
