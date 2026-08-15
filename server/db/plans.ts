/**
 * 예배 순서 저장소 (app.sqlite).
 *
 * 항목(CueItem)만 저장한다 — 슬라이드를 미리 만들어 넣지 않는다.
 * 슬라이드는 불러올 때 컨트롤 패널이 실측 분할까지 거쳐 만들므로,
 * 템플릿을 바꿔도 순서표가 낡지 않는다.
 */

import type { CueItem, ServicePlan } from '../../shared/types.ts';
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
  getConnection().exec(SCHEMA);
}

interface PlanRow {
  id: number;
  name: string;
  service_date: string | null;
  items: string;
  updated_at: string;
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

  return {
    id: row.id,
    name: row.name,
    ...(row.service_date ? { serviceDate: row.service_date } : {}),
    items,
    updatedAt: row.updated_at,
  };
}

export function listPlans(): ServicePlan[] {
  const rows = getConnection()
    .prepare('SELECT * FROM service_plans ORDER BY coalesce(service_date, updated_at) DESC, id DESC')
    .all() as unknown as PlanRow[];
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
}

export function createPlan(input: PlanInput): ServicePlan {
  const now = new Date().toISOString();
  const result = getConnection()
    .prepare('INSERT INTO service_plans (name, service_date, items, updated_at) VALUES (?, ?, ?, ?)')
    .run(input.name, input.serviceDate ?? null, JSON.stringify(input.items), now);

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
  };

  getConnection()
    .prepare('UPDATE service_plans SET name = ?, service_date = ?, items = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.serviceDate ?? null, JSON.stringify(next.items), new Date().toISOString(), id);

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
  });
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

export function countPlans(): number {
  return (getConnection().prepare('SELECT count(*) AS c FROM service_plans').get() as { c: number }).c;
}
