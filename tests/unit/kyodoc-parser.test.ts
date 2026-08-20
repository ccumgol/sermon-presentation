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
 * 통일찬송가 교독문(`교독문_개역개정.txt`)과 형식이 전혀 다르므로 어댑터를 따로 둔다 —
 * 성경 원본을 스키마별 어댑터로 읽는 것과 같은 방식이다.
 *
 * ## 본문을 고치지 않는다
 *
 * `/` 는 줄 구분자이므로 뗀다. 그 밖에는 **한 글자도 손대지 않는다** —
 * `(다같이)`·성구 표기·이상한 반복까지 그대로 넣고, 이상한 것은 **알린다.**
 */

import { describe, expect, it } from 'vitest';

import { parseKyodocRow, parseKyodocRows } from '../../lib/kyodoc-parser.ts';

describe('한 편 읽기', () => {
  it('번호와 제목을 가른다', () => {
    const result = parseKyodocRow({ ID: 1, NAME: '1. 시편 1편', DESCRIPTION: '가/\n나' });
    expect(result.reading).toEqual({ number: 1, title: '시편 1편', lines: ['가', '나'] });
  });

  it('줄 끝의 / 를 뗀다 — 구분자이므로', () => {
    const result = parseKyodocRow({ ID: 2, NAME: '2. 제목', DESCRIPTION: '첫 줄/\n둘째 줄/\n셋째 줄' });
    expect(result.reading?.lines).toEqual(['첫 줄', '둘째 줄', '셋째 줄']);
  });

  it('/ 뒤에 붙은 공백도 다듬는다 (원본에 6편 있다)', () => {
    const result = parseKyodocRow({ ID: 3, NAME: '3. 제목', DESCRIPTION: '첫 줄/ \n둘째 줄/' });
    expect(result.reading?.lines).toEqual(['첫 줄', '둘째 줄']);
  });

  it('본문 안의 / 는 남긴다 — 줄 끝만 구분자다', () => {
    const result = parseKyodocRow({ ID: 4, NAME: '4. 제목', DESCRIPTION: '가/나 다/' });
    expect(result.reading?.lines).toEqual(['가/나 다']);
  });

  it('(다같이) 와 성구 표기를 그대로 둔다', () => {
    const result = parseKyodocRow({
      ID: 5,
      NAME: '5. 시편 8편',
      DESCRIPTION: '여호와 우리 주여/\n(다같이) 주의 이름이 (시 8:1)',
    });
    expect(result.reading?.lines[1]).toBe('(다같이) 주의 이름이 (시 8:1)');
  });

  it('빈 줄은 버린다 — 화면에 구멍이 생긴다', () => {
    const result = parseKyodocRow({ ID: 6, NAME: '6. 제목', DESCRIPTION: '가/\n\n나/\n   \n' });
    expect(result.reading?.lines).toEqual(['가', '나']);
  });
});

describe('이상한 것을 알린다', () => {
  it('NAME 이 "번호. 제목" 이 아니면 버리고 알린다', () => {
    const result = parseKyodocRow({ ID: 7, NAME: '제목만 있음', DESCRIPTION: '가/' });
    expect(result.reading).toBeUndefined();
    expect(result.problem).toContain('7');
  });

  it('NAME 의 번호가 ID 와 다르면 알린다 — 어느 쪽이 맞는지 사람이 봐야 한다', () => {
    const result = parseKyodocRow({ ID: 8, NAME: '99. 제목', DESCRIPTION: '가/' });
    // 버리지 않는다. NAME 의 번호를 쓰고 다르다는 것을 알린다
    expect(result.reading?.number).toBe(99);
    expect(result.problem).toContain('ID 8');
  });

  it('본문이 비면 버리고 알린다', () => {
    const result = parseKyodocRow({ ID: 9, NAME: '9. 제목', DESCRIPTION: '   ' });
    expect(result.reading).toBeUndefined();
    expect(result.problem).toContain('본문');
  });

  it('(다같이) 가 마지막 줄이 아니면 알린다 — 원본 5번이 그렇다', () => {
    const result = parseKyodocRow({
      ID: 5,
      NAME: '5. 시편 8편',
      DESCRIPTION: '가/\n(다같이) 나/\n다/\n라',
    });
    // 고치지 않고 넣는다. 사람이 봐야 하는 것이다
    expect(result.reading?.lines).toHaveLength(4);
    expect(result.problem).toContain('다같이');
  });
});

describe('여러 편', () => {
  const ROWS = [
    { ID: 1, NAME: '1. 첫째', DESCRIPTION: '가/\n나' },
    { ID: 2, NAME: '이상함', DESCRIPTION: '다/' },
    { ID: 3, NAME: '3. 셋째', DESCRIPTION: '라/\n마' },
  ];

  it('읽을 수 있는 것만 돌려주고 나머지는 알린다', () => {
    const { readings, problems } = parseKyodocRows(ROWS);
    expect(readings.map((r) => r.number)).toEqual([1, 3]);
    expect(problems).toHaveLength(1);
  });

  it('번호 순서로 정렬한다', () => {
    const { readings } = parseKyodocRows([
      { ID: 3, NAME: '3. 셋째', DESCRIPTION: '가/' },
      { ID: 1, NAME: '1. 첫째', DESCRIPTION: '나/' },
    ]);
    expect(readings.map((r) => r.number)).toEqual([1, 3]);
  });

  it('같은 번호가 둘이면 알린다 — 하나가 조용히 사라지면 안 된다', () => {
    const { readings, problems } = parseKyodocRows([
      { ID: 1, NAME: '1. 첫째', DESCRIPTION: '가/' },
      { ID: 2, NAME: '1. 다른 첫째', DESCRIPTION: '나/' },
    ]);
    expect(readings).toHaveLength(1);
    expect(problems.join(' ')).toContain('1번');
  });
});
