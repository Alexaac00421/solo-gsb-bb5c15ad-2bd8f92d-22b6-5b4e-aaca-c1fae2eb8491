import { useEffect, useState } from 'react';
import { api } from './api';
import type { PitchMode, PlanParams, PlanResult, ProjectMeta, TrackInput } from './types';
import ParamsForm from './components/ParamsForm';
import TrackEditor from './components/TrackEditor';
import ResultsView from './components/ResultsView';

const defaultParams: PlanParams = {
  mode: 'constant',
  rpm: 33.333,
  outerRadiusMm: 146,
  innerRadiusMm: 60,
  gapWidthMm: 1.2,
  minPitchUm: 80,
};

const defaultTracks: TrackInput[] = [
  { name: '序曲 Overture', durationSec: 312, dynamicCoeff: 1.4 },
  { name: '霓虹航道', durationSec: 245, dynamicCoeff: 1.1 },
  { name: '慢速旋转', durationSec: 198, dynamicCoeff: 0.8 },
  { name: '沟槽之间', durationSec: 167, dynamicCoeff: 0.7 },
  { name: '半径之外', durationSec: 284, dynamicCoeff: 1.3 },
  { name: '留白', durationSec: 176, dynamicCoeff: 0.6 },
  { name: '内圈回声', durationSec: 233, dynamicCoeff: 1.0 },
  { name: '四十五转', durationSec: 205, dynamicCoeff: 1.2 },
  { name: '静噪', durationSec: 149, dynamicCoeff: 0.9 },
  { name: '终曲:归位', durationSec: 368, dynamicCoeff: 1.5 },
];

/** 兼容旧方案:缺省 mode 视为恒定;可变模式下缺动态系数补 1 */
function normalizePayload(tracks: TrackInput[], params: PlanParams): {
  tracks: TrackInput[];
  params: PlanParams;
} {
  const mode: PitchMode = params.mode === 'variable' ? 'variable' : 'constant';
  return {
    params: { ...params, mode },
    tracks:
      mode === 'variable'
        ? tracks.map((t) =>
            typeof t.dynamicCoeff === 'number' && Number.isFinite(t.dynamicCoeff)
              ? t
              : { ...t, dynamicCoeff: 1 },
          )
        : tracks,
  };
}

export default function App() {
  const [tracks, setTracks] = useState<TrackInput[]>(defaultTracks);
  const [params, setParams] = useState<PlanParams>(defaultParams);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');

  const refreshProjects = () =>
    api.listProjects().then(setProjects).catch(() => undefined);

  useEffect(() => {
    refreshProjects();
  }, []);

  // 输入变化后自动重新计算(防抖 250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .plan(tracks, params)
        .then((r) => {
          setResult(r);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [tracks, params]);

  const loadProject = async (id: number) => {
    try {
      const p = await api.getProject(id);
      const normalized = normalizePayload(p.payload.tracks, p.payload.params);
      setTracks(normalized.tracks);
      setParams(normalized.params);
      setSelectedId(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveProject = async () => {
    const name = window.prompt('方案名称:', '我的分面方案');
    if (!name?.trim()) return;
    try {
      const saved = await api.saveProject(name.trim(), tracks, params);
      await refreshProjects();
      setSelectedId(saved.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeProject = async () => {
    if (selectedId === '') return;
    if (!window.confirm('确定删除该方案?')) return;
    try {
      await api.deleteProject(selectedId);
      setSelectedId('');
      await refreshProjects();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const mode: PitchMode = params.mode === 'variable' ? 'variable' : 'constant';

  // 切换到可变模式时确保每首曲目都有合法动态系数
  const changeParams = (next: PlanParams) => {
    if (next.mode === 'variable' && mode !== 'variable') {
      setTracks((ts) =>
        ts.map((t) =>
          typeof t.dynamicCoeff === 'number' && Number.isFinite(t.dynamicCoeff)
            ? t
            : { ...t, dynamicCoeff: 1 },
        ),
      );
    }
    setParams(next);
  };

  return (
    <div className="app">
      <header>
        <h1>🎛️ 黑胶唱片分面规划</h1>
        <div className="project-bar">
          <select
            value={selectedId}
            onChange={(e) => {
              const v = e.target.value;
              if (v) loadProject(Number(v));
            }}
          >
            <option value="">载入已存方案…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={saveProject}>保存当前方案</button>
          <button onClick={removeProject} disabled={selectedId === ''}>
            删除
          </button>
        </div>
      </header>

      {error && <div className="error-banner">⚠️ {error}</div>}

      <main>
        <div className="left">
          <ParamsForm params={params} onChange={changeParams} />
          <TrackEditor tracks={tracks} mode={mode} onChange={setTracks} />
        </div>
        <div className="right">{result && <ResultsView result={result} />}</div>
      </main>
    </div>
  );
}
