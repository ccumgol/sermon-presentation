/**
 * 원본 성경 DB 10개 → 통합 bible.sqlite 빌드.
 *
 * 안전 원칙
 *  1. 원본은 readOnly 로만 연다. ATTACH 도 쓰지 않는다 — 실수로 쓰기가 일어날 여지를 없앤다.
 *  2. 임시 파일에 만든 뒤 마지막에 이름을 바꾼다. 중간에 실패해도 기존 DB 가 살아남는다.
 *  3. 정제로 달라진 절은 text_raw 에 원문을 남긴다. 달라지지 않은 절은 NULL (용량 절약).
 *
 * 실행: npm run bible:build
 */

import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { BOOKS } from '../lib/books.ts';
import { ensureDataDirs, paths } from '../server/paths.ts';
import { findDuplicateFix, pickVariant, SOURCES, type SourceSpec, type SourceVariant } from './bible-sources.ts';
import { readSource, type RawVerse } from './source-reader.ts';

interface BuildStat {
  id: string;
  name: string;
  sourceRows: number;
  inserted: number;
  skippedEmpty: number;
  changedByClean: number;
  headings: number;
  books: number;
  coverage: string[];
  cleanNotes: string;
  /** 실제로 읽은 파일 (폴백이 쓰였는지 리포트에 드러난다) */
  sourceFile: string;
  usedFallback: boolean;
  /** 대체본이 품질 저하본일 때의 사유 */
  degradedReason?: string;
  /** 교정 규칙으로 다른 절 위치로 옮긴 행 */
  repaired: string[];
  /** 근거 없이 버린 중복 행 — 리포트에 반드시 드러난다 */
  droppedDuplicates: string[];
}

interface DiffSample {
  translation: string;
  reference: string;
  before: string;
  after: string;
}

const SCHEMA = `
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE translations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  lang        TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'ltr',
  coverage    TEXT NOT NULL,          -- JSON: ["OT","NT"]
  verse_count INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE books (
  code          INTEGER PRIMARY KEY,
  name_ko       TEXT NOT NULL,
  abbr_ko       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  abbr_en       TEXT NOT NULL,
  -- 개신교 표준 장 수 (개역개정 기준)
  chapter_count INTEGER NOT NULL,
  -- 번들된 역본 중 최대 장 수. 요엘 4장(마소라), 다니엘 14장(공동번역 추가부).
  max_chapter_count INTEGER NOT NULL,
  testament     TEXT NOT NULL
);

-- 역본별 실제 장 수. 장 구분이 역본마다 달라 전역 값으로는 표현할 수 없다.
CREATE TABLE translation_chapters (
  translation_id TEXT NOT NULL REFERENCES translations(id),
  book           INTEGER NOT NULL,
  chapter_count  INTEGER NOT NULL,
  PRIMARY KEY (translation_id, book)
);

CREATE TABLE verses (
  id             INTEGER PRIMARY KEY,
  translation_id TEXT NOT NULL REFERENCES translations(id),
  book           INTEGER NOT NULL,
  chapter        INTEGER NOT NULL,
  verse          INTEGER NOT NULL,
  text           TEXT NOT NULL,
  -- 정제로 달라진 경우에만 원문을 담는다. NULL 이면 text 가 곧 원문이다.
  text_raw       TEXT
);

CREATE TABLE headings (
  translation_id TEXT NOT NULL REFERENCES translations(id),
  book           INTEGER NOT NULL,
  chapter        INTEGER NOT NULL,
  start_verse    INTEGER NOT NULL,
  -- NULL = 장 끝까지. 원본에 실제로 이런 행이 있다 (공동번역 80건, NIV 1건).
  end_verse      INTEGER,
  text           TEXT NOT NULL
);

CREATE TABLE build_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const INDEXES = `
CREATE UNIQUE INDEX idx_verses_ref ON verses(translation_id, book, chapter, verse);
CREATE INDEX idx_verses_chapter ON verses(book, chapter, verse);
CREATE INDEX idx_headings_ref ON headings(translation_id, book, chapter);
`;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** FTS5 토크나이저 후보를 순서대로 시도한다. 환경에 따라 옵션 지원이 다르다. */
function createFts(db: DatabaseSync): string {
  const candidates = [
    "unicode61 remove_diacritics 2",
    "unicode61 remove_diacritics 1",
    'unicode61',
  ];
  for (const tokenize of candidates) {
    try {
      db.exec(
        `CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='id', tokenize='${tokenize}')`,
      );
      return tokenize;
    } catch {
      // 다음 후보로
    }
  }
  throw new Error('FTS5 가상 테이블을 만들 수 없습니다 — SQLite 빌드에 FTS5 가 없습니다');
}

function coverageOf(bookCodes: Set<number>): string[] {
  const out: string[] = [];
  for (const code of bookCodes) {
    if (code <= 39 && !out.includes('OT')) out.push('OT');
    if (code >= 40 && !out.includes('NT')) out.push('NT');
  }
  return out.sort();
}

function referenceOf(row: RawVerse): string {
  const book = BOOKS.find((b) => b.code === row.book);
  return `${book?.abbrKo ?? row.book} ${row.chapter}:${row.verse}`;
}

function importTranslation(
  target: DatabaseSync,
  spec: SourceSpec,
  variant: SourceVariant,
  diffSamples: DiffSample[],
): BuildStat {
  // 읽기는 검증 스크립트와 같은 코드를 쓴다 (source-reader.ts).
  // 원본은 어떤 경우에도 읽기 전용으로만 연다 (계획서 §11).
  const { verses: rows, headings } = readSource(paths.bibleSourceDir, variant);

  {

    // verses/headings 가 translations 를 참조하므로 역본 행을 먼저 만든다.
    // 집계값(coverage, verse_count)은 적재가 끝난 뒤 UPDATE 한다.
    target
      .prepare(
        'INSERT INTO translations (id, name, short_name, lang, direction, coverage, verse_count, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(spec.id, spec.name, spec.shortName, spec.lang, spec.direction, '[]', 0, spec.sortOrder);

    const insertVerse = target.prepare(
      'INSERT INTO verses (translation_id, book, chapter, verse, text, text_raw) VALUES (?, ?, ?, ?, ?, ?)',
    );

    const bookCodes = new Set<number>();
    let inserted = 0;
    let skippedEmpty = 0;
    let changedByClean = 0;
    const sampleQuota = { remaining: 12 };
    const repaired: string[] = [];
    const droppedDuplicates: string[] = [];

    // (책,장,절) 별 등장 횟수. 원본에 유일성 제약이 없어 중복이 존재할 수 있다.
    const occurrences = new Map<string, number>();
    const slotKey = (book: number, chapter: number, verse: number): string => `${book}:${chapter}:${verse}`;

    target.exec('BEGIN');
    for (const row of rows) {
      const raw = row.text ?? '';
      const cleaned = variant.clean(raw);

      if (cleaned.length === 0) {
        // ESV 처럼 사본상 없는 절은 빈 문자열로 들어 있다. 빈 절은 넣지 않는다.
        skippedEmpty++;
        continue;
      }

      let chapter = row.chapter;
      let verse = row.verse;

      const key = slotKey(row.book, chapter, verse);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);

      if (occurrence > 1) {
        const fix = findDuplicateFix(spec.id, row.book, chapter, verse, occurrence);
        const targetKey = fix ? slotKey(row.book, fix.moveTo.chapter, fix.moveTo.verse) : null;

        if (fix && targetKey && !occurrences.has(targetKey)) {
          // 교정: 비어 있는 올바른 자리로 옮긴다
          chapter = fix.moveTo.chapter;
          verse = fix.moveTo.verse;
          occurrences.set(targetKey, 1);
          repaired.push(
            `${referenceOf(row)} (${occurrence}번째 행) → ${chapter}:${verse} — ${fix.reason}`,
          );
        } else {
          // 근거가 없거나 대상 자리가 이미 차 있으면 버리고, 리포트에 남긴다
          droppedDuplicates.push(`${referenceOf(row)} (${occurrence}번째 행): ${cleaned.slice(0, 60)}`);
          continue;
        }
      }

      const changed = cleaned !== raw;
      if (changed) {
        changedByClean++;
        if (sampleQuota.remaining > 0 && raw.trim() !== cleaned) {
          sampleQuota.remaining--;
          diffSamples.push({
            translation: spec.name,
            reference: referenceOf(row),
            before: raw.slice(0, 120),
            after: cleaned.slice(0, 120),
          });
        }
      }

      insertVerse.run(spec.id, row.book, chapter, verse, cleaned, changed ? raw : null);
      bookCodes.add(row.book);
      inserted++;
    }
    target.exec('COMMIT');

    // 소제목
    let headingCount = 0;
    if (headings.length > 0) {
      const insertHeading = target.prepare(
        'INSERT INTO headings (translation_id, book, chapter, start_verse, end_verse, text) VALUES (?, ?, ?, ?, ?, ?)',
      );
      target.exec('BEGIN');
      for (const h of headings) {
        insertHeading.run(spec.id, h.book, h.chapter, h.startVerse ?? 1, h.endVerse ?? null, h.text.trim());
        headingCount++;
      }
      target.exec('COMMIT');
    }

    const coverage = coverageOf(bookCodes);

    target
      .prepare('UPDATE translations SET coverage = ?, verse_count = ? WHERE id = ?')
      .run(JSON.stringify(coverage), inserted, spec.id);

    return {
      id: spec.id,
      name: spec.name,
      sourceRows: rows.length,
      inserted,
      skippedEmpty,
      changedByClean,
      headings: headingCount,
      books: bookCodes.size,
      coverage,
      cleanNotes: variant.cleanNotes,
      sourceFile: variant.file,
      usedFallback: variant.file !== spec.file,
      ...(variant.degraded ? { degradedReason: variant.degraded } : {}),
      repaired,
      droppedDuplicates,
    };
  }
}

function writeReport(stats: BuildStat[], diffSamples: DiffSample[], tokenizer: string, elapsedMs: number): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(paths.reportsDir, `bible-build-${stamp}.md`);

  const lines: string[] = [
    '# 성경 DB 빌드 리포트',
    '',
    `- 생성 시각: ${now.toISOString()}`,
    `- 원본 폴더: \`${paths.bibleSourceDir}\` (읽기 전용)`,
    `- 산출물: \`${paths.bibleDb}\``,
    `- FTS5 토크나이저: \`${tokenizer}\``,
    `- 소요 시간: ${(elapsedMs / 1000).toFixed(1)}초`,
    '',
    '## 역본별 통계',
    '',
    '| 역본 | 원본 파일 | 원본 행 | 삽입 | 빈 절 제외 | 정제로 변경 | 소제목 | 권수 | 범위 |',
    '|------|-----------|--------:|-----:|-----------:|------------:|-------:|-----:|------|',
  ];

  for (const s of stats) {
    const file = s.usedFallback ? `${s.sourceFile} (폴백)` : s.sourceFile;
    lines.push(
      `| ${s.name} | \`${file}\` | ${s.sourceRows.toLocaleString()} | ${s.inserted.toLocaleString()} | ${s.skippedEmpty} | ${s.changedByClean.toLocaleString()} | ${s.headings.toLocaleString()} | ${s.books} | ${s.coverage.join('+')} |`,
    );
  }

  const fallbacks = stats.filter((s) => s.usedFallback);
  if (fallbacks.length > 0) {
    lines.push(
      '',
      '> ⚠️ 주 원본 파일이 없어 대체본을 사용한 역본이 있습니다: ' +
        fallbacks.map((s) => `${s.name} → \`${s.sourceFile}\``).join(', '),
    );
    for (const s of fallbacks) {
      if (s.degradedReason) lines.push('>', `> **${s.name} 본문 품질 저하** — ${s.degradedReason}`);
    }
  }

  lines.push('', '## 정제 규칙', '');
  for (const s of stats) {
    lines.push(`- **${s.name}**: ${s.cleanNotes}`);
  }

  const repairs = stats.filter((s) => s.repaired.length > 0);
  const drops = stats.filter((s) => s.droppedDuplicates.length > 0);

  lines.push('', '## 원본 데이터 교정', '');
  if (repairs.length === 0) {
    lines.push('교정한 항목이 없습니다.');
  } else {
    for (const s of repairs) {
      lines.push(`### ${s.name}`, '');
      for (const item of s.repaired) lines.push(`- ${item}`);
      lines.push('');
    }
  }

  lines.push('', '## 버린 중복 행', '');
  if (drops.length === 0) {
    lines.push('없습니다.');
  } else {
    lines.push(
      '아래 행들은 (책,장,절)이 앞선 행과 겹치고 교정 근거가 없어 제외했다.',
      '내용을 확인한 뒤 `scripts/bible-sources.ts` 의 `DUPLICATE_FIXES` 에 근거와 함께 추가할 것.',
      '',
    );
    for (const s of drops) {
      lines.push(`### ${s.name}`, '');
      for (const item of s.droppedDuplicates) lines.push(`- ${item}`);
      lines.push('');
    }
  }

  lines.push(
    '',
    '## 정제 전/후 샘플',
    '',
    '표시용 정제가 본문을 훼손하지 않았는지 눈으로 확인하기 위한 목록이다.',
    '원문은 `verses.text_raw` 에 그대로 남아 있어 언제든 대조할 수 있다.',
    '',
  );
  for (const d of diffSamples) {
    lines.push(`### ${d.translation} ${d.reference}`, '', `- 전: \`${d.before}\``, `- 후: \`${d.after}\``, '');
  }

  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

// ── 실행 ───────────────────────────────────────────────────────

const startedAt = Date.now();
ensureDataDirs();

const tmpPath = `${paths.bibleDb}.building`;
if (existsSync(tmpPath)) rmSync(tmpPath);

log(`원본 폴더: ${paths.bibleSourceDir}`);
log(`빌드 대상: ${tmpPath}`);
log('');

// 준비 검사 — 없는 파일을 한 번에 모아 알린다.
// 첫 파일에서 죽으면 다른 PC 에 설치할 때 무엇을 더 챙겨야 하는지 알 수 없다.
const fileExists = (file: string): boolean => existsSync(path.join(paths.bibleSourceDir, file));
const resolved = SOURCES.map((spec) => ({ spec, variant: pickVariant(spec, fileExists) }));
const missing = resolved.filter((r) => r.variant === undefined);

if (missing.length > 0) {
  log('원본 DB 를 찾을 수 없습니다:');
  for (const { spec } of missing) {
    const candidates = [spec.file, spec.fallback?.file].filter(Boolean).join(' 또는 ');
    log(`  - ${spec.name}: ${candidates}`);
  }
  log('');
  log(`폴더를 확인하세요: ${paths.bibleSourceDir}`);
  log('다른 경로면 BIBLE_DB_DIR 환경변수로 지정할 수 있습니다.');
  process.exit(1);
}

for (const { spec, variant } of resolved) {
  if (variant && variant.file !== spec.file) {
    log(`  ⚠️  ${spec.name}: ${spec.file} 가 없어 ${variant.file} 로 대체합니다`);
    if (variant.degraded) {
      log(`      본문 품질 저하: ${variant.degraded}`);
    }
  }
}

const db = new DatabaseSync(tmpPath);

try {
  db.exec(SCHEMA);

  const insertBook = db.prepare(
    'INSERT INTO books (code, name_ko, abbr_ko, name_en, abbr_en, chapter_count, max_chapter_count, testament) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  for (const b of BOOKS) {
    insertBook.run(b.code, b.nameKo, b.abbrKo, b.nameEn, b.abbrEn, b.chapters, b.maxChapters, b.testament);
  }
  db.exec('COMMIT');
  log(`성경책 메타 ${BOOKS.length}권 기록`);

  const stats: BuildStat[] = [];
  const diffSamples: DiffSample[] = [];

  for (const { spec, variant } of resolved) {
    const t0 = Date.now();
    const stat = importTranslation(db, spec, variant!, diffSamples);
    stats.push(stat);
    log(
      `  ${spec.name.padEnd(14)} ${stat.inserted.toLocaleString().padStart(7)}절` +
        `  소제목 ${String(stat.headings).padStart(5)}` +
        `  정제 ${String(stat.changedByClean).padStart(5)}` +
        `  ${((Date.now() - t0) / 1000).toFixed(1)}초`,
    );
    for (const item of stat.repaired) log(`      ↳ 교정: ${item.split(' — ')[0]}`);
    for (const item of stat.droppedDuplicates) log(`      ↳ 중복 제외: ${item}`);
  }

  log('');
  log('역본별 장 수 집계 중…');
  db.exec(`
    INSERT INTO translation_chapters (translation_id, book, chapter_count)
    SELECT translation_id, book, max(chapter) FROM verses GROUP BY translation_id, book
  `);

  log('전문검색 인덱스 생성 중…');
  const tokenizer = createFts(db);
  db.exec("INSERT INTO verses_fts(rowid, text) SELECT id, text FROM verses");

  db.exec(INDEXES);

  const totalVerses = (db.prepare('SELECT count(*) AS c FROM verses').get() as { c: number }).c;
  const insertInfo = db.prepare('INSERT INTO build_info (key, value) VALUES (?, ?)');
  insertInfo.run('built_at', new Date().toISOString());
  insertInfo.run('source_dir', paths.bibleSourceDir);
  insertInfo.run('translation_count', String(stats.length));
  insertInfo.run('verse_count', String(totalVerses));
  insertInfo.run('fts_tokenizer', tokenizer);

  db.exec('PRAGMA optimize');
  db.close();

  // 성공했을 때에만 기존 파일을 대체한다
  if (existsSync(paths.bibleDb)) rmSync(paths.bibleDb);
  renameSync(tmpPath, paths.bibleDb);

  const elapsed = Date.now() - startedAt;
  const reportPath = writeReport(stats, diffSamples, tokenizer, elapsed);

  log('');
  log(`완료: ${totalVerses.toLocaleString()}절 / ${stats.length}역본`);
  log(`산출물: ${paths.bibleDb}`);
  log(`리포트: ${reportPath}`);
} catch (err) {
  try {
    db.close();
  } catch {
    // 이미 닫혀 있으면 무시
  }
  if (existsSync(tmpPath)) rmSync(tmpPath);
  log('');
  log(`빌드 실패: ${err instanceof Error ? err.message : String(err)}`);
  log('기존 bible.sqlite 는 변경되지 않았습니다.');
  process.exitCode = 1;
}
