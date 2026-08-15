/**
 * 재정렬 안전장치 통합 테스트.
 *
 * 이 기능은 **사용자의 가사를 직접 고쳐 쓴다.** 그래서 검증할 것은 정렬 품질이
 * 아니라 (그건 단위 테스트가 본다) '건드리면 안 되는 것을 건드리지 않는가'다:
 *  - 사람이 손본 섹션
 *  - 두 언어가 섞인 섹션
 *  - 본문 자체 (한 글자도 바뀌면 안 된다)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { changesAnything, isSkipped, planSong, type SongPlan } from '../../scripts/realign-lyrics.ts';
import * as store from '../../server/db/songs.ts';

/** 폭 기준으로 잘못 나뉜 상태 — 가져오기 직후의 실제 모습 */
const BADLY_SPLIT = [
  ['나의 죄 모두 지신 주님 십자가', '모진 그 고통을 묵묵히 참고', '당하셨네 그 은혜 어찌 보답할까'],
  ['흉악한 죄는 내가 짓고 고통은', '주가 당했으니 나 어찌 감히 고개', '들고 주 얼굴 뵐 수 있으리까'],
  ['눈물로 주께 아룁니다 그 피로 이', '몸 사셨으니 충성된 종이 되게', '하사 주 위해 살게 하옵소서'],
];

function verseSections(source: 'auto' | 'manual') {
  return BADLY_SPLIT.map((lines, index) => ({
    kind: 'verse' as const,
    label: `${index + 1}절`,
    lines: lines.map((text, lineIndex) => ({ lineIndex, lang: 'ko' as const, text })),
  }));
}

let autoSong: number;
let manualSong: number;
let bilingualSong: number;

beforeAll(() => {
  store.initSongsDb();
  store.deleteBySource('realign-test');

  autoSong = store.createSong({
    title: '자동 분할된 곡',
    source: 'realign-test',
    entries: [{ songbookId: 'misc' }],
    sections: verseSections('auto'),
    linesSource: 'auto',
  });

  manualSong = store.createSong({
    title: '사람이 손본 곡',
    source: 'realign-test',
    entries: [{ songbookId: 'misc' }],
    sections: verseSections('manual'),
    linesSource: 'manual',
  });

  bilingualSong = store.createSong({
    title: '두 언어 곡',
    source: 'realign-test',
    entries: [{ songbookId: 'misc' }],
    linesSource: 'auto',
    sections: BADLY_SPLIT.map((lines, index) => ({
      kind: 'verse' as const,
      label: `${index + 1}절`,
      lines: [
        ...lines.map((text, lineIndex) => ({ lineIndex, lang: 'ko' as const, text })),
        { lineIndex: 0, lang: 'en' as const, text: 'English line' },
      ],
    })),
  });
});

afterAll(() => {
  store.deleteBySource('realign-test');
  store.closeSongsDb();
});

const plan = (songId: number) => planSong(store.getSong(songId), store.listSectionRows(songId));

describe('재정렬 계획', () => {
  it('자동 분할된 곡은 다시 맞춘다', () => {
    const result = plan(autoSong);
    expect(isSkipped(result)).toBe(false);

    const songPlan = result as SongPlan;
    expect(songPlan.confidence).toBe('high');
    expect(changesAnything(songPlan)).toBe(true);
    // 구가 끊기지 않는다
    expect(songPlan.after[0]).toContain('묵묵히 참고 당하셨네');
    expect(songPlan.after[1]).toContain('나 어찌 감히 고개 들고');
  });

  it('본문을 한 글자도 바꾸지 않는다', () => {
    const songPlan = plan(autoSong) as SongPlan;
    songPlan.after.forEach((lines, index) => {
      expect(lines.join(' ')).toBe(songPlan.before[index]!.join(' '));
    });
  });

  it('사람이 손본 곡은 건드리지 않는다', () => {
    const result = plan(manualSong);
    expect(isSkipped(result)).toBe(true);
    expect((result as { reason: string }).reason).toContain('사람');
  });

  it('두 언어가 섞인 곡은 건드리지 않는다', () => {
    // 줄 짝(lineIndex)이 깨지면 한/영 대응이 무너진다
    const result = plan(bilingualSong);
    expect(isSkipped(result)).toBe(true);
    expect((result as { reason: string }).reason).toContain('언어');
  });

  it('계획을 세워도 DB 는 그대로다', () => {
    const before = store.getSong(autoSong)!;
    plan(autoSong);
    const after = store.getSong(autoSong)!;
    expect(after.sections[0]!.lines.map((l) => l.text)).toEqual(before.sections[0]!.lines.map((l) => l.text));
  });
});

describe('재정렬 적용', () => {
  it('적용하면 줄이 바뀌고 본문은 보존된다', () => {
    const songId = store.createSong({
      title: '적용 대상',
      source: 'realign-test',
      entries: [{ songbookId: 'misc' }],
      sections: verseSections('auto'),
      linesSource: 'auto',
    });

    const songPlan = plan(songId) as SongPlan;
    const originalText = store
      .getSong(songId)!
      .sections.flatMap((section) => section.lines.map((line) => line.text))
      .join(' ');

    songPlan.sectionIds.forEach((sectionId, index) => {
      store.replaceSectionLines(
        sectionId,
        songPlan.after[index]!.map((text, lineIndex) => ({ lineIndex, lang: 'ko' as const, text })),
      );
    });

    const updated = store.getSong(songId)!;
    expect(updated.sections[0]!.lines).toHaveLength(4);
    expect(updated.sections[0]!.lines[2]!.text).toBe('묵묵히 참고 당하셨네');
    // 이어 붙이면 원래 본문과 같다
    expect(updated.sections.flatMap((s) => s.lines.map((l) => l.text)).join(' ')).toBe(originalText);
  });

  it('적용 뒤에도 출처는 auto 로 남는다 (다음 개선 때 다시 계산할 수 있게)', () => {
    const rows = store.listSectionRows(autoSong);
    expect(rows.every((row) => row.linesSource === 'auto')).toBe(true);
  });
});
