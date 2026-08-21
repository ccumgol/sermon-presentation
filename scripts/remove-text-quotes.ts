/**
 * 옛 자유 글자 인용구를 순서표에서 지운다.
 *
 * ```
 * node scripts/remove-text-quotes.ts            # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/remove-text-quotes.ts --apply    # 실제로 지운다
 * ```
 *
 * ## 왜
 *
 * 2026-08-20 에 '인용구' 가 자유 글자에서 **성경 절**로 바뀌었다 (광고와 기능이 겹쳤다).
 * 옛 항목은 그대로 두어도 광고처럼 글자가 나가므로 망가지지 않는다. 다만 사용자가
 * 갖고 있던 한 건은 내용이 `창 3:15` — **참조를 인용구로 쓰려던 것**이라 글자 그대로
 * 화면에 나갔다. 사용자가 지우기로 결정했다.
 *
 * ## 사용자 데이터다
 *
 * 미리보기가 기본이고, `--apply` 는 스냅샷을 먼저 뜬다. 무엇을 지우는지 **내용까지
 * 보여 준 뒤** 지운다 — 순서표에서 사라진 한 줄은 예배 중에야 눈에 띈다.
 */

import { existsSync } from 'node:fs';

import { initPlanStore, listPlans, updatePlan } from '../server/db/plans.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import type { CueItem } from '../shared/types.ts';

/** 옛 자유 글자 인용구인가 — 새 인용구는 `type: 'bible'` 이다 */
function isLegacyQuote(item: CueItem): boolean {
  return item.type === 'text' && item.variant === 'quote';
}

function main(): void {
  const apply = process.argv.includes('--apply');
  initPlanStore();

  const plans = listPlans();
  const hits: Array<{ plan: string; content: string }> = [];
  const changed: Array<{ id: number; name: string; items: CueItem[] }> = [];

  for (const plan of plans) {
    const kept = plan.items.filter((item) => !isLegacyQuote(item));
    if (kept.length === plan.items.length) continue;

    for (const item of plan.items) {
      if (isLegacyQuote(item) && item.type === 'text') {
        hits.push({ plan: plan.name, content: item.content });
      }
    }
    changed.push({ id: plan.id, name: plan.name, items: kept });
  }

  console.log(`순서표 ${plans.length}개를 살펴봤습니다.`);
  if (hits.length === 0) {
    console.log('옛 자유 글자 인용구가 없습니다. 할 일이 없습니다.');
    return;
  }

  console.log(`\n지울 항목 ${hits.length}개:`);
  for (const hit of hits) {
    console.log(`  [${hit.plan}] ${JSON.stringify(hit.content)}`);
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 지우려면 --apply 를 붙이세요.');
    return;
  }

  const snapshot = snapshotDatabases('before-remove-text-quotes');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  for (const plan of changed) {
    updatePlan(plan.id, { items: plan.items });
    console.log(`  ${plan.name}: 항목 ${plan.items.length}개로 저장했습니다`);
  }

  // 되살려 대조한다 — 저장이 잘못되면 그 주에 알게 된다
  const after = listPlans().reduce(
    (sum, plan) => sum + plan.items.filter(isLegacyQuote).length,
    0,
  );
  console.log(after === 0 ? '\n확인: 남은 옛 인용구가 없습니다' : `\n⚠ 아직 ${after}개가 남아 있습니다`);
}

if (!existsSync('data')) {
  console.error('data 폴더가 없습니다. 저장소 뿌리에서 실행하세요.');
  process.exit(1);
}
main();
