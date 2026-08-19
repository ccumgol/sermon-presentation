/**
 * 템플릿 저장소 (app.sqlite).
 *
 * 프리셋 id 는 음수, 사용자 템플릿은 1부터라 절대 충돌하지 않는다.
 *
 * ## 프리셋 덮어쓰기 (2026-08-19)
 *
 * 전에는 프리셋을 고칠 수 없어(409) 템플릿 탭이 저장할 때 **강제로 복제**했다.
 * 그래서 사용자 사본이 넷 쌓이고 같은 이름이 둘이라 목록에서 구분도 안 됐다.
 *
 * 이제 프리셋 id 로도 행을 쓸 수 있고, 조회는 **DB 먼저 → 코드 대체** 순서다.
 *
 * - **덮어쓰기** = 프리셋 id 로 행을 쓴다
 * - **원본 불러오기**(`restoreBuiltin`) = 그 행을 지운다 → 코드 상수가 다시 보인다
 *
 * **코드가 곧 원본이다.** '원본' 을 따로 저장할 필요가 없고, 백업이 날아가거나 DB 가
 * 깨져도 프리셋은 언제나 되살아난다. 기준점이 사라지지 않는다는 원래의 목적은 그대로다.
 *
 * 프리셋에 `deleteTemplate` 는 여전히 거부한다 — 코드에 있는 것을 '지운다' 는 말이
 * 성립하지 않는다. 되돌리기와 지우기를 같은 동사에 담으면 잘못 눌렀을 때 무엇이
 * 일어날지 알 수 없다.
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

/**
 * 저장된 JSON 이 깨져 있어도 목록 전체가 죽지 않아야 한다.
 *
 * 프리셋 id 의 행은 **덮어쓴 프리셋**이다. `isBuiltin` 을 유지해 목록에서 프리셋
 * 자리에 그대로 두고, `isOverridden` 으로 원본과 다르다는 것을 알린다 —
 * 그것을 모르면 되돌릴 생각을 못 한다.
 */
function parseRow(row: TemplateRow): Template | null {
  try {
    const config = JSON.parse(row.config) as Template;
    const builtin = getBuiltinTemplate(row.id) !== undefined;
    return {
      ...config,
      id: row.id,
      name: row.name,
      kind: config.kind,
      isBuiltin: builtin,
      ...(builtin ? { isOverridden: true } : {}),
    };
  } catch {
    return null;
  }
}

export function listTemplates(): Template[] {
  const rows = getConnection()
    .prepare('SELECT * FROM templates ORDER BY id')
    .all() as unknown as TemplateRow[];

  const parsed = rows.map(parseRow).filter((t): t is Template => t !== null);
  const overrides = new Map(parsed.filter((t) => t.isBuiltin).map((t) => [t.id, t]));

  /*
   * 프리셋을 먼저, **코드에 적힌 순서 그대로** 보여준다. 덮어쓴 것은 그 자리에 끼운다.
   * 덮어쓰기가 목록 끝으로 밀려나면 매주 쓰는 템플릿을 찾아 스크롤하게 된다.
   */
  const presets = BUILTIN_TEMPLATES.map((preset) => overrides.get(preset.id) ?? preset);
  const user = parsed.filter((t) => !t.isBuiltin);
  return [...presets, ...user];
}

export function getTemplate(id: number): Template | undefined {
  // **DB 를 먼저 본다.** 프리셋 id 에 행이 있으면 그것이 덮어쓴 값이다
  const row = getConnection().prepare('SELECT * FROM templates WHERE id = ?').get(id) as
    | TemplateRow
    | undefined;
  if (row) {
    const parsed = parseRow(row);
    // JSON 이 깨졌으면 프리셋으로 떨어진다 — 화면이 비는 것보다 낫다
    if (parsed) return parsed;
  }
  return getBuiltinTemplate(id);
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

/**
 * 프리셋에 '지우기' 를 시도했을 때.
 *
 * 프리셋은 코드에 있으므로 지운다는 말이 성립하지 않는다. 되돌리기는 다른 동작
 * (`restoreBuiltin`)이므로, 무엇을 눌러야 하는지 문구에 담는다.
 */
export class BuiltinTemplateError extends Error {
  constructor() {
    super('내장 프리셋은 지울 수 없습니다. 코드의 값으로 되돌리려면 원본 불러오기를 쓰세요.');
    this.name = 'BuiltinTemplateError';
  }
}

/** 되돌릴 원본이 없는 것(사용자 템플릿)에 '원본 불러오기' 를 시도했을 때 */
export class NotAPresetError extends Error {
  constructor() {
    super('프리셋이 아니라 되돌릴 원본이 없습니다. 지우려면 삭제를 쓰세요.');
    this.name = 'NotAPresetError';
  }
}

/**
 * 템플릿을 고친다. **프리셋도 고칠 수 있다** — 그 id 로 행을 쓰면 덮어쓰기가 된다.
 *
 * 프리셋에 행이 없으면 `INSERT`(덮어쓰기 시작), 있으면 `UPDATE` 다. 사용자 템플릿은
 * 늘 `UPDATE` 다. 둘을 `INSERT OR REPLACE` 하나로 합치지 않는 이유는, 없는 사용자
 * id 에 쓰면 **조용히 새 템플릿이 생기기** 때문이다. 없으면 오류여야 한다.
 */
export function updateTemplate(id: number, patch: Partial<Template>): Template {
  const existing = getTemplate(id);
  if (!existing) throw new Error(`템플릿을 찾을 수 없습니다: ${id}`);

  const isPreset = getBuiltinTemplate(id) !== undefined;

  // 불변 패턴 — 기존 객체를 고치지 않고 새 객체를 만든다
  const next: Template = {
    ...existing,
    ...patch,
    id,
    isBuiltin: isPreset,
    ...(isPreset ? { isOverridden: true } : {}),
  };

  const now = new Date().toISOString();
  const conn = getConnection();
  const changed = conn
    .prepare('UPDATE templates SET name = ?, kind = ?, config = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.kind, JSON.stringify(next), now, id);

  if (changed.changes === 0) {
    if (!isPreset) throw new Error(`템플릿을 찾을 수 없습니다: ${id}`);
    // 프리셋을 처음 덮어쓴다 — id 를 못박아 넣는다 (AUTOINCREMENT 는 건드리지 않는다)
    conn
      .prepare('INSERT INTO templates (id, name, kind, config, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, next.name, next.kind, JSON.stringify(next), now);
  }

  return next;
}

/**
 * 프리셋을 코드의 값으로 되돌린다 — **덮어쓴 행을 지운다.**
 *
 * 덮어쓴 적이 없으면 아무 일도 하지 않고 프리셋을 돌려준다. 오류로 만들지 않는 이유는
 * **결과가 같기** 때문이다 — 되돌리기를 두 번 눌렀다고 실패라고 말할 이유가 없다.
 */
export function restoreBuiltin(id: number): Template {
  const builtin = getBuiltinTemplate(id);
  if (!builtin) throw new NotAPresetError();

  getConnection().prepare('DELETE FROM templates WHERE id = ?').run(id);
  return builtin;
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
