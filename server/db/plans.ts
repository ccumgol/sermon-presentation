/**
 * 예배 순서 저장소 (app.sqlite).
 *
 * 항목(CueItem)만 저장한다 — 슬라이드를 미리 만들어 넣지 않는다.
 * 슬라이드는 불러올 때 컨트롤 패널이 실측 분할까지 거쳐 만들므로,
 * 템플릿을 바꿔도 순서표가 낡지 않는다.
 */

import type { CueItem, PlanDefaults, PlanKind, ServicePlan } from '../../shared/types.ts';
import { getConnection } from './app.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS service_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  service_date TEXT,
  items        TEXT NOT NULL,   -- JSON: CueItem[]
  updated_at   TEXT NOT NULL
);
`;

export function initPlanStore(): void {
  const conn = getConnection();
  conn.exec(SCHEMA);
  addKindColumn();
  addDefaultsColumn();
  seedDefaultTemplates();
}

/**
 * 기존 DB 에 유형 컬럼을 붙인다.
 *
 * 기본값 'plan'(저장된 순서)이 맞다 — 지금까지 만든 순서표는 모두 그때그때 만든
 * 회차이지, 반복해서 쓰는 유형 템플릿이 아니다.
 */
function addKindColumn(): void {
  const conn = getConnection();
  const names = new Set(
    (conn.prepare("SELECT name FROM pragma_table_info('service_plans')").all() as unknown as Array<{
      name: string;
    }>).map((column) => column.name),
  );
  if (!names.has('kind')) {
    conn.exec("ALTER TABLE service_plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan'");
  }
}

/**
 * 기본 설정 컬럼을 붙인다. 기존 순서표는 값이 없어 지금까지의 동작(항목이 스스로
 * 정함)을 그대로 유지한다.
 */
function addDefaultsColumn(): void {
  const conn = getConnection();
  const names = new Set(
    (conn.prepare("SELECT name FROM pragma_table_info('service_plans')").all() as unknown as Array<{
      name: string;
    }>).map((column) => column.name),
  );
  if (!names.has('defaults')) {
    conn.exec('ALTER TABLE service_plans ADD COLUMN defaults TEXT');
  }
}

interface PlanRow {
  id: number;
  name: string;
  service_date: string | null;
  items: string;
  updated_at: string;
  kind: string | null;
  defaults: string | null;
}

/** 저장된 JSON 이 깨져 있어도 목록 전체가 죽지 않아야 한다 */
function parseRow(row: PlanRow): ServicePlan {
  let items: CueItem[] = [];
  try {
    const parsed = JSON.parse(row.items);
    if (Array.isArray(parsed)) items = parsed as CueItem[];
  } catch {
    // 항목을 못 읽어도 순서표 자체는 남긴다 (이름으로 무엇이었는지 알 수 있게)
  }

  // 기본 설정이 깨져 있어도 순서표는 열려야 한다 — 없는 것으로 보고 넘어간다
  let defaults: PlanDefaults | undefined;
  try {
    if (row.defaults) defaults = JSON.parse(row.defaults) as PlanDefaults;
  } catch {
    defaults = undefined;
  }

  return {
    id: row.id,
    name: row.name,
    ...(row.service_date ? { serviceDate: row.service_date } : {}),
    items,
    updatedAt: row.updated_at,
    kind: row.kind === 'template' ? 'template' : 'plan',
    ...(defaults ? { defaults } : {}),
  };
}

/**
 * 순서표 목록.
 *
 * 유형은 **만든 순(id)** 으로 둔다 — 자주 쓰는 주일예배가 맨 위에 오고, 목록이
 * 늘 같은 자리에 있어야 손이 기억한다. 이름 순으로 두면 유형을 하나 더할 때마다
 * 기존 항목의 위치가 바뀐다(가나다 순이면 '부흥회'가 맨 위로 올라온다).
 *
 * 저장된 순서는 최근 것이 위로 온다 — 지난주 순서를 다시 여는 경우가 대부분이다.
 */
export function listPlans(kind?: PlanKind): ServicePlan[] {
  const conn = getConnection();
  const rows = (
    kind === 'template'
      ? conn.prepare("SELECT * FROM service_plans WHERE coalesce(kind, 'plan') = 'template' ORDER BY id").all()
      : kind === 'plan'
        ? conn
            .prepare(
              `SELECT * FROM service_plans WHERE coalesce(kind, 'plan') = 'plan'
               ORDER BY coalesce(service_date, updated_at) DESC, id DESC`,
            )
            .all()
        : conn
            .prepare('SELECT * FROM service_plans ORDER BY coalesce(service_date, updated_at) DESC, id DESC')
            .all()
  ) as unknown as PlanRow[];
  return rows.map(parseRow);
}

export function getPlan(id: number): ServicePlan | undefined {
  const row = getConnection().prepare('SELECT * FROM service_plans WHERE id = ?').get(id) as PlanRow | undefined;
  return row ? parseRow(row) : undefined;
}

export interface PlanInput {
  name: string;
  serviceDate?: string;
  items: CueItem[];
  kind?: PlanKind;
  defaults?: PlanDefaults;
}

export function createPlan(input: PlanInput): ServicePlan {
  const now = new Date().toISOString();
  const result = getConnection()
    .prepare(
      'INSERT INTO service_plans (name, service_date, items, updated_at, kind, defaults) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.name,
      input.serviceDate ?? null,
      JSON.stringify(input.items),
      now,
      input.kind ?? 'plan',
      input.defaults ? JSON.stringify(input.defaults) : null,
    );

  return getPlan(Number(result.lastInsertRowid))!;
}

export function updatePlan(id: number, patch: Partial<PlanInput>): ServicePlan {
  const existing = getPlan(id);
  if (!existing) throw new Error(`예배 순서를 찾을 수 없습니다: ${id}`);

  // 불변 패턴 — 기존 객체를 고치지 않고 새 값을 만든다
  const next = {
    name: patch.name ?? existing.name,
    serviceDate: patch.serviceDate ?? existing.serviceDate,
    items: patch.items ?? existing.items,
    kind: patch.kind ?? existing.kind ?? 'plan',
    // '키가 왔는지'로 판단한다. ?? 로 두면 undefined 를 보내 **지우는** 것과
    // 아예 안 보내는 것을 구별할 수 없어 기본 설정을 지울 방법이 없어진다.
    defaults: 'defaults' in patch ? patch.defaults : existing.defaults,
  };

  getConnection()
    .prepare(
      'UPDATE service_plans SET name = ?, service_date = ?, items = ?, updated_at = ?, kind = ?, defaults = ? WHERE id = ?',
    )
    .run(
      next.name,
      next.serviceDate ?? null,
      JSON.stringify(next.items),
      new Date().toISOString(),
      next.kind,
      next.defaults ? JSON.stringify(next.defaults) : null,
      id,
    );

  return getPlan(id)!;
}

export function deletePlan(id: number): void {
  getConnection().prepare('DELETE FROM service_plans WHERE id = ?').run(id);
}

export function duplicatePlan(id: number, name?: string): ServicePlan {
  const source = getPlan(id);
  if (!source) throw new Error(`예배 순서를 찾을 수 없습니다: ${id}`);

  return createPlan({
    name: name ?? `${source.name} 사본`,
    ...(source.serviceDate ? { serviceDate: source.serviceDate } : {}),
    // 항목 id 는 새로 발급한다 — 사본에서 같은 id 를 쓰면 재배치가 꼬인다
    items: source.items.map((item) => ({ ...item, id: newItemId() })),
    kind: source.kind ?? 'plan',
    ...(source.defaults ? { defaults: source.defaults } : {}),
  });
}

/**
 * 예배 유형 템플릿의 기본값.
 *
 * 예배 순서는 **날짜별로 새로 만드는 것이 아니라, 유형을 두고 매주 고쳐 쓰는 것**이
 * 실제 운영 방식이다(2026-08-15 사용자 결정). 그래서 빈 목록 대신 유형 넷을 미리 둔다.
 *
 * 여기 담긴 순서는 **출발점일 뿐** 교회마다 다르다 — 한 줄씩 지우거나 더하면 된다.
 * 구분(divider)은 화면에 나가지 않는 머리글이고, 순서 표시(order)는 화면에 나간다.
 */
const DEFAULT_TEMPLATES: ReadonlyArray<{ name: string; entries: ReadonlyArray<[string, string]> }> = [
  {
    name: '주일예배',
    entries: [
      ['divider', '예배 부름'],
      ['order', '예배 부름'],
      ['order', '대표기도'],
      ['divider', '찬양'],
      ['divider', '말씀'],
      ['order', '성경 봉독'],
      ['order', '설교 제목'],
      ['divider', '마침'],
      ['order', '봉헌'],
      ['order', '광고'],
      ['order', '축도'],
    ],
  },
  {
    name: '수요예배',
    entries: [
      ['divider', '찬양'],
      ['order', '대표기도'],
      ['divider', '말씀'],
      ['order', '성경 봉독'],
      ['order', '설교 제목'],
      ['order', '축도'],
    ],
  },
  {
    name: '새벽기도회',
    entries: [
      ['divider', '말씀'],
      ['order', '성경 봉독'],
      ['order', '설교 제목'],
      ['order', '합심기도'],
    ],
  },
  {
    name: '부흥회',
    entries: [
      ['divider', '찬양'],
      ['order', '대표기도'],
      ['divider', '말씀'],
      ['order', '성경 봉독'],
      ['order', '설교 제목'],
      ['divider', '결단'],
      ['order', '축도'],
    ],
  },
];

/**
 * 유형 템플릿이 하나도 없을 때만 기본값을 넣는다.
 *
 * 이미 유형을 만들어 둔 사용자의 목록에 매번 기본값이 되살아나면 안 되므로,
 * '비어 있을 때 한 번'이 유일한 조건이다. 지운 유형이 되살아나지 않게 하려면
 * 하나만 남겨 두면 된다.
 */
export function seedDefaultTemplates(): void {
  if (countPlans('template') > 0) return;

  for (const template of DEFAULT_TEMPLATES) {
    createPlan({
      name: template.name,
      kind: 'template',
      items: template.entries.map(([type, label]) =>
        type === 'divider'
          ? { id: newItemId(), type: 'divider' as const, label }
          : { id: newItemId(), type: 'text' as const, content: label, variant: 'order' as const },
      ),
    });
  }
}

let itemCounter = 0;

/**
 * 항목 id 발급. `Date.now()` 와 무작위를 쓰지 않고 카운터를 쓴다 —
 * 같은 밀리초에 여러 항목을 만들어도 겹치지 않고, 테스트에서 결과가 재현된다.
 */
export function newItemId(): string {
  itemCounter += 1;
  return `item-${itemCounter.toString(36)}-${process.pid.toString(36)}`;
}

export function countPlans(kind?: PlanKind): number {
  const conn = getConnection();
  const row = kind
    ? (conn
        .prepare("SELECT count(*) AS c FROM service_plans WHERE coalesce(kind, 'plan') = ?")
        .get(kind) as { c: number })
    : (conn.prepare('SELECT count(*) AS c FROM service_plans').get() as { c: number });
  return row.c;
}
