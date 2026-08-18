/**
 * 복음성가집 폴더 파서 — `~/Desktop/Data/Praise/<곡집>/제목 - 번호.txt`
 *
 * ## 세 곡집을 전수 조사해서 만들었다 (2026-08-18)
 *
 * | 곡집 | 곡 수 | 인코딩 | 절 표시 |
 * |---|---|---|---|
 * | 많은물소리 | 703 | CP949 | `1.가사` 487건 · `(후렴)` 16 · `[라벨]` 4 |
 * | 시와찬미 | 429 | CP949 | **없음** — 한 덩어리 |
 * | 찬미예수 2000 | 2,062 | UTF-8 | 숫자만 한 줄 1,071 · `(후렴)` 268 · 빈 줄 |
 *
 * 곡집마다 표시가 다르므로 **여섯 가지를 모두 받는다.** 하나만 지원하면 나머지 곡집이
 * 통째로 한 절이 되어, 예배 중 절을 골라 띄울 수 없다.
 *
 * ## 표시는 지우지 않고 **라벨로 옮긴다**
 *
 * `1.갈보리산 위에` 의 `1.` 은 가사가 아니라 절 번호다. 그대로 두면 화면에
 * '1.갈보리산 위에' 가 나간다. 그래서 떼서 섹션 라벨('1절')로 만든다 —
 * 버리는 것이 아니라 **옮기는 것**이라 정보가 남는다.
 *
 * 가사 글자 자체는 한 자도 바꾸지 않는다. 들여쓰기(많은물소리는 이어지는 줄을 3칸
 * 들여썼다)만 없앤다.
 */

import { inferSectionKind } from './lyrics-parser.ts';
import type { SongSection } from '../shared/types.ts';

/** `[라벨]` 한 줄 */
const LABEL = /^\[([^\]]+)\]$/;
/** 숫자만 있는 줄 — 찬미예수 2000 의 절 표시 (1,071건) */
const BARE_NUMBER = /^(\d{1,2})$/;
/** `1.가사` 또는 `1) 가사` — 많은물소리 (487건) */
const NUMBER_PREFIX = /^(\d{1,2})\s*[.)]\s*(.*)$/;
/** `(후렴)` `후렴` `(후렴)2` */
const REFRAIN = /^\(?\s*(후\s?렴|Chorus|CHORUS)\s*\)?\s*\d*$/;
/** `---` `***` 같은 구분선 — 가사가 아니다 */
const SEPARATOR = /^[*\-=~_]{2,}$/;

export interface ParsedPraiseSong {
  /** 파일 이름에서 뽑은 곡집 번호 */
  number: number;
  title: string;
  sections: SongSection[];
}

/**
 * `제목 - 번호` 를 나눈다.
 *
 * **마지막** ` - 숫자` 만 번호로 본다 — 제목 자체에 하이픈이 든 곡이 있다
 * ('Above All - 그 무엇보다 - 1234' 꼴). 앞에서부터 찾으면 제목이 잘린다.
 */
export function parsePraiseFilename(stem: string): { title: string; number: number } | undefined {
  const match = /^(.*?)\s*-\s*(\d{1,5})$/.exec(stem.trim());
  if (!match) return undefined;
  const title = match[1]!.trim();
  const number = Number(match[2]);
  if (title.length === 0 || !Number.isInteger(number) || number <= 0) return undefined;
  return { title, number };
}

interface Building {
  label: string;
  lines: string[];
}

/**
 * 가사 본문을 섹션으로 나눈다.
 *
 * 빈 줄도 섹션 경계로 본다. 표시가 있는 곡에서는 표시가 먼저 경계를 만들므로
 * 빈 줄이 겹쳐도 **빈 섹션은 버려진다** (찬미예수 2000 은 `(후렴)` 앞에 빈 줄이 있다).
 *
 * 아무 표시도 없으면 한 섹션('1절')이 된다 — 시와찬미 429곡이 그렇다.
 * 억지로 쪼개지 않는다. 절 구분을 모르는데 나누면 엉뚱한 자리에서 화면이 끊긴다.
 */
export function parsePraiseBody(text: string): SongSection[] {
  const built: Building[] = [];
  let current: Building | null = null;
  let autoVerse = 0;

  /** 라벨을 정해 새 섹션을 시작한다. 라벨이 없으면 순번으로 붙인다. */
  const start = (label?: string): Building => {
    autoVerse += 1;
    const next: Building = { label: label ?? `${autoVerse}절`, lines: [] };
    built.push(next);
    current = next;
    return next;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();

    if (line.length === 0) {
      // 다음 내용이 새 섹션을 열게 한다 (빈 섹션은 마지막에 버린다)
      current = null;
      continue;
    }
    if (SEPARATOR.test(line)) {
      current = null;
      continue;
    }

    const label = LABEL.exec(line);
    if (label) {
      start(label[1]!.trim());
      continue;
    }
    if (REFRAIN.test(line)) {
      start('후렴');
      continue;
    }
    const bare = BARE_NUMBER.exec(line);
    if (bare) {
      start(`${Number(bare[1])}절`);
      continue;
    }
    const prefixed = NUMBER_PREFIX.exec(line);
    if (prefixed) {
      const rest = prefixed[2]!.trim();
      start(`${Number(prefixed[1])}절`);
      // 표시 뒤에 가사가 이어지면 그것이 이 섹션의 첫 줄이다
      if (rest.length > 0) current!.lines.push(rest);
      continue;
    }

    (current ?? start()).lines.push(line);
  }

  // 빈 섹션을 버리고 번호를 다시 매긴다
  const kept = built.filter((section) => section.lines.length > 0);

  return kept.map((section, index) => ({
    // id 는 DB 가 발급한다 — 여기서는 순서만 뜻이 있다
    id: 0,
    kind: inferSectionKind(section.label),
    label: section.label,
    position: index,
    lines: section.lines.map((text, lineIndex) => ({ lineIndex, lang: 'ko', text })),
  }));
}

/** 파일 하나 → 곡. 이름이나 본문이 쓸 수 없으면 undefined (부르는 쪽이 리포트에 싣는다) */
export function parsePraiseSong(stem: string, body: string): ParsedPraiseSong | undefined {
  const name = parsePraiseFilename(stem);
  if (!name) return undefined;

  const sections = parsePraiseBody(body);
  if (sections.length === 0) return undefined;

  return { number: name.number, title: name.title, sections };
}
