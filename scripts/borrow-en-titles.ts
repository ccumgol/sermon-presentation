/**
 * 대응곡에서 **영어 원제를 물려받는다** — `data/songs.sqlite`
 *
 * ```
 * node scripts/borrow-en-titles.ts             # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/borrow-en-titles.ts --apply     # 실제로 채운다
 * ```
 *
 * ## 무엇을 채우는가
 *
 * 새찬송가 645곡 중 644곡에 영어 원제(`title_alt`)가 있는데, **통일찬송가 557곡은
 * 전부 비어 있었다.** 통일과 새는 **가사가 달라 별개의 곡 행**이고(`song_links` 로
 * 이어져 있다), 원제를 읽는 코드가 연결을 따라가지 않기 때문이다.
 *
 * 영어 원제는 **한국어 가사 판본의 속성이 아니라 그 찬송 자체의 속성**이다.
 * 통일 1장과 새 1장은 같은 'Praise God from Whom All Blessings Flow' 다.
 * 그래서 연결을 따라 가져다 쓰는 것이 맞다 (2026-08-22 사용자 승인).
 *
 * 곡집을 가리지 않는다 — 연결이 있고 한쪽에만 원제가 있으면 채운다. 그래야 나중에
 * 다른 곡집을 넣어도 이 스크립트가 그대로 쓰인다.
 *
 * ## 채우지 않는 것
 *
 * - **이미 원제가 있는 곡** — 남의 값으로 덮지 않는다.
 * - **연결이 없는 곡.** 통일 전용 70곡이 여기 해당한다(2006년 개편에서 빠진 곡들).
 *   제목이 같은 새찬송가 곡이 하나도 없음을 확인했다 — 연결 누락이 아니다.
 * - **원제가 서로 다른 대응곡이 둘 이상 걸린 경우** — 어느 것이 맞는지 알 수 없으므로
 *   건드리지 않고 목록으로 알린다.
 */

import { DatabaseSync } from 'node:sqlite';

import { paths } from '../server/paths.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

interface Candidate {
  id: number;
  title: string;
  where: string;
  /** 물려받을 원제 */
  en: string;
  from: string;
}

function songbookLabel(db: DatabaseSync, songId: number): string {
  const rows = db
    .prepare(
      `SELECT sb.name AS name, e.number AS number
         FROM song_entries e JOIN songbooks sb ON sb.id = e.songbook_id
        WHERE e.song_id = ? ORDER BY e.number`,
    )
    .all(songId) as unknown as Array<{ name: string; number: number | null }>;
  if (rows.length === 0) return '(곡집 없음)';
  const first = rows[0]!;
  return first.number === null ? first.name : `${first.name} ${first.number}장`;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const db = new DatabaseSync(paths.songsDb);

  // 원제가 빈 곡마다, 연결된 곡들이 가진 원제를 모은다
  const rows = db
    .prepare(
      `SELECT s.id AS id, s.title AS title,
              t.id AS otherId, t.title_alt AS en
         FROM songs s
         JOIN song_links l ON l.song_id = s.id
         JOIN songs t ON t.id = l.linked_id
        WHERE (s.title_alt IS NULL OR s.title_alt = '')
          AND t.title_alt IS NOT NULL AND t.title_alt <> ''
        ORDER BY s.id`,
    )
    .all() as unknown as Array<{ id: number; title: string; otherId: number; en: string }>;

  const bySong = new Map<number, Array<{ otherId: number; en: string; title: string }>>();
  for (const row of rows) {
    const list = bySong.get(row.id) ?? [];
    list.push({ otherId: row.otherId, en: row.en, title: row.title });
    bySong.set(row.id, list);
  }

  const fill: Candidate[] = [];
  const ambiguous: Array<{ id: number; title: string; options: string[] }> = [];

  for (const [songId, list] of bySong) {
    const distinct = [...new Set(list.map((entry) => entry.en))];
    if (distinct.length > 1) {
      ambiguous.push({ id: songId, title: list[0]!.title, options: distinct });
      continue;
    }
    fill.push({
      id: songId,
      title: list[0]!.title,
      where: songbookLabel(db, songId),
      en: distinct[0]!,
      from: songbookLabel(db, list[0]!.otherId),
    });
  }

  // 곡집별로 몇 곡인지 — 무엇이 채워지는지 한눈에 보여야 한다
  const perBook = new Map<string, number>();
  for (const item of fill) {
    const book = item.where.replace(/ \d+장$/, '');
    perBook.set(book, (perBook.get(book) ?? 0) + 1);
  }

  console.log(`\n물려받을 곡: ${fill.length}곡`);
  for (const [book, count] of [...perBook].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${book}: ${count}곡`);
  }

  console.log('\n표본 (앞 8곡):');
  for (const item of fill.slice(0, 8)) {
    console.log(`  ${item.where} ${item.title}`);
    console.log(`      ← ${item.from} · ${item.en}`);
  }

  if (ambiguous.length > 0) {
    console.log(`\n⚠️ 대응곡의 원제가 서로 달라 건너뛴 곡: ${ambiguous.length}곡`);
    for (const item of ambiguous.slice(0, 10)) {
      console.log(`  ${item.title}: ${item.options.join(' / ')}`);
    }
  }

  if (fill.length === 0) {
    console.log('\n채울 것이 없습니다.');
    db.close();
    return;
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 채우려면 --apply 를 붙이세요.');
    db.close();
    return;
  }

  // 되돌릴 수 없는 작업이다 — 쓰기 전에 스냅샷을 뜬다 (CLAUDE.md '데이터를 바꿀 때').
  // 실패하면 던져서 아무것도 고치지 않고 멈춘다.
  db.close();
  const snapshot = snapshotDatabases('before-borrow-en-titles');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  const write = new DatabaseSync(paths.songsDb);
  // 한 트랜잭션으로 — 중간에 멈추면 절반만 채워진 상태가 남는다
  const update = write.prepare(
    "UPDATE songs SET title_alt = ?, updated_at = datetime('now') WHERE id = ?",
  );
  write.exec('BEGIN');
  try {
    for (const item of fill) update.run(item.en, item.id);
    write.exec('COMMIT');
  } catch (err) {
    write.exec('ROLLBACK');
    throw err;
  }

  const filled = write
    .prepare("SELECT count(*) AS c FROM songs WHERE title_alt IS NOT NULL AND title_alt <> ''")
    .get() as unknown as { c: number };
  console.log(`\n채웠습니다: ${fill.length}곡`);
  console.log(`확인: 원제가 있는 곡이 전체 ${filled.c}곡입니다.`);
  write.close();
}

main();
