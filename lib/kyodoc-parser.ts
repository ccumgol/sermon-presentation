/**
 * 새찬송가 교독문 원본 어댑터 — `Kyodoc.sqlite` 의 `NEW_KYODOC` 표.
 *
 * ## 원본 모양
 *
 * ```
 * NAME        '1. 시편 1편'          번호. 제목
 * DESCRIPTION '첫 줄/\n둘째 줄/\n…'  줄마다 '/' 로 끝나고 개행으로 나뉜다
 * ```
 *
 * 통일찬송가 교독문(`교독문_개역개정.txt`, 들여쓰기 + '번호. 제목')과 형식이 전혀 다르므로
 * 어댑터를 따로 둔다 — 성경 원본을 스키마별 어댑터로 읽는 것과 같은 방식이다
 * (`scripts/bible-sources.ts`).
 *
 * ## 본문을 고치지 않는다
 *
 * `/` 는 줄 구분자이므로 뗀다. 그 밖에는 **한 글자도 손대지 않는다** — `(다같이)`·성구
 * 표기·이상한 반복까지 그대로 넣고, 이상한 것은 **알린다.** 원본이 사실상의 원본이므로
 * 프로그램이 짐작해서 고치면 다음 반입에 조용히 덮어써진다.
 */

import type { ResponsiveReading } from './responsive-parser.ts';

/** 원본 한 행 — 실제 열 이름을 그대로 쓴다 */
export interface KyodocRow {
  ID: number;
  NAME: string;
  DESCRIPTION: string;
}

export interface KyodocRowResult {
  reading?: ResponsiveReading;
  /** 사람이 봐야 하는 것 — 조용히 넘기지 않는다 */
  problem?: string;
}

/** `1. 시편 1편` → 번호 1, 제목 '시편 1편' */
const NAME_FORM = /^\s*(\d{1,4})\s*\.\s*(\S.*?)\s*$/;

/**
 * 한 행을 읽는다.
 *
 * 번호는 **`NAME` 의 것을 쓴다.** `ID` 는 표의 자동 번호일 뿐이고 사람이 보는 번호는
 * 제목 앞에 적힌 것이다 (원본 137편에서 둘이 100% 일치하지만, 어긋나면 알린다).
 */
export function parseKyodocRow(row: KyodocRow): KyodocRowResult {
  const name = String(row.NAME ?? '');
  const match = NAME_FORM.exec(name);
  if (!match) {
    return { problem: `ID ${row.ID}: 제목이 '번호. 제목' 형태가 아닙니다 — '${name}'` };
  }

  const number = Number(match[1]);
  const title = match[2]!;

  const lines = String(row.DESCRIPTION ?? '')
    .split(/\r?\n/)
    // 줄 끝의 '/' 와 그 뒤 공백만 뗀다. 본문 안의 '/' 는 남긴다
    .map((line) => line.replace(/\/\s*$/, '').trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { problem: `${number}번 '${title}': 본문이 비어 있습니다` };
  }

  const problems: string[] = [];
  if (number !== row.ID) {
    problems.push(`${number}번 '${title}': 제목의 번호와 원본 ID ${row.ID} 가 다릅니다`);
  }

  /*
   * `(다같이)` 는 마지막에 함께 읽는 줄이라 맨 끝에 온다. 중간에 있으면 원본이
   * 이상한 것이다 — 실제로 새찬송가 원본 5번이 내용을 두 번 반복하고 있다.
   * **고치지 않는다.** 어느 쪽이 맞는지는 교독문 실물을 봐야 알 수 있다.
   */
  const midway = lines.findIndex((line, index) => line.startsWith('(다같이)') && index !== lines.length - 1);
  if (midway >= 0) {
    problems.push(
      `${number}번 '${title}': '(다같이)' 줄이 중간(${midway + 1}/${lines.length})에 있습니다 — ` +
        '원본이 내용을 반복하는지 확인하세요',
    );
  }

  return {
    reading: { number, title, lines },
    ...(problems.length > 0 ? { problem: problems.join(' · ') } : {}),
  };
}

/**
 * 표 전체를 읽는다. 읽을 수 있는 것만 돌려주고 나머지는 알린다.
 *
 * 같은 번호가 둘이면 **뒤엣것을 버리고 알린다.** 조용히 덮어쓰면 한 편이 사라진다.
 */
export function parseKyodocRows(rows: readonly KyodocRow[]): {
  readings: ResponsiveReading[];
  problems: string[];
} {
  const readings: ResponsiveReading[] = [];
  const problems: string[] = [];
  const seen = new Map<number, string>();

  for (const row of rows) {
    const result = parseKyodocRow(row);
    if (result.problem) problems.push(result.problem);
    if (!result.reading) continue;

    const already = seen.get(result.reading.number);
    if (already !== undefined) {
      problems.push(
        `${result.reading.number}번이 두 번 나옵니다 — '${already}' 를 두고 ` +
          `'${result.reading.title}' 를 버렸습니다`,
      );
      continue;
    }
    seen.set(result.reading.number, result.reading.title);
    readings.push(result.reading);
  }

  readings.sort((a, b) => a.number - b.number);
  return { readings, problems };
}
