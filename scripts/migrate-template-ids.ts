/**
 * 템플릿 정리에 따른 참조 이관 — `app.sqlite`
 *
 * ```
 * node scripts/migrate-template-ids.ts                     # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/migrate-template-ids.ts --apply             # 실제로 옮긴다
 * node scripts/migrate-template-ids.ts --delete-copies             # 지울 수 있는 사본 보기
 * node scripts/migrate-template-ids.ts --delete-copies --ids 2,4,5 --apply
 * ```
 *
 * ## 무엇을 옮기는가
 *
 * 프리셋을 8개로 정리하면서 두 가지가 생겼다.
 *
 * 1. **사용자 사본 `id 3` 이 프리셋 `-1`(하단)이 됐다.** 그 값이 코드로 들어갔으므로
 *    사본을 가리키던 참조를 프리셋으로 옮긴다. 옮기지 않으면 사본을 지웠을 때
 *    순서표가 템플릿을 잃는다.
 * 2. **`-2`·`-4`·`-5` 프리셋이 없어졌다.** 가리키는 것이 있으면 `-1` 로 옮긴다.
 *    (실측으로는 하나도 없지만, 이 스크립트가 다른 PC 에서도 돌 수 있다.)
 *
 * 옮길 곳은 세 군데다 — 순서표 항목, 예배 기본 설정, 저장된 송출 상태.
 *
 * ## 백업
 *
 * `--apply` 는 쓰기 전에 `snapshotDatabases()` 로 스냅샷을 뜬다. 뜨지 못하면 던져서
 * **아무것도 고치지 않고 멈춘다.** 백업 없이 순서표를 고치는 것이 가장 큰 위험이다.
 *
 * ## 왜 미리보기가 기본인가
 *
 * 순서표를 고치는 작업이다. 잘못 옮기면 예배 중 항목이 엉뚱한 모양으로 나가고,
 * 그때는 되돌릴 시간이 없다. 무엇이 바뀔지 눈으로 본 뒤에 `--apply` 를 붙인다.
 *
 * ## 사본 지우기는 따로다 (`--delete-copies`)
 *
 * 옮기기와 지우기를 한 번에 하지 않는다. 옮긴 결과를 화면에서 확인한 **뒤에** 지워야
 * 잘못됐을 때 대조할 근거가 남는다.
 *
 * **아직 참조되는 사본은 지우지 않는다.** 순서표가 가리키는 사본을 지우면 그 항목이
 * 템플릿을 잃고 예배 중 엉뚱한 모양으로 나간다. 참조가 남아 있으면 어느 순서표가
 * 가리키는지 알려 주고 멈춘다.
 *
 * 그리고 **지울 id 를 반드시 적어야 한다**(`--ids`). '쓰이지 않는 것 전부' 로 두면
 * 사람이 남기려고 둔 것까지 함께 사라진다 — 옮긴 결과를 대조할 근거가 그런 것이다.
 */

import { DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '../lib/template-presets.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import { getConnection, initAppDb } from '../server/db/app.ts';

/** 옛 id → 새 id. 사용자 사본 3 이 하단 프리셋이 됐다 */
const MOVES = new Map<number, number>([
  [3, -1], // '설교본문 — 단일 역본 사본' → 하단 프리셋 (값이 코드로 들어갔다)
  [-2, -1], // 없어진 '설교본문 — 이중 역본' → 하단
  [-4, -1], // 없어진 '찬양 — 이중 언어' → 하단
  [-5, -1], // 없어진 '찬양 — 단일 언어' → 하단
]);

interface Change {
  where: string;
  from: number;
  to: number;
}

function movedTo(id: unknown): number | undefined {
  return typeof id === 'number' ? MOVES.get(id) : undefined;
}

/** 순서표 항목과 기본 설정의 templateId 를 옮긴 새 JSON 을 만든다 */
function migratePlan(row: { id: number; name: string; items: string; defaults: string | null }): {
  items?: string;
  defaults?: string;
  changes: Change[];
} {
  const changes: Change[] = [];

  const items = JSON.parse(row.items) as Array<Record<string, unknown>>;
  const nextItems = items.map((item, index) => {
    const to = movedTo(item.templateId);
    if (to === undefined) return item;
    changes.push({
      where: `순서 '${row.name}' 항목 ${index + 1}`,
      from: item.templateId as number,
      to,
    });
    return { ...item, templateId: to };
  });

  let nextDefaults: string | undefined;
  if (row.defaults) {
    const defaults = JSON.parse(row.defaults) as { templates?: Record<string, number> };
    const templates = defaults.templates;
    if (templates) {
      const next: Record<string, number> = { ...templates };
      let touched = false;
      for (const [slot, id] of Object.entries(templates)) {
        const to = movedTo(id);
        if (to === undefined) continue;
        next[slot] = to;
        touched = true;
        changes.push({ where: `순서 '${row.name}' 기본 설정 ${slot}`, from: id, to });
      }
      if (touched) nextDefaults = JSON.stringify({ ...defaults, templates: next });
    }
  }

  return {
    ...(changes.some((c) => c.where.includes('항목')) ? { items: JSON.stringify(nextItems) } : {}),
    ...(nextDefaults !== undefined ? { defaults: nextDefaults } : {}),
    changes,
  };
}

function main(): void {
  const apply = process.argv.includes('--apply');

  if (process.argv.includes('--delete-copies')) {
    const raw = process.argv[process.argv.indexOf('--ids') + 1];
    const only =
      process.argv.includes('--ids') && raw !== undefined
        ? raw
            .split(',')
            .map((part) => Number(part.trim()))
            .filter((id) => Number.isInteger(id))
        : undefined;
    deleteCopies(apply, only);
    return;
  }

  initAppDb();
  const conn = getConnection();

  // 옮길 곳이 실제로 존재하는지 먼저 본다 — 없는 id 로 옮기면 화면이 빈다
  for (const to of new Set(MOVES.values())) {
    if (!getBuiltinTemplate(to)) {
      console.error(`옮길 대상 프리셋 ${to} 이 코드에 없습니다. 프리셋 정의를 먼저 확인하세요.`);
      process.exit(1);
    }
  }

  const changes: Change[] = [];
  const planUpdates: Array<{ id: number; items?: string; defaults?: string }> = [];

  const plans = conn
    .prepare('SELECT id, name, items, defaults FROM service_plans ORDER BY id')
    .all() as unknown as Array<{ id: number; name: string; items: string; defaults: string | null }>;

  for (const row of plans) {
    const result = migratePlan(row);
    changes.push(...result.changes);
    if (result.items !== undefined || result.defaults !== undefined) {
      planUpdates.push({ id: row.id, ...(result.items !== undefined ? { items: result.items } : {}), ...(result.defaults !== undefined ? { defaults: result.defaults } : {}) });
    }
  }

  // 저장된 송출 상태 — 서버를 다시 켰을 때 이 값으로 시작한다
  const live = conn.prepare("SELECT value FROM settings WHERE key = 'live_state'").get() as
    | { value: string }
    | undefined;
  let nextLive: string | undefined;
  if (live) {
    const parsed = JSON.parse(live.value) as { state?: { templateId?: number } };
    const to = movedTo(parsed.state?.templateId);
    if (to !== undefined) {
      changes.push({ where: '저장된 송출 상태', from: parsed.state!.templateId!, to });
      nextLive = JSON.stringify({ ...parsed, state: { ...parsed.state, templateId: to } });
    }
  }

  console.log(`옮길 규칙: ${[...MOVES].map(([from, to]) => `${from} → ${to}`).join(' · ')}`);
  console.log(`기본 프리셋: ${DEFAULT_TEMPLATE_ID}\n`);

  if (changes.length === 0) {
    console.log('옮길 것이 없습니다 (이미 옮겼거나 참조가 없습니다).');
    return;
  }

  console.log(`바뀔 것 ${changes.length}곳:`);
  for (const change of changes) console.log(`  ${change.where}: ${change.from} → ${change.to}`);

  // 남는 사본을 알려 준다 — 지우는 것은 사람이 확인한 뒤에 할 일이다
  const leftovers = conn.prepare('SELECT id, name FROM templates ORDER BY id').all() as unknown as Array<{
    id: number;
    name: string;
  }>;
  if (leftovers.length > 0) {
    console.log('\n남아 있는 사용자 템플릿 (이 스크립트는 지우지 않습니다):');
    for (const row of leftovers) console.log(`  id ${row.id} · ${row.name}`);
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 옮기려면 --apply 를 붙이세요.');
    return;
  }

  // 되돌릴 수 없는 작업이다 — 쓰기 전에 스냅샷을 뜬다 (CLAUDE.md '데이터를 바꿀 때').
  // 실패하면 던진다: 백업 없이 순서표를 고치는 것이 바로 이 규칙이 막으려는 위험이다.
  const snapshot = snapshotDatabases('before-migrate-template-ids');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  const updateItems = conn.prepare('UPDATE service_plans SET items = ? WHERE id = ?');
  const updateBoth = conn.prepare('UPDATE service_plans SET items = ?, defaults = ? WHERE id = ?');
  const updateDefaults = conn.prepare('UPDATE service_plans SET defaults = ? WHERE id = ?');
  const updateLive = conn.prepare("UPDATE settings SET value = ? WHERE key = 'live_state'");

  // 한 트랜잭션으로 — 중간에 멈추면 절반만 옮겨진 순서표가 남는다
  conn.exec('BEGIN');
  try {
    for (const update of planUpdates) {
      if (update.items !== undefined && update.defaults !== undefined) {
        updateBoth.run(update.items, update.defaults, update.id);
      } else if (update.items !== undefined) {
        updateItems.run(update.items, update.id);
      } else if (update.defaults !== undefined) {
        updateDefaults.run(update.defaults, update.id);
      }
    }
    if (nextLive !== undefined) updateLive.run(nextLive);
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    console.error('옮기지 못했습니다 (되돌렸습니다):', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`\n옮겼습니다: ${changes.length}곳`);

  // 되살려 대조한다 — 옮기다 놓친 것이 있으면 예배 중에 알게 된다
  const after = conn
    .prepare('SELECT items, defaults FROM service_plans')
    .all() as unknown as Array<{ items: string; defaults: string | null }>;
  const stale = after.filter((row) =>
    [...MOVES.keys()].some(
      (old) => row.items.includes(`"templateId":${old}`) || (row.defaults ?? '').includes(`:${old}`),
    ),
  );
  console.log(stale.length === 0 ? '확인: 옛 id 를 가리키는 순서표가 없습니다' : `⚠ 아직 ${stale.length}개가 옛 id 를 가리킵니다`);
}

/**
 * 쓰이지 않는 사용자 사본을 지운다.
 *
 * **참조가 남아 있으면 지우지 않는다.** 순서표가 가리키는 사본을 지우면 그 항목이
 * 템플릿을 잃는다. 어느 순서표가 가리키는지 알려 주고 멈추는 편이 낫다.
 */
function deleteCopies(apply: boolean, only: readonly number[] | undefined): void {
  initAppDb();
  const conn = getConnection();

  const copies = conn.prepare('SELECT id, name FROM templates ORDER BY id').all() as unknown as Array<{
    id: number;
    name: string;
  }>;
  if (copies.length === 0) {
    console.log('사용자 사본이 없습니다.');
    return;
  }

  const plans = conn.prepare('SELECT name, items, defaults FROM service_plans').all() as unknown as Array<{
    name: string;
    items: string;
    defaults: string | null;
  }>;
  const live = conn.prepare("SELECT value FROM settings WHERE key = 'live_state'").get() as
    | { value: string }
    | undefined;

  /** 이 사본을 가리키는 곳 — 있으면 지우지 않는다 */
  function referencedBy(id: number): string[] {
    const hits: string[] = [];
    for (const plan of plans) {
      const items = JSON.parse(plan.items) as Array<{ templateId?: number }>;
      if (items.some((item) => item.templateId === id)) hits.push(`순서 '${plan.name}' 항목`);
      const defaults = plan.defaults
        ? (JSON.parse(plan.defaults) as { templates?: Record<string, number> }).templates
        : undefined;
      if (defaults && Object.values(defaults).includes(id)) hits.push(`순서 '${plan.name}' 기본 설정`);
    }
    if (live) {
      const parsed = JSON.parse(live.value) as { state?: { templateId?: number } };
      if (parsed.state?.templateId === id) hits.push('저장된 송출 상태');
    }
    return hits;
  }

  const removable: typeof copies = [];
  console.log('사용자 사본:');
  for (const copy of copies) {
    const refs = referencedBy(copy.id);
    if (refs.length === 0) {
      removable.push(copy);
      console.log(`  id ${copy.id} · ${copy.name} — 쓰이지 않음 (지울 수 있다)`);
    } else {
      console.log(`  id ${copy.id} · ${copy.name} — ⚠ 아직 쓰인다: ${refs.join(', ')}`);
    }
  }

  if (removable.length === 0) {
    console.log('\n지울 수 있는 사본이 없습니다.');
    return;
  }

  if (only === undefined) {
    console.log(
      `\n지울 id 를 적으세요: --ids ${removable.map((c) => c.id).join(',')}` +
        '\n(남기려고 둔 사본이 함께 사라지지 않게, 전부 지우기는 하지 않습니다)',
    );
    return;
  }

  const target = removable.filter((copy) => only.includes(copy.id));
  const notRemovable = only.filter((id) => !removable.some((copy) => copy.id === id));
  if (notRemovable.length > 0) {
    console.log(`\n⚠ 적어 주신 id 중 지울 수 없는 것: ${notRemovable.join(', ')} (없거나 아직 쓰입니다)`);
  }
  if (target.length === 0) {
    console.log('\n지울 것이 없습니다.');
    return;
  }

  console.log(`\n지울 것: ${target.map((c) => `id ${c.id} '${c.name}'`).join(' · ')}`);
  if (!apply) {
    console.log('미리보기입니다. 실제로 지우려면 --apply 를 붙이세요.');
    return;
  }

  // 되돌릴 수 없는 작업이다 — 쓰기 전에 스냅샷을 뜬다 (CLAUDE.md '데이터를 바꿀 때').
  // 실패하면 던진다: 백업 없이 순서표를 고치는 것이 바로 이 규칙이 막으려는 위험이다.
  const snapshot = snapshotDatabases('before-delete-template-copies');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  const remove = conn.prepare('DELETE FROM templates WHERE id = ?');
  conn.exec('BEGIN');
  try {
    for (const copy of target) remove.run(copy.id);
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    console.error('지우지 못했습니다 (되돌렸습니다):', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const left = conn.prepare('SELECT id, name FROM templates ORDER BY id').all() as unknown as Array<{
    id: number;
    name: string;
  }>;
  console.log(`\n지웠습니다: ${target.length}개`);
  console.log(left.length === 0 ? '남은 사본 없음' : `남은 사본: ${left.map((c) => `id ${c.id} '${c.name}'`).join(' · ')}`);
}

main();
