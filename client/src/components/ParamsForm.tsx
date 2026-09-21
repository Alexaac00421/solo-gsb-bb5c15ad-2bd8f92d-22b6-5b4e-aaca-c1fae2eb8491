import type { PitchMode, PlanParams } from '../types';

interface Props {
  params: PlanParams;
  onChange: (params: PlanParams) => void;
}

interface FieldDef {
  key: keyof PlanParams;
  label: string;
  unit: string;
  step: number;
  hint?: string;
}

const fields: FieldDef[] = [
  { key: 'rpm', label: '转速', unit: 'rpm', step: 0.001, hint: '33.333 或 45' },
  { key: 'outerRadiusMm', label: '外有效半径', unit: 'mm', step: 0.5, hint: '最外圈沟槽半径' },
  { key: 'innerRadiusMm', label: '内有效半径', unit: 'mm', step: 0.5, hint: '最内圈沟槽半径' },
  { key: 'gapWidthMm', label: '曲间留白', unit: 'mm', step: 0.1, hint: '每条留白带的径向宽度' },
  { key: 'minPitchUm', label: '最小沟距', unit: 'µm', step: 1, hint: '安全阈值,低于则淘汰' },
];

const modeOptions: { value: PitchMode; label: string; hint: string }[] = [
  { value: 'constant', label: '恒定沟距', hint: '全片统一沟距 p = Wn×1000÷N' },
  { value: 'variable', label: '可变沟距', hint: '按曲目动态系数 c(0.5~2),p = max(最小沟距, λ×c),自动求最大 λ' },
];

export default function ParamsForm({ params, onChange }: Props) {
  const mode = params.mode === 'variable' ? 'variable' : 'constant';

  return (
    <section className="panel">
      <h2>刻录参数</h2>

      <div className="mode-switch" role="radiogroup" aria-label="沟距模式">
        {modeOptions.map((o) => (
          <label
            key={o.value}
            className={`mode-option ${mode === o.value ? 'active' : ''}`}
            title={o.hint}
          >
            <input
              type="radio"
              name="pitch-mode"
              checked={mode === o.value}
              onChange={() => onChange({ ...params, mode: o.value })}
            />
            <span className="mode-label">{o.label}</span>
            <span className="mode-hint">{o.hint}</span>
          </label>
        ))}
      </div>

      <div className="params-grid">
        {fields.map((f) => (
          <label key={f.key} className="field">
            <span className="field-label">
              {f.label} <em>({f.unit})</em>
            </span>
            <input
              type="number"
              step={f.step}
              min={0}
              value={params[f.key] as number}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChange({ ...params, [f.key]: v });
              }}
            />
            {f.hint && <span className="field-hint">{f.hint}</span>}
          </label>
        ))}
      </div>
    </section>
  );
}
