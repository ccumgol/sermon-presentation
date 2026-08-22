/**
 * 새찬송가 영어 원제 반입 — 출처 파서와 **안전장치**.
 *
 * 이 자료는 위키에서 온 것이라 오류가 섞여 있다. 실제로 점검해서 찾은 것:
 *  - 새 631·632·638·639 에서 **행이 중복되며 뒤가 밀렸다** → 엉뚱한 곡에 붙는다
 *  - 259 `Cleans-ing`(노래용 음절 하이픈) · 302 `Ocean’`(군더더기 아포스트로피)
 *  - 한국어 제목에 오타가 여럿 (정혼한 처녀에세 · 취후기도 · 사람의 주님께 · 내밀리고)
 *
 * 그래서 이 모듈이 하는 일은 '읽기' 가 아니라 **'거르기'** 다.
 */

import { describe, expect, it } from 'vitest';

import {
  cleanEnglishTitle,
  parseHymnEnRows,
  RESOLVED_SUSPECTS,
  SUSPECT_NUMBERS,
} from '../../lib/hymn-en-titles.ts';

const TSV = [
  '# 주석은 건너뛴다',
  'new\told\tko_ref\ten',
  '1\t1\t만복의 근원 하나님\tPraise God from Whom All Blessings Flow',
  '9\t5,3\t하늘에 가득 찬 영광의 하나님\tHeaven is Full of Your Glory',
  '642\t\t아멘\tAmen',
].join('\n');

describe('출처 읽기', () => {
  it('주석과 머리 줄을 건너뛴다', () => {
    expect(parseHymnEnRows(TSV).rows).toHaveLength(3);
  });

  it('번호·영어 원제를 읽는다', () => {
    const [first] = parseHymnEnRows(TSV).rows;
    expect(first?.newNumber).toBe(1);
    expect(first?.english).toBe('Praise God from Whom All Blessings Flow');
  });

  it('통일 번호가 여러 개면 모두 읽는다 (새 9장이 그렇다)', () => {
    const row = parseHymnEnRows(TSV).rows.find((r) => r.newNumber === 9);
    expect(row?.oldNumbers).toEqual([5, 3]);
  });

  it('통일 번호가 없으면 빈 배열 — 새찬송가에만 있는 곡이다', () => {
    const row = parseHymnEnRows(TSV).rows.find((r) => r.newNumber === 642);
    expect(row?.oldNumbers).toEqual([]);
  });

  it('한국어 제목은 참고용으로만 담는다', () => {
    // 반입에 쓰지 않는다는 것을 이름으로 못 박는다
    const [first] = parseHymnEnRows(TSV).rows;
    expect(first?.koreanForReference).toBe('만복의 근원 하나님');
  });
});

describe('거르기', () => {
  it('영어 제목이 비면 버리고 알린다', () => {
    const { rows, problems } = parseHymnEnRows('new\told\tko_ref\ten\n5\t5\t제목\t');
    expect(rows).toHaveLength(0);
    expect(problems.join(' ')).toContain('5');
  });

  it('번호가 1~645 밖이면 버린다', () => {
    const { rows, problems } = parseHymnEnRows('new\told\tko_ref\ten\n999\t1\t제목\tTitle');
    expect(rows).toHaveLength(0);
    expect(problems.join(' ')).toContain('999');
  });

  it('통일 번호가 558 을 넘으면 버린다 — 통일찬송가에 없는 번호다', () => {
    const { rows } = parseHymnEnRows('new\told\tko_ref\ten\n606\t606\t제목\tTitle');
    expect(rows[0]?.oldNumbers).toEqual([]);
  });

  it('같은 번호가 두 번 나오면 뒤엣것을 버리고 알린다', () => {
    const { rows, problems } = parseHymnEnRows(
      'new\told\tko_ref\ten\n1\t1\t가\tA\n1\t1\t나\tB',
    );
    expect(rows).toHaveLength(1);
    expect(problems.join(' ')).toContain('1번');
  });
});

describe('의심 번호는 반입하지 않는다', () => {
  it('점검에서 어긋난 4곳이 목록에 있다', () => {
    expect([...SUSPECT_NUMBERS].sort((a, b) => a - b)).toEqual([631, 632, 638, 639]);
  });

  it('그 번호는 skipped 로 빠진다', () => {
    const tsv = ['new\told\tko_ref\ten', '631\t547\t진리와 생명 되신 주\tThou Art the Way'].join('\n');
    const { rows, skipped } = parseHymnEnRows(tsv);
    expect(rows).toHaveLength(0);
    expect(skipped.map((s) => s.newNumber)).toEqual([631]);
  });
});

describe('영어 제목 잡티 떼기', () => {
  it('노래용 음절 하이픈을 뗀다 (새 259)', () => {
    expect(cleanEnglishTitle("Have You Been to Jesus for the Cleans-ing Pow'r?")).toBe(
      "Have You Been to Jesus for the Cleansing Pow'r?",
    );
  });

  it("찬송가 특유의 축약(Pow'r · 'Tis)은 남긴다", () => {
    expect(cleanEnglishTitle("'Tis the Blessed Hour of Prayer")).toBe("'Tis the Blessed Hour of Prayer");
    expect(cleanEnglishTitle("All Hail the Pow'r of Jesus' Name!")).toBe("All Hail the Pow'r of Jesus' Name!");
  });

  it('군더더기 둥근 아포스트로피를 뗀다 (새 302)', () => {
    expect(cleanEnglishTitle('The Mercy of God is an Ocean’ Divine')).toBe(
      'The Mercy of God is an Ocean Divine',
    );
  });

  it('낱말 안의 둥근 아포스트로피는 곧은 것으로 바꾼다', () => {
    expect(cleanEnglishTitle('God’s Great Grace')).toBe("God's Great Grace");
  });

  it('겹친 공백을 하나로', () => {
    expect(cleanEnglishTitle('Amazing   Grace')).toBe('Amazing Grace');
  });

  it('바꿀 것이 없으면 그대로 둔다', () => {
    expect(cleanEnglishTitle('Amazing Grace! How Sweet the Sound!')).toBe(
      'Amazing Grace! How Sweet the Sound!',
    );
  });
});

describe('의심 구간을 사람이 판정한 표', () => {
  it('631 · 632 · 638 만 판정했다 — 639 는 출처에 없어 비워 둔다', () => {
    expect([...RESOLVED_SUSPECTS.keys()].sort((a, b) => a - b)).toEqual([631, 632, 638]);
    expect(RESOLVED_SUSPECTS.has(639)).toBe(false);
  });

  it('판정한 번호는 모두 의심 목록 안에 있다', () => {
    for (const n of RESOLVED_SUSPECTS.keys()) expect(SUSPECT_NUMBERS.has(n)).toBe(true);
  });

  it('판정마다 근거가 적혀 있다 — 왜 이 값인지 나중에 알 수 있어야 한다', () => {
    for (const [n, v] of RESOLVED_SUSPECTS) {
      expect(v.english.length, `${n}번 영어 제목이 비었다`).toBeGreaterThan(0);
      expect(v.basis.length, `${n}번 근거가 비었다`).toBeGreaterThan(10);
    }
  });

  it('631·632 는 번호로, 638 은 제목으로 판정했다 (구간이 다르게 밀렸다)', () => {
    // 두 구간을 뭉쳐 한 규칙으로 풀면 631·632 가 틀린다 — 그 사실을 값으로 고정한다
    expect(RESOLVED_SUSPECTS.get(631)?.english).toBe('Hear Our Prayer, O Lord');
    expect(RESOLVED_SUSPECTS.get(638)?.english).toBe('The Lord Bless You and Keep You');
  });

  it('판정한 값에는 잡티가 없다', () => {
    for (const [, v] of RESOLVED_SUSPECTS) {
      expect(cleanEnglishTitle(v.english)).toBe(v.english);
    }
  });
});
