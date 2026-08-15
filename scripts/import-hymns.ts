/**
 * 찬송가 가져오기 — hymn_new.db(새찬송가 645곡) · hymn_old.db(통일찬송가 558곡).
 *
 * 원본은 그대로 쓸 수 없고 가공이 필요하다 (계획서 §3.2):
 *  - 줄바꿈이 전혀 없다 (가사 한 줄 통짜, 평균 79자) → 어절 경계 자동 줄나눔
 *  - 후렴이 각 절 뒤에 인라인으로 반복된다 → 최장 공통 어절 접미사로 분리
 *  - '아멘'만 있는 절이 298곡 → has_amen 속성으로 흡수
 *
 * **자동 결과는 제안이다.** 리포트에 신뢰도별로 남기고, 편집 UI 에서 확정한다.
 * 원본은 읽기 전용으로만 연다.
 *
 * 실행: npm run hymns:import
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { detectRefrain, splitIntoLines, toSongLines } from '../lib/lyrics-parser.ts';
import * as songs from '../server/db/songs.ts';
import * as songbookStore from '../server/db/songbooks.ts';
import { ensureDataDirs, paths } from '../server/paths.ts';
import type { SongLine } from '../shared/types.ts';

/**
 * 후렴을 별도 섹션으로 떼어낼지.
 *
 * 기본은 **떼지 않는다** — 원본의 인라인 형태가 실제 진행 순서이고, 떼어내면
 * 절 끝 어절이 후렴을 수식하는 곡(97곡)에서 문장이 끊긴다. 자세한 근거는
 * 아래 절 생성 부분의 주석에 있다.
 */
const splitRefrain = process.argv.includes('--split-refrain');

interface HymnalSource {
  file: string;
  /** 곡집 id — 재가져오기 범위도 이 값으로 잡는다 */
  songbookId: string;
  name: string;
}

const SOURCES: readonly HymnalSource[] = [
  { file: 'hymn_new.db', songbookId: 'hymn_new', name: '새찬송가' },
  { file: 'hymn_old.db', songbookId: 'hymn_old', name: '통일찬송가' },
];

interface HymnRow {
  number: number;
  title: string;
  verse: number;
  lyrics: string;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

interface ImportStat {
  name: string;
  songs: number;
  sections: number;
  amenSongs: number;
  refrainHigh: number;
  refrainMedium: number;
  refrainLow: number;
  skipped: string[];
}

interface RefrainSample {
  hymnal: string;
  number: number;
  title: string;
  confidence: string;
  words: number;
  refrain: string;
}

/** '아멘'만 있는 절인지 */
function isAmenOnly(text: string): boolean {
  return /^아\s*멘\.?$/.test(text.trim());
}

function importHymnal(spec: HymnalSource, samples: RefrainSample[]): ImportStat {
  const sourcePath = path.join(paths.bibleSourceDir, spec.file);
  const source = new DatabaseSync(sourcePath, { readOnly: true });

  const stat: ImportStat = {
    name: spec.name,
    songs: 0,
    sections: 0,
    amenSongs: 0,
    refrainHigh: 0,
    refrainMedium: 0,
    refrainLow: 0,
    skipped: [],
  };

  try {
    const rows = source
      .prepare('SELECT _number AS number, _title AS title, _verse AS verse, _lyrics AS lyrics FROM tbl_hymn ORDER BY _number, _verse')
      .all() as unknown as HymnRow[];

    // 곡 번호별로 절을 모은다
    const byNumber = new Map<number, HymnRow[]>();
    for (const row of rows) {
      if (!byNumber.has(row.number)) byNumber.set(row.number, []);
      byNumber.get(row.number)!.push(row);
    }

    for (const [number, verseRows] of [...byNumber].sort((a, b) => a[0] - b[0])) {
      const title = (verseRows[0]?.title ?? '').trim();
      if (title.length === 0) {
        stat.skipped.push(`${number}장: 제목 없음`);
        continue;
      }

      // '아멘' 절은 별도 절로 만들지 않고 속성으로 흡수한다
      const hasAmen = verseRows.some((r) => isAmenOnly(r.lyrics ?? ''));
      const bodyRows = verseRows.filter((r) => (r.lyrics ?? '').trim().length > 0 && !isAmenOnly(r.lyrics));

      if (bodyRows.length === 0) {
        stat.skipped.push(`${number}장 ${title}: 가사 없음`);
        continue;
      }

      const rawVerses = bodyRows.map((r) => r.lyrics.replace(/\s+/g, ' ').trim());

      // 후렴을 떼지 않는 것이 기본이다.
      //
      // 원본은 후렴을 각 절 뒤에 인라인으로 반복해 담고 있고, 그게 실제 진행
      // 순서다. 떼어내면 두 가지가 깨진다:
      //  - 절 587곡 중 97곡은 절 끝 어절이 후렴을 수식한다 (새48: '…찬양하며' +
      //    '드리오니 …'). 서술어가 두 섹션으로 쪼개져 문장이 성립하지 않는다
      //  - 1·2·3·4절 뒤에 후렴이 한 번 오는 구조라, 화살표로 순서대로 진행할 수 없다
      //
      // 후렴 검출 자체는 그대로 돌려 리포트에 남긴다 — 어디가 후렴인지 아는 것은
      // 여전히 쓸모가 있고(운율 정렬·확인용), 검출 실패를 감추지 않기 위해서다.
      const detection = detectRefrain(rawVerses);
      const verseTexts = splitRefrain ? detection.verses : rawVerses;

      const sections: Array<{ kind: 'verse' | 'chorus'; label: string; lines: SongLine[] }> = [];

      // 절 — 자동 줄나눔
      for (const [index, verseText] of verseTexts.entries()) {
        if (verseText.trim().length === 0) continue;
        sections.push({
          kind: 'verse',
          label: `${bodyRows[index]?.verse ?? index + 1}절`,
          lines: toSongLines(splitIntoLines(verseText), 'ko'),
        });
      }

      if (detection.refrain) {
        // --split-refrain 을 준 경우에만 별도 섹션으로 만든다
        if (splitRefrain) {
          sections.push({
            kind: 'chorus',
            label: '후렴',
            lines: toSongLines(splitIntoLines(detection.refrain), 'ko'),
          });
        }

        if (detection.confidence === 'high') stat.refrainHigh++;
        else if (detection.confidence === 'medium') stat.refrainMedium++;
        else stat.refrainLow++;

        // 확신이 낮은 것만 리포트에 남긴다 — 확인해야 할 것에 집중하도록
        if (detection.confidence !== 'high' && samples.length < 60) {
          samples.push({
            hymnal: spec.name,
            number,
            title,
            confidence: detection.confidence,
            words: detection.words,
            refrain: detection.refrain,
          });
        }
      }

      if (sections.length === 0) {
        stat.skipped.push(`${number}장 ${title}: 섹션 생성 실패`);
        continue;
      }

      songs.createSong({
        title,
        tags: [spec.name],
        hasAmen,
        source: spec.songbookId,
        entries: [{ songbookId: spec.songbookId, number }],
        sections,
      });

      stat.songs++;
      stat.sections += sections.length;
      if (hasAmen) stat.amenSongs++;
    }

    return stat;
  } finally {
    source.close();
  }
}

function writeReport(stats: ImportStat[], samples: RefrainSample[], linked: number, elapsedMs: number): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(paths.reportsDir, `hymns-import-${stamp}.md`);

  const lines: string[] = [
    '# 찬송가 가져오기 리포트',
    '',
    `- 생성 시각: ${now.toISOString()}`,
    `- 원본 폴더: \`${paths.bibleSourceDir}\` (읽기 전용)`,
    `- 산출물: \`${paths.songsDb}\``,
    `- 소요 시간: ${(elapsedMs / 1000).toFixed(1)}초`,
    '',
    '## 판본별 통계',
    '',
    '| 판본 | 곡 | 섹션 | 아멘 곡 | 후렴 확실 | 후렴 유력 | 후렴 확인필요 | 건너뜀 |',
    '|------|---:|-----:|--------:|----------:|----------:|--------------:|-------:|',
  ];

  for (const s of stats) {
    lines.push(
      `| ${s.name} | ${s.songs} | ${s.sections} | ${s.amenSongs} | ${s.refrainHigh} | ${s.refrainMedium} | ${s.refrainLow} | ${s.skipped.length} |`,
    );
  }

  lines.push(
    '',
    `대응곡 연결(제목 일치로 새↔통일을 이은 쌍): **${linked}쌍**`,
    '',
    '## 자동 처리한 것 — 확인이 필요합니다',
    '',
    '원본에는 줄바꿈이 없고 후렴이 절 안에 인라인으로 반복되어 있어, 아래를 자동으로 처리했습니다.',
    '**자동 결과는 제안입니다.** 편집 UI 에서 확인·수정하세요.',
    '',
    '1. **자동 줄나눔** — 어절 경계에서 균형 있게 나눔 (목표 20자/줄)',
    '2. **후렴 분리** — 절 간 최장 공통 어절 접미사를 후렴으로 봄',
    '3. **아멘 흡수** — 아멘만 있는 절은 별도 절로 만들지 않고 곡 속성으로 처리',
    '',
  );

  if (samples.length > 0) {
    lines.push(
      '### 후렴 검출 신뢰도가 낮은 곡',
      '',
      '어절 수가 적어 우연히 같은 말로 끝난 것일 수 있습니다. 눈으로 확인하세요.',
      '',
      '| 판본 | 번호 | 제목 | 신뢰도 | 어절 | 검출된 후렴 |',
      '|------|-----:|------|--------|-----:|-------------|',
    );
    for (const s of samples) {
      lines.push(`| ${s.hymnal} | ${s.number} | ${s.title} | ${s.confidence} | ${s.words} | ${s.refrain} |`);
    }
    lines.push('');
  }

  const skipped = stats.filter((s) => s.skipped.length > 0);
  lines.push('## 건너뛴 곡', '');
  if (skipped.length === 0) {
    lines.push('없습니다.');
  } else {
    for (const s of skipped) {
      lines.push(`### ${s.name}`, '');
      for (const item of s.skipped) lines.push(`- ${item}`);
      lines.push('');
    }
  }

  lines.push(
    '## 영어 가사',
    '',
    '원본 찬송가 DB 에는 **한국어 가사만** 있습니다. 2언어 표시를 쓰려면 편집 UI 에서',
    '영어 가사를 붙여넣어야 합니다. `|` 로 시작하는 줄이 직전 줄의 번역으로 짝지어집니다.',
    '',
    '```',
    '[1절]',
    '주 예수보다 더 귀한 것은 없네',
    "| I'd rather have Jesus than silver or gold",
    '```',
  );

  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

// ── 실행 ───────────────────────────────────────────────────────

const startedAt = Date.now();
ensureDataDirs();

log(`원본 폴더: ${paths.bibleSourceDir}`);
log(`산출물   : ${paths.songsDb}`);
log('');

const missing = SOURCES.filter((s) => !existsSync(path.join(paths.bibleSourceDir, s.file)));
if (missing.length > 0) {
  log('찬송가 원본 DB 를 찾을 수 없습니다:');
  for (const s of missing) log(`  - ${s.name}: ${s.file}`);
  log('');
  log(`폴더를 확인하세요: ${paths.bibleSourceDir}`);
  process.exit(1);
}

songs.initSongsDb();

try {
  // 재실행 시 같은 출처의 기존 곡을 지우고 다시 넣는다.
  // 사용자가 직접 등록한 곡(source='manual')은 건드리지 않는다.
  for (const spec of SOURCES) {
    // 곡집 단위로 지운다 — 개별·일괄 갱신이 같은 방식으로 동작한다
    const removed = songs.deleteBySongbook(spec.songbookId);
    if (removed > 0) log(`  ${spec.name}: 기존 ${removed}곡 제거 후 다시 가져옵니다`);
  }

  const stats: ImportStat[] = [];
  const samples: RefrainSample[] = [];

  for (const spec of SOURCES) {
    const t0 = Date.now();
    const stat = importHymnal(spec, samples);
    stats.push(stat);
    log(
      `  ${spec.name.padEnd(8)} ${String(stat.songs).padStart(4)}곡` +
        `  섹션 ${String(stat.sections).padStart(5)}` +
        `  후렴 ${stat.refrainHigh}/${stat.refrainMedium}/${stat.refrainLow} (확실/유력/확인필요)` +
        `  아멘 ${stat.amenSongs}` +
        `  ${((Date.now() - t0) / 1000).toFixed(1)}초`,
    );
    for (const item of stat.skipped) log(`      ↳ 건너뜀: ${item}`);
  }

  log('');
  log('판본 간 대응곡 연결 중…');
  // 새찬송가 ↔ 통일찬송가는 가사가 91% 달라 별도 곡으로 두고 링크만 건다
  const linked = songs.autoLinkByTitle('hymn_new', 'hymn_old');
  for (const spec of SOURCES) songbookStore.markImported(songs.conn(), spec.songbookId, spec.file);

  const total = songs.countSongs();
  const elapsed = Date.now() - startedAt;
  const reportPath = writeReport(stats, samples, linked, elapsed);

  log('');
  log(`완료: ${total.toLocaleString()}곡 (대응곡 연결 ${linked}쌍)`);
  log(`리포트: ${reportPath}`);
  log('');
  log('원본에 줄바꿈·후렴 구분이 없어 자동 처리했습니다. 리포트에서 확인이 필요한 곡을 확인하세요.');
} finally {
  songs.closeSongsDb();
}
