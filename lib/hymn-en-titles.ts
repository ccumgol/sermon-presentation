/**
 * 새찬송가 영어 원제 — 출처 읽기와 **거르기**.
 *
 * ## 왜 필요한가
 *
 * 우리 `songs` 표에는 `title_alt`(원제)·`author`·`composer` 열이 있지만 **4,396곡 전부
 * 비어 있다.** 그래서 '새찬송가 305장이 어느 영어 찬송인가' 를 알 방법이 없었다.
 * 영어 가사를 찾으려면 그것을 먼저 알아야 한다 (2026-08-21 사용자 요청).
 *
 * 출처는 사용자 노션 페이지에 모아 둔 nme.kr 위키 표다(`data/hymn-en-titles.tsv`).
 * **제목은 가사가 아니다** — 짧아서 저작권 대상이 아니고, 원제를 알면 퍼블릭 도메인
 * 영어 가사를 찾아갈 수 있다.
 *
 * ## 이 모듈이 하는 일은 '읽기' 가 아니라 '거르기' 다
 *
 * 위키 자료라 오류가 섞여 있다. 실제로 점검해서 찾은 것:
 *
 * | 문제 | 어떻게 다루나 |
 * |---|---|
 * | 새 631·632·638·639 에서 **행이 중복되며 뒤가 밀렸다** | `SUSPECT_NUMBERS` — **반입하지 않는다** |
 * | 통일 번호에 불가능한 값 (통일찬송가는 558장까지) | 그 번호만 버린다 |
 * | 영어 제목의 노래용 음절 하이픈 · 군더더기 아포스트로피 | 기계적으로만 뗀다 |
 * | **한국어 제목의 오타가 우리보다 많다** | 아예 쓰지 않는다 (`koreanForReference`) |
 *
 * 마지막 항목이 이 설계의 핵심이다. 출처가 두 개면 '어느 쪽이 원본인가' 를 정해야 한다.
 * 한국어 제목은 **우리 DB 가 원본**이고, 이 자료에서 가져오는 것은 **영어 원제와
 * 통일찬송가 번호 둘뿐**이다.
 */

/** 새찬송가 장 수 */
const NEW_MAX = 645;
/** 통일찬송가 장 수 — 이 값을 넘는 통일 번호는 존재할 수 없다 */
const OLD_MAX = 558;

/**
 * 반입하지 않는 번호.
 *
 * 출처에서 **행이 중복되며 뒤가 밀린** 구간이다 (2026-08-21 점검).
 *
 * ```
 * 새 630  진리와 생명 되신 주     ✓
 * 새 631  진리와 생명 되신 주  ← 중복   우리: 우리 기도를
 * 새 632  우리 기도를                 우리: 주여 주여 우리를
 * 새 633  나의 하나님 받으소서    ✓ 다시 맞음
 *
 * 새 637  주님 우리의 마음을 여시어  ✓
 * 새 638  모든 것이 주께로부터 ← 634 중복  우리: 주 너를 지키시고
 * 새 639  주 너를 지키시고             우리: 주 함께 하소서
 * 새 640  아멘                  ✓ 다시 맞음
 * ```
 *
 * 출처에서 「주여 주여 우리를」과 「주 함께 하소서」가 빠지고 두 곡이 중복됐다.
 * 계통적인 한 칸 밀림은 아니다(641/645 는 정상). 그래서 **이 넷만 손으로 확인**한다.
 * 그대로 넣으면 엉뚱한 곡에 영어 제목이 붙는다.
 */
export const SUSPECT_NUMBERS: ReadonlySet<number> = new Set([631, 632, 638, 639]);

export interface HymnEnRow {
  /** 새찬송가 번호 (1~645) */
  newNumber: number;
  /** 통일찬송가 번호. 여럿일 수 있고(새 9장), 없을 수도 있다(새찬송가 전용 곡) */
  oldNumbers: number[];
  /**
   * 출처의 한국어 제목 — **참고용이다. 반입에 쓰지 않는다.**
   *
   * 이 자료에 오타가 더 많다(정혼한 처녀에세 · 취후기도 · 사람의 주님께 · 내밀리고).
   * 이름에 `ForReference` 를 박아 둔 이유가 그것이다.
   */
  koreanForReference: string;
  /** 영어 원제 (잡티를 뗀 값) */
  english: string;
}

export interface HymnEnResult {
  rows: HymnEnRow[];
  /** 의심 번호라 일부러 넣지 않은 것 — 사람이 확인해야 한다 */
  skipped: HymnEnRow[];
  /** 조용히 넘기지 않고 알릴 것 */
  problems: string[];
}

/**
 * 영어 제목에서 **기계적으로 확실한 잡티만** 뗀다.
 *
 * 찬송가 영어 제목에는 `Pow'r`·`'Tis`·`Jesus'` 처럼 **뜻이 있는 축약**이 흔하다.
 * 그것을 지우면 제목이 틀린다. 그래서 다음 셋만 건드린다.
 *
 * 1. **낱말을 쪼갠 하이픈** — 악보에 음절을 나눠 적은 흔적 (`Cleans-ing` → `Cleansing`).
 *    양쪽이 모두 소문자일 때만 붙인다. `Christ-like` 처럼 뜻이 있는 하이픈은 남는다.
 * 2. **낱말 끝에 홀로 붙은 둥근 아포스트로피** (`Ocean’ Divine` → `Ocean Divine`).
 *    곧은 `'` 는 건드리지 않는다 — `Jesus'` 는 정당하다.
 * 3. 낱말 **안**의 둥근 아포스트로피는 곧은 것으로 (`God’s` → `God's`).
 */
export function cleanEnglishTitle(raw: string): string {
  return (
    raw
      // 낱말 안의 둥근 아포스트로피 → 곧은 것 (God’s → God's)
      .replace(/(\p{L})[’‘](\p{L})/gu, "$1'$2")
      // 낱말 끝에 홀로 붙은 둥근 아포스트로피 (Ocean’ → Ocean)
      .replace(/(\p{L})[’‘](?=\s|$)/gu, '$1')
      // 소문자를 쪼갠 음절 하이픈 (Cleans-ing → Cleansing)
      .replace(/(\p{Ll})-(\p{Ll})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** TSV 한 줄을 읽는다. 주석(`#`)과 머리 줄은 부르는 쪽이 걸러 준다 */
function parseLine(line: string): { row?: HymnEnRow; problem?: string } {
  const cols = line.split('\t');
  const newNumber = Number(cols[0]);

  if (!Number.isInteger(newNumber) || newNumber < 1 || newNumber > NEW_MAX) {
    return { problem: `새찬송가 번호가 1~${NEW_MAX} 밖입니다 — '${cols[0]}'` };
  }

  const english = cleanEnglishTitle(cols[3] ?? '');
  if (english.length === 0) {
    return { problem: `${newNumber}번: 영어 원제가 비어 있습니다` };
  }

  /*
   * 통일 번호는 **버릴 수 있다.** 없어도 영어 원제는 쓸 수 있으므로, 값이 이상하면
   * 그 번호만 빼고 행은 살린다 — 항목을 통째로 버리면 원제를 잃는다.
   */
  const problems: string[] = [];
  const oldNumbers: number[] = [];
  for (const part of (cols[1] ?? '').split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > OLD_MAX) {
      problems.push(`${newNumber}번: 통일찬송가 번호 '${trimmed}' 는 1~${OLD_MAX} 밖입니다 — 버렸습니다`);
      continue;
    }
    oldNumbers.push(n);
  }

  return {
    row: { newNumber, oldNumbers, koreanForReference: (cols[2] ?? '').trim(), english },
    ...(problems.length > 0 ? { problem: problems.join(' · ') } : {}),
  };
}

/**
 * 출처 TSV 를 읽는다.
 *
 * 같은 번호가 두 번 나오면 **뒤엣것을 버리고 알린다** — 조용히 덮어쓰면 한 곡이 사라진다.
 * 의심 번호(`SUSPECT_NUMBERS`)는 `skipped` 로 빼서 사람이 볼 수 있게 한다.
 */
export function parseHymnEnRows(text: string): HymnEnResult {
  const rows: HymnEnRow[] = [];
  const skipped: HymnEnRow[] = [];
  const problems: string[] = [];
  const seen = new Set<number>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('new\t')) continue;

    const { row, problem } = parseLine(line);
    if (problem) problems.push(problem);
    if (!row) continue;

    if (seen.has(row.newNumber)) {
      problems.push(`${row.newNumber}번이 두 번 나옵니다 — 뒤엣것을 버렸습니다`);
      continue;
    }
    seen.add(row.newNumber);

    if (SUSPECT_NUMBERS.has(row.newNumber)) skipped.push(row);
    else rows.push(row);
  }

  rows.sort((a, b) => a.newNumber - b.newNumber);
  skipped.sort((a, b) => a.newNumber - b.newNumber);
  return { rows, skipped, problems };
}
