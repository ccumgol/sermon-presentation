/**
 * bible.sqlite 무결성 검증. 빌드 직후 반드시 돌린다.
 *
 * 본문은 예배에 그대로 나가므로 "빌드가 에러 없이 끝났다"로는 부족하다.
 * 원본과 직접 대조해 한 글자도 달라지지 않았음을 확인한다.
 *
 * 실행: npm run bible:verify
 * 실패가 하나라도 있으면 종료 코드 1.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { BOOKS } from '../lib/books.ts';
import { paths } from '../server/paths.ts';
import { DUPLICATE_FIXES, pickVariant, SOURCES } from './bible-sources.ts';
import { readSource } from './source-reader.ts';

/** 원문 대조 표본 수 (계획서 §10: 무작위 200절) */
const SAMPLE_SIZE = 200;

/** 재현 가능한 무작위 표본을 위한 고정 시드 LCG */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Level = 'pass' | 'warn' | 'fail';

interface Check {
  name: string;
  level: Level;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, level: Level, detail: string): void {
  checks.push({ name, level, detail });
  const mark = level === 'pass' ? '✓' : level === 'warn' ? '!' : '✗';
  process.stdout.write(`${mark} ${name}\n`);
  if (level !== 'pass') process.stdout.write(`    ${detail.replace(/\n/g, '\n    ')}\n`);
}

if (!existsSync(paths.bibleDb)) {
  process.stdout.write(`bible.sqlite 가 없습니다: ${paths.bibleDb}\n먼저 npm run bible:build 를 실행하세요.\n`);
  process.exit(1);
}

const db = new DatabaseSync(paths.bibleDb, { readOnly: true });

// ── 1. 성경책 메타 ─────────────────────────────────────────────
{
  const rows = db.prepare('SELECT count(*) AS c, sum(chapter_count) AS chapters FROM books').get() as {
    c: number;
    chapters: number;
  };
  const expectedChapters = BOOKS.reduce((sum, b) => sum + b.chapters, 0);
  if (rows.c === 66 && rows.chapters === expectedChapters && expectedChapters === 1189) {
    record('성경책 메타 66권 · 총 1,189장', 'pass', '');
  } else {
    record('성경책 메타', 'fail', `권수 ${rows.c} (기대 66), 장 합계 ${rows.chapters} (기대 1189)`);
  }
}

// ── 2. 역본 목록 ───────────────────────────────────────────────
interface TranslationRow {
  id: string;
  name: string;
  verse_count: number;
  coverage: string;
}

const translations = db
  .prepare('SELECT id, name, verse_count, coverage FROM translations ORDER BY sort_order')
  .all() as unknown as TranslationRow[];

if (translations.length === SOURCES.length) {
  record(`역본 ${translations.length}개 등록`, 'pass', '');
} else {
  record('역본 수', 'fail', `${translations.length}개 (기대 ${SOURCES.length}개)`);
}

// ── 3. 역본별 절 수가 실제 저장된 행 수와 일치하는지 ────────────
for (const t of translations) {
  const actual = (
    db.prepare('SELECT count(*) AS c FROM verses WHERE translation_id = ?').get(t.id) as { c: number }
  ).c;
  if (actual === t.verse_count) {
    record(`${t.name}: ${actual.toLocaleString()}절 (메타와 일치)`, 'pass', '');
  } else {
    record(`${t.name} 절 수 불일치`, 'fail', `verses 테이블 ${actual}, translations.verse_count ${t.verse_count}`);
  }
}

// ── 4. 빈 본문 ─────────────────────────────────────────────────
{
  const empty = (
    db.prepare("SELECT count(*) AS c FROM verses WHERE text IS NULL OR trim(text) = ''").get() as { c: number }
  ).c;
  record(
    '빈 본문 없음',
    empty === 0 ? 'pass' : 'fail',
    empty === 0 ? '' : `${empty}개의 빈 절이 있습니다`,
  );
}

// ── 5. 장 번호 상한 ────────────────────────────────────────────
// 역본마다 장 구분이 다르다(요엘 마소라 4장, 공동번역 다니엘 14장).
// 따라서 books.max_chapter_count 를 상한으로 보고, 표준(chapter_count)을
// 넘어서는 역본은 알려진 사유가 있는지 확인만 한다.
{
  const overflow = db
    .prepare(
      `SELECT v.translation_id, v.book, max(v.chapter) AS maxch, b.chapter_count, b.max_chapter_count
       FROM verses v JOIN books b ON b.code = v.book
       GROUP BY v.translation_id, v.book
       HAVING maxch > b.max_chapter_count`,
    )
    .all() as unknown as Array<{ translation_id: string; book: number; maxch: number; max_chapter_count: number }>;

  if (overflow.length === 0) {
    record('모든 장 번호가 허용 상한 안 (max_chapter_count)', 'pass', '');
  } else {
    record(
      '장 번호 초과',
      'fail',
      overflow
        .map((r) => `${r.translation_id} book=${r.book} 최대 ${r.maxch}장 > 상한 ${r.max_chapter_count}장`)
        .join('\n') + '\n새로 발견된 장 구분 차이라면 lib/books.ts 의 CHAPTER_VARIANTS 에 근거와 함께 추가하세요.',
    );
  }

  const variants = db
    .prepare(
      `SELECT v.translation_id, b.name_ko, max(v.chapter) AS maxch, b.chapter_count
       FROM verses v JOIN books b ON b.code = v.book
       GROUP BY v.translation_id, v.book
       HAVING maxch > b.chapter_count
       ORDER BY v.translation_id, v.book`,
    )
    .all() as unknown as Array<{ translation_id: string; name_ko: string; maxch: number; chapter_count: number }>;

  record(
    `표준과 다른 장 구분 ${variants.length}건 (문서화된 차이)`,
    'pass',
    '',
  );
  for (const v of variants) {
    process.stdout.write(`    · ${v.translation_id} ${v.name_ko}: ${v.maxch}장 (표준 ${v.chapter_count}장)\n`);
  }
}

// ── 6. 전권 역본은 66권 전부, 원어는 해당 범위만 ───────────────
for (const t of translations) {
  const coverage = JSON.parse(t.coverage) as string[];
  const bookCount = (
    db.prepare('SELECT count(DISTINCT book) AS c FROM verses WHERE translation_id = ?').get(t.id) as { c: number }
  ).c;
  const expected = coverage.includes('OT') && coverage.includes('NT') ? 66 : coverage.includes('OT') ? 39 : 27;

  if (bookCount === expected) {
    record(`${t.name}: ${bookCount}권 (${coverage.join('+')})`, 'pass', '');
  } else {
    record(`${t.name} 권수`, 'fail', `${bookCount}권, ${coverage.join('+')} 범위에서 기대한 값은 ${expected}권`);
  }
}

// ── 7. 원문 대조 — 무작위 표본을 원본 DB 와 직접 비교 ──────────
{
  // 교정으로 자리를 옮긴 절은 원본의 같은 자리에 없으므로 표본에서 제외한다
  const movedSlots = new Set(
    DUPLICATE_FIXES.map((f) => `${f.translationId}:${f.book}:${f.moveTo.chapter}:${f.moveTo.verse}`),
  );

  const rand = makeRandom(20260812);
  let compared = 0;
  let rawMismatch = 0;
  let cleanMismatch = 0;
  let notFound = 0;
  const failures: string[] = [];

  const fileExists = (file: string): boolean => existsSync(path.join(paths.bibleSourceDir, file));

  for (const spec of SOURCES) {
    // 빌드와 같은 규칙으로 원본 파일을 고른다. 다르면 대조가 무의미해진다.
    const variant = pickVariant(spec, fileExists);
    if (!variant) {
      record(`${spec.name} 원본 파일`, 'fail', `찾을 수 없음: ${spec.file}`);
      continue;
    }

    // 빌드와 완전히 같은 코드로 읽는다 — 다르게 읽으면 대조가 무의미해진다
    {
      const { verses: sourceRows } = readSource(paths.bibleSourceDir, variant);

      // 원본을 (책,장,절) → 원문 으로 색인. 중복은 첫 행 우선(빌드와 같은 규칙).
      const index = new Map<string, string>();
      for (const r of sourceRows) {
        const key = `${r.book}:${r.chapter}:${r.verse}`;
        if (!index.has(key)) index.set(key, r.text ?? '');
      }

      const stored = db
        .prepare('SELECT book, chapter, verse, text, text_raw FROM verses WHERE translation_id = ?')
        .all(spec.id) as unknown as Array<{
        book: number;
        chapter: number;
        verse: number;
        text: string;
        text_raw: string | null;
      }>;

      const perTranslation = Math.ceil(SAMPLE_SIZE / SOURCES.length);
      for (let i = 0; i < perTranslation && stored.length > 0; i++) {
        const row = stored[Math.floor(rand() * stored.length)]!;
        const slot = `${spec.id}:${row.book}:${row.chapter}:${row.verse}`;
        if (movedSlots.has(slot)) continue;

        const sourceText = index.get(`${row.book}:${row.chapter}:${row.verse}`);
        if (sourceText === undefined) {
          notFound++;
          failures.push(`${spec.name} ${row.book} ${row.chapter}:${row.verse} — 원본에 없음`);
          continue;
        }

        compared++;

        // 저장된 원문(text_raw)이 있으면 원본과 정확히 같아야 한다
        if (row.text_raw !== null && row.text_raw !== sourceText) {
          rawMismatch++;
          failures.push(`${spec.name} ${row.book} ${row.chapter}:${row.verse} — text_raw 가 원본과 다름`);
        }

        // 정제 규칙을 원본에 다시 적용하면 저장된 text 와 같아야 한다
        if (variant.clean(sourceText) !== row.text) {
          cleanMismatch++;
          failures.push(
            `${spec.name} ${row.book} ${row.chapter}:${row.verse}\n  저장: ${row.text.slice(0, 80)}\n  재정제: ${variant.clean(sourceText).slice(0, 80)}`,
          );
        }
      }
    }
  }

  const total = rawMismatch + cleanMismatch + notFound;
  if (total === 0) {
    record(`원문 대조 ${compared}절 — 전부 일치`, 'pass', '');
  } else {
    record(
      `원문 대조 ${compared}절 중 ${total}건 불일치`,
      'fail',
      failures.slice(0, 10).join('\n') + (failures.length > 10 ? `\n… 외 ${failures.length - 10}건` : ''),
    );
  }
}

// ── 8. 절 누락(구멍) 검사 ──────────────────────────────────────
{
  const gaps = db
    .prepare(
      `SELECT translation_id, book, chapter, max(verse) AS maxv, count(*) AS cnt
       FROM verses GROUP BY translation_id, book, chapter
       HAVING maxv <> cnt`,
    )
    .all() as unknown as Array<{ translation_id: string; book: number; chapter: number; maxv: number; cnt: number }>;

  if (gaps.length === 0) {
    record('절 번호 연속성 — 구멍 없음', 'pass', '');
  } else {
    // ESV 처럼 사본상 없는 절이 있는 역본은 정상적으로 구멍이 생긴다 → 경고
    const summary = new Map<string, number>();
    for (const g of gaps) summary.set(g.translation_id, (summary.get(g.translation_id) ?? 0) + 1);
    record(
      '절 번호에 구멍이 있는 장',
      'warn',
      [...summary].map(([id, n]) => `${id}: ${n}개 장`).join(', ') +
        '\n사본상 없는 절(ESV 15절 등)은 정상입니다. 위 목록이 예상과 다르면 확인하세요.',
    );
  }
}

// ── 9. 소제목 참조 정합성 ──────────────────────────────────────
{
  const orphans = (
    db
      .prepare(
        `SELECT count(*) AS c FROM headings h
         WHERE NOT EXISTS (
           SELECT 1 FROM verses v
           WHERE v.translation_id = h.translation_id AND v.book = h.book AND v.chapter = h.chapter
         )`,
      )
      .get() as { c: number }
  ).c;

  const totalHeadings = (db.prepare('SELECT count(*) AS c FROM headings').get() as { c: number }).c;
  record(
    `소제목 ${totalHeadings.toLocaleString()}건 — 본문 참조 정합`,
    orphans === 0 ? 'pass' : 'fail',
    orphans === 0 ? '' : `${orphans}건이 존재하지 않는 장을 가리킵니다`,
  );
}

// ── 10-a. FTS 어절 검색 (영어·원어) ────────────────────────────
{
  const cases: Array<[string, string, string]> = [
    ['niv', 'love', 'NIV 어절 검색'],
    ['kjv', 'shepherd', 'KJV 어절 검색'],
    ['grk', 'θεός', '헬라어 어절 검색'],
  ];

  for (const [translationId, term, label] of cases) {
    try {
      const hits = (
        db
          .prepare(
            `SELECT count(*) AS c FROM verses_fts f
             JOIN verses v ON v.id = f.rowid
             WHERE f.text MATCH ? AND v.translation_id = ?`,
          )
          .get(term, translationId) as { c: number }
      ).c;
      record(`${label}: '${term}' ${hits.toLocaleString()}건`, hits > 0 ? 'pass' : 'fail', hits > 0 ? '' : '결과 0건');
    } catch (err) {
      record(label, 'fail', err instanceof Error ? err.message : String(err));
    }
  }
}

// ── 10-b. 한국어 부분일치 검색 ─────────────────────────────────
//
// FTS5 unicode61 은 한국어를 어절 단위로만 쪼갠다. '사랑' 으로 찾으면
// '사랑하사'·'사랑은' 이 걸리지 않아 개역개정에서 26건만 나온다(정답 557건).
// trigram 토크나이저는 3글자 미만 질의를 지원하지 않아 2음절 한국어 검색에 못 쓴다.
// 따라서 한국어 역본은 LIKE 부분일치를 쓴다 — 역본 1개당 약 20ms 로 충분히 빠르다.
{
  const cases: Array<[string, string, number]> = [
    ['nkrv', '사랑', 100],
    ['nkrv', '하나님의 사랑', 1],
    ['snkv', '은혜', 100],
  ];

  for (const [translationId, term, minimum] of cases) {
    const hits = (
      db
        .prepare('SELECT count(*) AS c FROM verses WHERE translation_id = ? AND text LIKE ?')
        .get(translationId, `%${term}%`) as { c: number }
    ).c;
    record(
      `한국어 부분일치 ${translationId} '${term}' ${hits.toLocaleString()}건`,
      hits >= minimum ? 'pass' : 'fail',
      hits >= minimum ? '' : `${minimum}건 이상을 기대했습니다`,
    );
  }

  // FTS 로는 부족하다는 사실 자체를 고정해 둔다. 이 관계가 깨지면 전략을 재검토해야 한다.
  const ftsHits = (
    db
      .prepare(
        "SELECT count(*) AS c FROM verses_fts f JOIN verses v ON v.id=f.rowid WHERE f.text MATCH '사랑' AND v.translation_id='nkrv'",
      )
      .get() as { c: number }
  ).c;
  const likeHits = (
    db
      .prepare("SELECT count(*) AS c FROM verses WHERE translation_id='nkrv' AND text LIKE '%사랑%'")
      .get() as { c: number }
  ).c;

  record(
    `한국어는 LIKE 가 FTS 보다 넓게 찾는다 (FTS ${ftsHits} < LIKE ${likeHits})`,
    likeHits > ftsHits ? 'pass' : 'fail',
    likeHits > ftsHits ? '' : 'FTS 가 LIKE 이상을 찾았습니다 — 검색 전략을 재검토하세요',
  );
}

// ── 11. 알려진 본문 정확성 스팟 체크 ───────────────────────────
{
  const spots: Array<[string, number, number, number, string]> = [
    ['nkrv', 43, 3, 16, '하나님이 세상을 이처럼 사랑하사'],
    // 현대인의성경 — 의역 성경이라 문장이 다르다. DB 에서 그대로 옮긴 값이다.
    ['klb', 43, 3, 16, '하나님이 세상을 무척 사랑하셔서'],
    ['klb', 1, 1, 1, '태초에 하나님이 우주를 창조하셨다'],
    ['nkrv', 1, 1, 1, '태초에 하나님이 천지를 창조하시니라'],
    ['niv', 43, 3, 16, 'For God so loved the world'],
    ['esv', 1, 1, 1, 'In the beginning, God created'],
    // KJV 의 [ ] 는 번역자 보충어 표기로, 일부러 보존한다
    ['kjv', 19, 23, 1, 'The LORD [is] my shepherd'],
    ['heb', 1, 1, 1, 'בְּרֵאשִׁ֖ית'],
    ['grk', 43, 1, 1, 'ἀρχῇ'],
    // 빌드에서 교정한 절 (에스더 3:12)
    ['heb', 17, 3, 12, 'הָרִאשׁ'],
    // 역본별 장 구분 차이가 실제로 조회되는지
    ['heb', 29, 4, 1, 'הָהֵ֖מָּה'],
    ['nctb', 27, 13, 1, '요야킴'],
  ];

  const failures: string[] = [];
  for (const [translationId, book, chapter, verse, expected] of spots) {
    const row = db
      .prepare('SELECT text FROM verses WHERE translation_id=? AND book=? AND chapter=? AND verse=?')
      .get(translationId, book, chapter, verse) as { text: string } | undefined;

    if (!row) {
      failures.push(`${translationId} ${book} ${chapter}:${verse} — 절이 없음`);
      continue;
    }

    // 히브리어·헬라어는 결합 문자 순서가 달라질 수 있어 NFC 로 정규화해 비교한다.
    // (소스 코드의 리터럴과 DB 의 정규화 형태가 다르면 눈으로는 같아도 !== 가 된다)
    const text = row.text.normalize('NFC');
    if (!text.includes(expected.normalize('NFC'))) {
      failures.push(`${translationId} ${book} ${chapter}:${verse} — '${expected}' 미포함: ${row.text.slice(0, 60)}`);
    }
  }

  record(
    `알려진 본문 ${spots.length}건 스팟 체크`,
    failures.length === 0 ? 'pass' : 'fail',
    failures.join('\n'),
  );
}

// ── 12. 정제 흔적이 남아 있지 않은지 ───────────────────────────
{
  const residue: Array<[string, string, string]> = [
    ['한국어 역본에 문단 기호(○) 잔존', "text LIKE '%○%'", ''],
    ['HTML 태그 잔존', "text LIKE '%<%' AND text LIKE '%>%'", ''],
    ['HTML 엔티티 잔존', "text LIKE '%&quot;%' OR text LIKE '%&apos;%' OR text LIKE '%&mdash;%'", ''],
  ];

  for (const [label, condition] of residue) {
    const rows = db
      .prepare(`SELECT translation_id, book, chapter, verse, substr(text,1,60) AS t FROM verses WHERE ${condition} LIMIT 5`)
      .all() as unknown as Array<{ translation_id: string; book: number; chapter: number; verse: number; t: string }>;
    const count = (db.prepare(`SELECT count(*) AS c FROM verses WHERE ${condition}`).get() as { c: number }).c;

    record(
      label.replace(' 잔존', ' 제거 확인'),
      count === 0 ? 'pass' : 'fail',
      count === 0
        ? ''
        : `${count}건 발견\n` + rows.map((r) => `${r.translation_id} ${r.book} ${r.chapter}:${r.verse}: ${r.t}`).join('\n'),
    );
  }
}

// ── 12-b. 영어 역본의 신명사문자 표기 보존 ─────────────────────
//
// 영어 성경에서 LORD(대문자)는 신명사문자 YHWH 를, Lord 는 Adonai 를 옮긴 것으로
// 구별이 의미를 갖는다. 원본 폴더의 14_ESV.db 는 작은대문자 조판을 평문으로 풀면서
// 이 구별을 전부 잃었다(5,566절 → 0절). 잘못된 파일을 쓰면 여기서 걸린다.
{
  const cases: Array<[string, number]> = [
    ['kjv', 1000],
    ['esv', 1000],
  ];

  for (const [translationId, minimum] of cases) {
    const withLord = (
      db
        .prepare(
          `SELECT count(*) AS c FROM verses
           WHERE translation_id = ? AND text GLOB '*LORD*' AND text NOT GLOB '*LORDS*'`,
        )
        .get(translationId) as { c: number }
    ).c;

    record(
      `${translationId.toUpperCase()} 신명사문자 LORD 표기 ${withLord.toLocaleString()}절`,
      withLord >= minimum ? 'pass' : 'fail',
      withLord >= minimum
        ? ''
        : `${minimum}절 이상을 기대했습니다. 원본 파일이 LORD/Lord 구별을 잃은 판본일 수 있습니다 ` +
          `(docs/KNOWN-DATA-ISSUES.md §4 참고 — 14_ESV.db 가 그런 경우입니다)`,
    );
  }

  // 작은대문자를 평문으로 풀 때 생기는 '구두점 앞 공백' 흔적
  const spacing = (
    db
      .prepare(
        `SELECT count(*) AS c FROM verses
         WHERE translation_id IN ('esv','kjv','niv')
           AND (text LIKE '% ,%' OR text LIKE '% ;%' OR text LIKE '% .%')`,
      )
      .get() as { c: number }
  ).c;

  record(
    '영어 역본에 구두점 앞 공백 없음',
    spacing === 0 ? 'pass' : 'fail',
    spacing === 0 ? '' : `${spacing}절에 'the Lord ,' 형태의 공백 오류가 있습니다 — 원본 파일을 확인하세요`,
  );
}

// ── 13. 원본 KJV 의 앞부분 잘림 (알려진 원본 결함) ─────────────
//
// 원본 KJV.db 자체에 절 앞부분이 잘려 저장된 행이 있다.
// 예: 시 23:1 이 "of David. The LORD [is] my shepherd" — "A Psalm " 가 없다.
// 우리 빌드가 만든 문제가 아니고(원본에서 동일하게 확인) 데이터만으로 복원할 수 없다.
// 실패로 처리하면 영구히 빨간불이 되므로, 건수를 추적해 늘어나면 알아채도록 경고로 둔다.
{
  // 현재 확인된 건수. 이보다 늘어나면 빌드가 새 문제를 만들었다는 뜻이므로 실패로 본다.
  const KNOWN_KJV_TRUNCATED = 158;

  const count = (
    db
      .prepare("SELECT count(*) AS c FROM verses WHERE translation_id='kjv' AND (text GLOB '[a-z]*' OR text GLOB ',*')")
      .get() as { c: number }
  ).c;

  const samples = db
    .prepare(
      "SELECT book, chapter, verse, substr(text,1,55) AS t FROM verses WHERE translation_id='kjv' AND (text GLOB '[a-z]*' OR text GLOB ',*') LIMIT 4",
    )
    .all() as unknown as Array<{ book: number; chapter: number; verse: number; t: string }>;

  const detail =
    `${count}건 (기준치 ${KNOWN_KJV_TRUNCATED}건)\n` +
    samples.map((s) => `${s.book} ${s.chapter}:${s.verse}: ${s.t}`).join('\n') +
    '\n원본 KJV.db 의 결함이며 데이터만으로 복원할 수 없습니다. docs/KNOWN-DATA-ISSUES.md 참고.';

  record(
    `KJV 앞부분 잘린 절 ${count}건 (원본 결함)`,
    count > KNOWN_KJV_TRUNCATED ? 'fail' : 'warn',
    detail,
  );
}

db.close();

// ── 결과 ───────────────────────────────────────────────────────
const failed = checks.filter((c) => c.level === 'fail');
const warned = checks.filter((c) => c.level === 'warn');

process.stdout.write('\n');
process.stdout.write(
  `검사 ${checks.length}건 — 통과 ${checks.length - failed.length - warned.length}, 경고 ${warned.length}, 실패 ${failed.length}\n`,
);

if (failed.length > 0) {
  process.stdout.write('\n실패한 검사:\n');
  for (const f of failed) process.stdout.write(`  - ${f.name}\n`);
  process.exitCode = 1;
}
