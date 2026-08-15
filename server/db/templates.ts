/**
 * 템플릿 저장소 (app.sqlite).
 *
 * 내장 프리셋은 DB 에 넣지 않는다 — 코드가 유일한 출처다.
 * 프리셋 id 는 음수, 사용자 템플릿은 1부터라 절대 충돌하지 않는다.
 * 프리셋을 고치고 싶으면 '복제' 해서 사용자 템플릿으로 만든다.
 */

import {
  BUILTIN_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  getBuiltinTemplate,
  LEGACY_FONT_CHAINS,
} from '../../lib/template-presets.ts';
import type { Template } from '../../shared/types.ts';
import { getConnection } from './app.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  config     TEXT NOT NULL,   -- Template JSON (id/name/kind 제외한 나머지도 포함)
  updated_at TEXT NOT NULL
);
`;

export function initTemplateStore(): void {
  getConnection().exec(SCHEMA);
  upgradeLegacyFontChains();
}

/**
 * 저장된 템플릿의 옛 폰트 체인을 새 체인으로 올린다.
 *
 * 프리셋은 코드에서 만들어지므로 고치면 바로 반영되지만, 사용자가 저장한 사본은
 * 그때의 값이 JSON 으로 굳어 있다. 옛 체인은 총칭 `serif` 로만 끝나 다음절
 * 그리스어에서 글자별 폰트 대체가 일어났다 (같은 구절이 819.6px vs 526.6px).
 *
 * **문자열이 정확히 같을 때만** 바꾼다 — 사용자가 직접 고른 폰트는 건드리지 않는다.
 */
function upgradeLegacyFontChains(): number {
  const rows = getConnection().prepare('SELECT id, config FROM templates').all() as unknown as Array<{
    id: number;
    config: string;
  }>;

  const update = getConnection().prepare('UPDATE templates SET config = ? WHERE id = ?');
  let changed = 0;

  for (const row of rows) {
    let config: Template;
    try {
      config = JSON.parse(row.config) as Template;
    } catch {
      continue; // 깨진 JSON 은 parseRow 가 이미 걸러낸다
    }

    const byLang = config.overridesByLang;
    if (!byLang) continue;

    let touched = false;
    const next = { ...byLang };
    for (const [lang, style] of Object.entries(byLang)) {
      const replacement = LEGACY_FONT_CHAINS.find((chain) => chain.from === style?.fontFamily);
      if (!replacement) continue;
      next[lang] = { ...style, fontFamily: replacement.to };
      touched = true;
    }

    if (!touched) continue;
    update.run(JSON.stringify({ ...config, overridesByLang: next }), row.id);
    changed++;
  }

  return changed;
}

interface TemplateRow {
  id: number;
  name: string;
  kind: string;
  config: string;
  updated_at: string;
}

/** 저장된 JSON 이 깨져 있어도 목록 전체가 죽지 않아야 한다 */
function parseRow(row: TemplateRow): Template | null {
  try {
    const config = JSON.parse(row.config) as Template;
    return { ...config, id: row.id, name: row.name, kind: config.kind, isBuiltin: false };
  } catch {
    return null;
  }
}

export function listTemplates(): Template[] {
  const rows = getConnection()
    .prepare('SELECT * FROM templates ORDER BY id')
    .all() as unknown as TemplateRow[];

  const user = rows.map(parseRow).filter((t): t is Template => t !== null);
  // 프리셋을 먼저 보여준다 — 처음 쓰는 사람이 바로 고를 수 있게
  return [...BUILTIN_TEMPLATES, ...user];
}

export function getTemplate(id: number): Template | undefined {
  const builtin = getBuiltinTemplate(id);
  if (builtin) return builtin;

  const row = getConnection().prepare('SELECT * FROM templates WHERE id = ?').get(id) as
    | TemplateRow
    | undefined;
  return row ? (parseRow(row) ?? undefined) : undefined;
}

/**
 * 현재 선택된 템플릿을 돌려준다. 지워진 id 를 가리키고 있으면 기본 프리셋으로 되돌린다 —
 * 예배 중 템플릿이 없어서 화면이 비는 일이 없어야 한다.
 */
export function getTemplateOrDefault(id: number): Template {
  return getTemplate(id) ?? getBuiltinTemplate(DEFAULT_TEMPLATE_ID) ?? BUILTIN_TEMPLATES[0]!;
}

export function createTemplate(template: Omit<Template, 'id' | 'isBuiltin'>): Template {
  const now = new Date().toISOString();
  const result = getConnection()
    .prepare('INSERT INTO templates (name, kind, config, updated_at) VALUES (?, ?, ?, ?)')
    .run(template.name, template.kind, JSON.stringify(template), now);

  return { ...template, id: Number(result.lastInsertRowid), isBuiltin: false };
}

export class BuiltinTemplateError extends Error {
  constructor() {
    super('내장 프리셋은 수정할 수 없습니다. 복제한 뒤 편집하세요.');
    this.name = 'BuiltinTemplateError';
  }
}

export function updateTemplate(id: number, patch: Partial<Template>): Template {
  if (getBuiltinTemplate(id)) throw new BuiltinTemplateError();

  const existing = getTemplate(id);
  if (!existing) throw new Error(`템플릿을 찾을 수 없습니다: ${id}`);

  // 불변 패턴 — 기존 객체를 고치지 않고 새 객체를 만든다
  const next: Template = { ...existing, ...patch, id, isBuiltin: false };
  getConnection()
    .prepare('UPDATE templates SET name = ?, kind = ?, config = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.kind, JSON.stringify(next), new Date().toISOString(), id);

  return next;
}

export function deleteTemplate(id: number): void {
  if (getBuiltinTemplate(id)) throw new BuiltinTemplateError();
  getConnection().prepare('DELETE FROM templates WHERE id = ?').run(id);
}

/** 프리셋이든 사용자 템플릿이든 복제해 편집 가능한 사본을 만든다 */
export function duplicateTemplate(id: number, name?: string): Template {
  const source = getTemplate(id);
  if (!source) throw new Error(`템플릿을 찾을 수 없습니다: ${id}`);

  const { id: _ignored, isBuiltin: _builtin, ...rest } = source;
  return createTemplate({ ...rest, name: name ?? `${source.name} 사본` });
}
