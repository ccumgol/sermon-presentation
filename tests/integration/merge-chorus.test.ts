/**
 * 후렴 병합 통합 테스트.
 *
 * 이 작업은 **사용자의 가사를 고쳐 쓰고 섹션을 지운다.** 그래서 핵심 검증은
 * '원문이 정확히 복원되는가'와 '건드리면 안 되는 것을 건드리지 않는가'다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMerge, isSkipped, type MergePlan, planMerge } from '../../scripts/merge-chorus.ts';
import * as store from '../../server/db/songs.ts';

/** 새9 형태 — 절 끝 어절이 후렴을 수식한다 (병합 없이는 문장이 안 된다) */
const CONTINUING = {
  verses: ['하늘에 가득 찬 영광의 하나님 성부와 성자와 성령 삼위의', '사랑이 넘치는 자비하신 하나님 찬송과 영광과 생명 구원의'],
  chorus: '하나님 우리 예배를 받아 주시옵소서',
};

function song(source: 'auto' | 'manual', withChorus = true) {
  const sections = [
    ...CONTINUING.verses.map((text, index) => ({
      kind: 'verse' as const,
      label: `${index + 1}절`,
      lines: [{ lineIndex: 0, lang: 'ko' as const, text }],
    })),
    ...(withChorus
      ? [
          {
            kind: 'chorus' as const,
            label: '후렴',
            lines: [{ lineIndex: 0, lang: 'ko' as const, text: CONTINUING.chorus }],
          },
        ]
      : []),
  ];
  return store.createSong({
    title: '후렴 병합 대상',
    source: 'merge-test',
    entries: [{ songbookId: 'misc' }],
    sections,
    linesSource: source,
  });
}

let autoSong: number;
let manualSong: number;
let noChorusSong: number;
let bilingualSong: number;

beforeAll(() => {
  store.initSongsDb();
  store.deleteBySource('merge-test');

  autoSong = song('auto');
  manualSong = song('manual');
  noChorusSong = song('auto', false);

  bilingualSong = store.createSong({
    title: '두 언어 후렴 곡',
    source: 'merge-test',
    entries: [{ songbookId: 'misc' }],
    linesSource: 'auto',
    sections: [
      {
        kind: 'verse',
        label: '1절',
        lines: [
          { lineIndex: 0, lang: 'ko', text: '한국어 절' },
          { lineIndex: 0, lang: 'en', text: 'English verse' },
        ],
      },
      { kind: 'chorus', label: '후렴', lines: [{ lineIndex: 0, lang: 'ko', text: '한국어 후렴' }] },
    ],
  });
});

afterAll(() => {
  store.deleteBySource('merge-test');
  store.closeSongsDb();
});

const plan = (songId: number) => planMerge(store.getSong(songId), store.listSectionRows(songId));

describe('병합 계획', () => {
  it('후렴을 각 절 뒤에 붙인다', () => {
    const result = plan(autoSong);
    expect(isSkipped(result)).toBe(false);

    const mergePlan = result as MergePlan;
    expect(mergePlan.verseUpdates).toHaveLength(2);
    for (const update of mergePlan.verseUpdates) {
      expect(update.lines.at(-1)!.text).toBe(CONTINUING.chorus);
    }
  });

  it('원문을 정확히 복원한다 (절 + 후렴 = 원래 인라인 형태)', () => {
    const mergePlan = plan(autoSong) as MergePlan;
    mergePlan.verseUpdates.forEach((update, index) => {
      expect(update.lines.map((line) => line.text).join(' ')).toBe(
        `${CONTINUING.verses[index]} ${CONTINUING.chorus}`,
      );
    });
  });

  it('문장이 이어지는 곡을 표시한다', () => {
    // '…삼위의' + '하나님 …' — 병합이 필수인 곡을 리포트에서 구분할 수 있어야 한다
    expect((plan(autoSong) as MergePlan).continues).toBe(true);
  });

  it('사람이 손본 곡은 건드리지 않는다', () => {
    const result = plan(manualSong);
    expect(isSkipped(result)).toBe(true);
    expect((result as { reason: string }).reason).toContain('사람');
  });

  it('두 언어가 섞인 곡은 건드리지 않는다', () => {
    const result = plan(bilingualSong);
    expect(isSkipped(result)).toBe(true);
    expect((result as { reason: string }).reason).toContain('언어');
  });

  it('후렴이 없으면 건너뛴다', () => {
    expect(isSkipped(plan(noChorusSong))).toBe(true);
  });

  it('계획을 세워도 DB 는 그대로다', () => {
    const before = store.listSectionRows(autoSong);
    plan(autoSong);
    expect(store.listSectionRows(autoSong)).toHaveLength(before.length);
  });
});

describe('병합 적용', () => {
  it('후렴 섹션이 사라지고 절만 남는다', () => {
    const songId = song('auto');
    applyMerge(plan(songId) as MergePlan);

    const sections = store.listSectionRows(songId);
    expect(sections).toHaveLength(2);
    expect(sections.every((section) => section.kind === 'verse')).toBe(true);
    expect(sections.map((section) => section.label)).toEqual(['1절', '2절']);
  });

  it('절마다 후렴이 붙는다', () => {
    const songId = song('auto');
    applyMerge(plan(songId) as MergePlan);

    for (const section of store.listSectionRows(songId)) {
      expect(section.lines.at(-1)!.text).toBe(CONTINUING.chorus);
    }
  });

  it('position 에 구멍이 남지 않는다', () => {
    // 후렴을 지운 뒤 번호를 다시 매기지 않으면 진행 순서가 어긋난다
    const songId = song('auto');
    applyMerge(plan(songId) as MergePlan);

    const loaded = store.getSong(songId)!;
    expect(loaded.sections.map((section) => section.position)).toEqual([0, 1]);
  });

  it('두 번 적용해도 후렴이 두 번 붙지 않는다', () => {
    // 후렴 섹션이 이미 없으므로 두 번째 계획은 건너뛴다
    const songId = song('auto');
    applyMerge(plan(songId) as MergePlan);
    expect(isSkipped(plan(songId))).toBe(true);
  });
});
