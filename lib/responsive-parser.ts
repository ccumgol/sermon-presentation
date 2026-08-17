/**
 * 교독문 파일 파서 — `교독문_개역개정.txt` 같은 텍스트를 읽을 수 있는 구조로 바꾼다.
 *
 * ## 파일 모양
 *
 * ```
 *                 1. 시편 1편
 * 복 있는 사람은 악인들의 꾀를 따르지 아니하며 …      ← 인도자
 * 오만한 자들의 자리에 앉지 아니하고                  ← 회중
 * …
 * (다같이) 무릇 의인들의 길은 여호와께서 … (1-6)      ← 마지막에 함께 (없을 수도 있다)
 * ```
 *
 * 제목 줄은 **들여쓰기가 있고** `번호. 제목` 꼴이다. 본문 줄은 들여쓰기가 없다.
 * 76편 전체를 조사해 확인한 사실(2026-08-17):
 *
 *  - 번호 1~76, 빠진 번호 없음
 *  - 들여쓰기가 없는 줄이 `숫자.` 로 시작하는 경우는 **하나도 없다** → 제목 판별이 안전하다
 *  - 짝수 줄 41편(순수 교대) · 홀수 줄 35편(교대 + 마지막 `(다같이)` 한 줄). 예외 없음
 *
 * ## 본문을 손대지 않는다
 *
 * 절기 교독문은 **줄마다 성구 표기**가 붙는다(`(행 1:8)` 처럼 — 줄마다 다른 책에서 온다).
 * 시편 교독문은 마지막 줄 끝에 절 범위(`(1-6)`)가 붙는다. 둘 다 주보에 그렇게 인쇄되므로
 * **떼지 않는다.** `(다같이)` 표시도 회중에게 필요한 정보라 그대로 둔다.
 *
 * 무엇을 뗄지 판단하기 시작하면 76편마다 예외를 다루게 되고, 그 판단이 틀리면
 * 예배 중에 드러난다. 원문 그대로가 가장 안전하다.
 *
 * ## 짝 묶기는 여기서 하지 않는다
 *
 * 줄을 그대로 담고, 화면 단위(인도자+회중 한 짝)는 `readingSlides` 가 계산한다.
 * 저장된 데이터에 화면 구성을 박아 두면 나중에 바꿀 수 없다.
 */

/** 눈에 보이지 않는데 줄을 비어 있지 않게 만드는 문자들 (파일에 U+200B 가 78개 있다) */
const INVISIBLE = /[​‌‍﻿ ]/g;

export interface ResponsiveReading {
  /** 파일에 적힌 번호 — 순서표에서 '교독문 23번' 으로 고른다 */
  number: number;
  /** '시편 1편' · '성탄절' · '3․1절' */
  title: string;
  /** 인도자·회중이 번갈아 읽는 줄. 원문 그대로. */
  lines: string[];
}

export interface ParsedReadings {
  readings: ResponsiveReading[];
  /** 조용히 넘기지 않는다 — 가져오기 리포트에 그대로 싣는다 */
  problems: string[];
}

/** 제목 줄: 들여쓰기 + `번호. 제목` */
const TITLE = /^[ \t]+(\d{1,3})\.[ \t]*(\S.*?)[ \t]*$/;

function clean(line: string): string {
  return line.replace(INVISIBLE, '').trim();
}

/**
 * 교독문 텍스트를 파싱한다.
 *
 * 제목을 만나기 전에 나온 줄, 본문이 없는 제목, 겹치는 번호는 **버리지 않고
 * `problems` 에 남긴다** — 76편 중 하나가 조용히 빠지면 그 주에 알게 된다.
 */
export function parseResponsiveReadings(raw: string): ParsedReadings {
  const readings: ResponsiveReading[] = [];
  const problems: string[] = [];
  const seen = new Map<number, string>();

  let current: ResponsiveReading | null = null;
  let orphanCount = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    const title = TITLE.exec(rawLine.replace(INVISIBLE, ''));
    if (title) {
      const number = Number(title[1]);
      const name = clean(title[2]!);

      const already = seen.get(number);
      if (already !== undefined) {
        problems.push(`${number}번이 두 번 나옵니다 ('${already}' / '${name}') — 뒤엣것을 씁니다`);
      }
      seen.set(number, name);

      current = { number, title: name, lines: [] };
      readings.push(current);
      continue;
    }

    const line = clean(rawLine);
    if (line.length === 0) continue;

    if (current === null) {
      orphanCount += 1;
      continue;
    }
    current.lines.push(line);
  }

  if (orphanCount > 0) {
    problems.push(`제목보다 앞에 나온 줄 ${orphanCount}개를 건너뛰었습니다`);
  }

  // 번호가 겹치면 뒤엣것만 남긴다 (경고는 위에서 이미 남겼다)
  const byNumber = new Map<number, ResponsiveReading>();
  for (const reading of readings) {
    if (reading.lines.length === 0) {
      problems.push(`${reading.number}. ${reading.title} — 본문이 없어 건너뛰었습니다`);
      continue;
    }
    byNumber.set(reading.number, reading);
  }

  return {
    readings: [...byNumber.values()].sort((a, b) => a.number - b.number),
    problems,
  };
}

/** 한 화면 — 인도자 한 줄, 회중 한 줄. 마지막 '다같이' 줄은 짝이 없다. */
export interface ReadingSlide {
  leader: string;
  /** 없으면 마지막 '다같이' 줄 — 혼자 한 화면을 쓴다 */
  people?: string;
}

/**
 * 줄들을 화면 단위로 묶는다 — **한 화면에 두 줄(인도자·회중).**
 *
 * 교독문은 인도자와 회중이 번갈아 읽으므로, 회중은 **자기 차례 줄이 화면에 있어야**
 * 읽을 수 있다. 한 줄씩 넘기면 인도자가 읽는 동안 회중 줄이 안 보인다
 * (2026-08-17 사용자 요구).
 *
 * 줄 수가 홀수면 마지막 한 줄(`(다같이) …`)이 남는다. 앞 화면에 세 줄로 붙이지 않고
 * **혼자 한 화면**을 준다 — 다같이 읽는 줄은 성격이 달라 따로 보이는 것이 맞다.
 */
export function readingSlides(lines: readonly string[]): ReadingSlide[] {
  const slides: ReadingSlide[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const leader = lines[i]!;
    const people = lines[i + 1];
    slides.push(people === undefined ? { leader } : { leader, people });
  }
  return slides;
}
