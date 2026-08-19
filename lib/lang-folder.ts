/**
 * 번역 폴더 규약 — `언어/곡집/번호.txt`
 *
 * ## 왜 번호가 파일 이름인가
 *
 * 번역판의 **제목은 기준이 될 수 없다.** `Amazing Grace` 와 `나 같은 죄인 살리신` 은
 * 같은 곡이고, 곡집마다 표기도 다르다. `(곡집, 번호)` 는 사람이 정한 고정 좌표다.
 *
 * 기존 반입(`제목 - 번호.txt`)과 규약이 다른 이유가 이것이다 — 그쪽은 곡을 **만드는**
 * 일이라 제목이 필요하고, 이쪽은 이미 있는 곡을 **찾는** 일이라 번호만 필요하다.
 *
 * ## 한국어는 받지 않는다
 *
 * 이 통로는 **번역을 넣는 곳**이다. `ko` 를 받으면 사람이 승인한 한국어 가사를 파일로
 * 덮어쓰는 길이 생긴다. 한국어는 찬양 탭에서 사람이 고친다.
 */

import type { LangCode } from '../shared/types.ts';

/**
 * 이 통로로 넣을 수 있는 언어.
 *
 * `ko` 가 없는 것이 핵심이다 (위 설명). 아는 코드만 받는 이유는 폴더 이름이 언어가
 * 아닐 때(`lyrics/`, `backup/` 등) 조용히 넣지 않기 위해서다.
 */
export const IMPORTABLE_LANGS: ReadonlyArray<LangCode> = ['en', 'zh', 'ja'];

export interface LangFilePath {
  lang: LangCode;
  songbookId: string;
  number: number;
}

/**
 * `en/hymn_new/305.txt` → `{ lang: 'en', songbookId: 'hymn_new', number: 305 }`
 *
 * 규약에 맞지 않으면 `undefined` — 부르는 쪽이 건너뛰고 알린다.
 * 앞에 붙은 경로는 무시하므로 폴더를 어디에 두어도 된다.
 */
export function parseLangFolderPath(filePath: string): LangFilePath | undefined {
  // 뒤에서 세 칸만 본다 — 앞은 폴더를 어디에 두었는지일 뿐이다
  const parts = filePath.split('/');
  if (parts.length < 3) return undefined;
  const [langRaw, bookRaw, fileRaw] = parts.slice(-3);
  if (langRaw === undefined || bookRaw === undefined || fileRaw === undefined) return undefined;

  const lang = langRaw.trim();
  if (!IMPORTABLE_LANGS.includes(lang)) return undefined;

  // `en//305.txt` 처럼 곡집이 빈 경우도 여기서 걸린다
  const songbookId = bookRaw.trim();
  if (songbookId.length === 0) return undefined;

  // 확장자를 떼고 **번호만** 남는지 본다. `305a` 처럼 뒤에 붙은 것은 받지 않는다 —
  // 무엇을 뜻하는지 알 수 없는 것을 짐작해서 넣으면 엉뚱한 곡에 들어간다
  const stem = fileRaw.replace(/\.[^.]*$/, '').trim();
  if (!/^\d+$/.test(stem)) return undefined;
  const number = Number(stem);
  return number > 0 ? { lang, songbookId, number } : undefined;
}
