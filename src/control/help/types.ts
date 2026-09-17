/**
 * 사용설명서의 **내용 모양** (사용자 요청 2026-09-17).
 *
 * ## 왜 마크다운이 아닌가
 *
 * `docs/USER-GUIDE.md` 를 그대로 띄우는 길도 있었지만 두 가지가 걸린다.
 *
 * 1. **마크다운 라이브러리가 하나 늘어난다.** 이 앱은 의존성이 다섯 개뿐이고
 *    출력 페이지는 아예 0 이다. 설명서 하나를 위해 파서를 들일 일이 아니다.
 * 2. **문서와 화면은 구성이 다르다.** 문서는 위에서 아래로 읽는 것이고,
 *    화면은 **지금 막힌 것을 찾아 들어가는** 것이다. 차례·검색이 붙으려면
 *    글이 조각으로 나뉘어 있어야 한다.
 *
 * 그래서 내용을 **데이터로** 둔다. 조각마다 제목이 있으니 검색이 되고,
 * 표·경고·단축키가 각자 제 모양으로 그려진다.
 *
 * ## 글 안의 강조
 *
 * `**굵게**` 와 `` `코드` `` 두 가지만 쓴다 (`renderInline`). 더 늘리면 그게 곧
 * 마크다운 파서다 — 필요해지면 그때는 라이브러리를 들이는 편이 낫다.
 */

/** 글 한 덩이 */
export type HelpBlock =
  | { t: 'p'; text: string }
  | { t: 'sub'; text: string }
  /** 번호가 붙는 절차 — '이대로 따라 하면 된다' 는 뜻이다 */
  | { t: 'steps'; items: string[] }
  | { t: 'list'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  /** 눈에 띄어야 하는 것. `warn` 은 '모르면 예배 중에 당한다' 는 뜻으로만 쓴다 */
  | { t: 'note'; kind: 'tip' | 'warn'; text: string }
  | { t: 'keys'; rows: Array<{ keys: string[]; what: string }> };

export interface HelpSection {
  /** 주소창의 `#` 이 아니라 **차례에서 고르는 열쇠**다 */
  id: string;
  title: string;
  /** 차례에 함께 보이는 한 줄. 무엇을 찾는지 여기서 가린다 */
  summary: string;
  blocks: HelpBlock[];
}

export interface HelpChapter {
  id: string;
  title: string;
  sections: HelpSection[];
}

/** 검색에 쓸 납작한 글 — 표 칸까지 들어간다 */
export function sectionText(section: HelpSection): string {
  const parts: string[] = [section.title, section.summary];
  for (const block of section.blocks) {
    switch (block.t) {
      case 'p':
      case 'sub':
        parts.push(block.text);
        break;
      case 'note':
        parts.push(block.text);
        break;
      case 'steps':
      case 'list':
        parts.push(...block.items);
        break;
      case 'table':
        parts.push(...block.head, ...block.rows.flat());
        break;
      case 'keys':
        for (const row of block.rows) parts.push(...row.keys, row.what);
        break;
    }
  }
  // 강조 기호는 찾는 말이 아니다 — '**굵게**' 를 치는 사람은 없다
  return parts.join(' ').replace(/[*`]/g, '');
}
