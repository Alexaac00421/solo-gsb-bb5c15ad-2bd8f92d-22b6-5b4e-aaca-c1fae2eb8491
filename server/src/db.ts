import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { sampleParams, sampleProjectName, sampleTracks } from './seed.js';
import type { PlanParams, TrackInput } from './planner.js';

export interface ProjectPayload {
  tracks: TrackInput[];
  params: PlanParams;
}

export interface ProjectMeta {
  id: number;
  name: string;
  created_at: string;
}

export interface ProjectDetail extends ProjectMeta {
  payload: ProjectPayload;
}

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'vinyl.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export function listProjects(): ProjectMeta[] {
  return db
    .prepare('SELECT id, name, created_at FROM projects ORDER BY id')
    .all() as ProjectMeta[];
}

export function getProject(id: number): ProjectDetail | null {
  const row = db
    .prepare('SELECT id, name, payload, created_at FROM projects WHERE id = ?')
    .get(id) as { id: number; name: string; payload: string; created_at: string } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, created_at: row.created_at, payload: JSON.parse(row.payload) };
}

export function createProject(name: string, payload: ProjectPayload): ProjectMeta {
  const info = db
    .prepare('INSERT INTO projects (name, payload) VALUES (?, ?)')
    .run(name, JSON.stringify(payload));
  return getProject(Number(info.lastInsertRowid))!;
}

export function deleteProject(id: number): boolean {
  return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

/** 数据库为空时写入示例方案,方便首次启动直接体验 */
export function seedIfEmpty(): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
  if (n === 0) {
    createProject(sampleProjectName, { tracks: sampleTracks, params: sampleParams });
  }
}
