/**
 * 슬라이드 ↔ 악보 단(staff system) 맞추기.
 *
 * 지금 부르는 슬라이드에 맞춰 악보의 어느 단을 보여 줄지 정한다.
 *
 * ## 왜 정확히 맞출 수 없는가 — 먼저 알아 둘 것
 *
 * **DB 의 줄 나눔과 악보의 단 나눔은 서로 다른 기준이다.** 가사는 글 자료에서 왔고
 * 악보의 단은 인쇄 사정으로 끊겼다. 실측(찬미예수 2000 2,061곡, 2026-09-04):
 *
 * - 섹션이 하나인 곡 **957곡(46%)** — 절이 하나뿐이라 헷갈릴 것이 없다.
 * - 여러 섹션 1,104곡 중
 *   - 절이 단을 **나눠 씀**(1·2절이 한 단에 겹쳐 적힘) 595곡 (53.9%)
 *   - 절이 **이어 적힘**(1절 다음에 2절) 239곡 (21.6%)
 *   - **어느 쪽도 아님 270곡 (24.5%)** — 예: 3절×3줄인데 단이 6개다.
 *     DB 줄 하나가 악보 두 단에 걸치는 것으로 보인다.
 *
 * 그래서 이 파일이 하는 일은 **정확한 대응이 아니라 비례 배분**이다. 사용자 결정
 * (2026-09-04): 자동으로 배분하고, 어긋나는 곡은 나중에 손으로 고친다.
 *
 * ## 얼마나 믿을 수 있나 — 실측
 *
 * 악보가 있는 2,061곡에서 '짐작한 모양의 한 번 지나가는 줄 수' 와 단 수를 견줬다:
 *
 * - **1,525곡 (74.0%)** 두 값이 맞는다 → 배분이 믿을 만하다.
 * - **536곡 (26.0%)** 어긋난다 → 배분이 흔들릴 수 있다. 화면이 이를 알려야 한다.
 *
 * 눈으로 확인한 것: 7번(단 4 · 1·2절이 겹쳐 적힘)과 11번(단 8 · 이어 적힘)은 정확히
 * 맞았다. 1000번은 어긋났는데 **DB 쪽 문제**다 — 1·2절이 한 섹션 16줄로 합쳐져 있어
 * 절 경계를 알 수 없다.
 *
 * ## 배분 방식
 *
 * 1. **모양을 짐작한다** — 절이 단을 나눠 쓰는가, 이어 적혔는가.
 * 2. 그 모양대로 섹션마다 쓸 단 범위를 준다.
 * 3. 섹션 안에서 슬라이드를 그 범위에 **비례로** 흩는다.
 *
 * 짐작이 틀릴 수 있으므로 `SheetLayout` 은 곡마다 저장해 두고 바꿀 수 있어야 한다 —
 * 이 함수들은 모양을 **인자로 받는다**.
 */

/** 악보에 절이 어떻게 적혀 있는가 */
export type SheetLayout =
  /** 절이 단을 나눠 쓴다 — 한 단 아래 1절·2절 가사가 겹쳐 적혀 있다 */
  | 'shared'
  /** 절이 이어 적혀 있다 — 1절이 끝나야 2절이 시작한다 */
  | 'sequential';

/**
 * 짐작이 어긋난 정도를 재는 여유. 줄 수의 25% 안이면 맞는 것으로 본다.
 *
 * 딱 맞기를 요구할 수 없다: 후렴이 한 번만 적히거나 도돌이표로 줄어드는 등
 * 악보가 줄 수를 그대로 따르지 않는 경우가 흔하다.
 */
const TOLERANCE = 0.25;

/**
 * 섹션별 줄 수와 단 수로 **악보의 모양을 짐작한다.**
 *
 * 판단 근거는 하나다: 단 수가 **한 절의 줄 수**에 가까우면 절이 겹쳐 적힌 것이고,
 * **모든 절을 합한 줄 수**에 가까우면 이어 적힌 것이다.
 *
 * 둘 다 아니면 `'shared'` 로 떨어뜨린다. 왜 그쪽이 안전한가: 이어 적힌 악보를
 * `'shared'` 로 보면 **모든 절이 같은 단을 가리켜** 뒷절에서 가사가 어긋나지만
 * 가락은 맞다. 반대로 겹쳐 적힌 악보를 `'sequential'` 로 보면 2절이 **악보 밖**을
 * 가리켜 아무것도 못 보여 준다.
 */
export function guessLayout(sectionLines: readonly number[], systemCount: number): SheetLayout {
  if (sectionLines.length <= 1 || systemCount <= 0) return 'shared';

  const total = sectionLines.reduce((sum, lines) => sum + lines, 0);
  const perSection = Math.max(...sectionLines);
  if (total <= 0 || perSection <= 0) return 'shared';

  const offShared = Math.abs(systemCount - perSection);
  const offSequential = Math.abs(systemCount - total);

  if (offSequential < offShared && offSequential <= Math.max(1, total * TOLERANCE)) return 'sequential';
  return 'shared';
}

/** 한 섹션이 쓸 단 범위 (끝은 포함하지 않는다) */
export interface SystemRange {
  from: number;
  to: number;
}

/**
 * 섹션마다 쓸 단 범위를 나눈다.
 *
 * `'shared'` 면 모든 섹션이 악보 전체를 쓴다. `'sequential'` 이면 **줄 수에 비례해**
 * 나눈다 — 절마다 길이가 다른 곡이 많아 똑같이 나누면 긴 절이 밀린다.
 */
export function sectionRanges(
  sectionLines: readonly number[],
  systemCount: number,
  layout: SheetLayout,
): SystemRange[] {
  if (systemCount <= 0) return sectionLines.map(() => ({ from: 0, to: 0 }));
  if (layout === 'shared') return sectionLines.map(() => ({ from: 0, to: systemCount }));

  const total = sectionLines.reduce((sum, lines) => sum + lines, 0);
  if (total <= 0) return sectionLines.map(() => ({ from: 0, to: systemCount }));

  const ranges: SystemRange[] = [];
  let used = 0;
  for (const [index, lines] of sectionLines.entries()) {
    used += lines;
    const to = index === sectionLines.length - 1 ? systemCount : Math.round((used / total) * systemCount);
    const from = ranges[index - 1]?.to ?? 0;
    // 섹션마다 단을 적어도 하나는 준다 — 빈 범위면 그 절에서 악보가 사라진다
    ranges.push({ from, to: Math.max(to, from + 1) });
  }
  // 마지막이 넘칠 수 있다 (최소 1칸 보장 때문에) — 끝을 맞춘다
  const last = ranges[ranges.length - 1];
  if (last) last.to = Math.max(systemCount, last.from + 1);
  return ranges;
}

/**
 * 슬라이드마다 보여 줄 단 번호.
 *
 * `slideSections[i]` 는 i 번째 슬라이드가 몇 번째 섹션의 것인지다. 한 섹션의
 * 슬라이드 n 개를 그 섹션의 단 범위에 **비례로** 흩는다 — 슬라이드 3개를 단 6개에
 * 배분하면 0·2·4 단이 된다.
 *
 * 범위를 벗어나는 섹션 번호는 첫 섹션으로 본다. 조용히 -1 을 돌려주면 화면이
 * 빈 채로 넘어가는데, 예배 중에는 **틀린 단이라도 보이는 편**이 낫다.
 */
export function matchSlidesToSystems(
  slideSections: readonly number[],
  sectionLines: readonly number[],
  systemCount: number,
  layout: SheetLayout,
): number[] {
  if (systemCount <= 0 || slideSections.length === 0) return slideSections.map(() => -1);

  const ranges = sectionRanges(sectionLines, systemCount, layout);

  /** 섹션마다 슬라이드가 몇 개이고 지금이 그중 몇 번째인가 */
  const counts = new Map<number, number>();
  for (const section of slideSections) counts.set(section, (counts.get(section) ?? 0) + 1);
  const seen = new Map<number, number>();

  return slideSections.map((raw) => {
    const section = ranges[raw] ? raw : 0;
    const range = ranges[section] ?? { from: 0, to: systemCount };
    const span = Math.max(1, range.to - range.from);
    const total = counts.get(raw) ?? 1;
    const index = seen.get(raw) ?? 0;
    seen.set(raw, index + 1);

    const offset = total <= 1 ? 0 : Math.floor((index * span) / total);
    return Math.min(systemCount - 1, range.from + Math.min(offset, span - 1));
  });
}
