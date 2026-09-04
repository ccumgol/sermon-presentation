/**
 * 악보 이미지 변환 — 원본 BMP → `data/sheets/<곡집>/NNNN.webp`
 *
 * ```
 * npm run sheets:convert                 # 미리보기 (아무것도 쓰지 않는다)
 * npm run sheets:convert -- --apply      # 실제로 변환한다
 * npm run sheets:convert -- --apply --force   # 이미 있는 것도 다시 만든다
 * npm run sheets:convert -- --apply --limit 20  # 앞에서 20장만 (시험용)
 * ```
 *
 * ## 왜 변환하는가
 *
 * 원본은 **1비트 흑백 BMP** 2,062장 340MB 다. 브라우저가 BMP 를 다루기는 하지만
 * 압축이 없어 한 장에 100~290KB 고, 예배 중에 그대로 내보내기엔 무겁다.
 * **WebP 무손실**로 바꾸면 그림은 픽셀 하나까지 같고 용량만 14.7% 로 준다
 * (표본 17장 실측 → 전체 약 50MB).
 *
 * **손실 압축은 쓰지 않는다.** 선화(線畵)라 q90 이 오히려 무손실보다 6배 컸다
 * (1000번: 무손실 38KB · q90 238KB). 게다가 얇은 선 둘레에 링잉이 생긴다.
 *
 * ## 기울기를 편다
 *
 * 스캔이 조금씩 기울어 있다. 그대로 두면 **단 경계 검출이 무너진다** — 오선 한 줄이
 * 여러 행에 걸쳐 어느 행도 길게 이어지지 않기 때문이다. 0301번은 7단짜리인데 줄이
 * 2개만 잡혔고, 펴고 나니 35개(7단×5)가 정확히 잡혔다.
 *
 * **검출할 때만 펴서는 안 된다.** 잘라 낼 좌표가 화면에 나가는 그림과 같아야 한다.
 * 그래서 저장하는 그림 자체를 편다.
 *
 * 편 뒤에는 **다시 흑백으로 되돌린다**(`-threshold 50%`). 회전은 가장자리를 회색으로
 * 만드는데, 원본이 1비트라 회색이 섞이면 WebP 무손실이 **7배** 커진다
 * (0001번: 17KB → 123KB → 되돌리면 다시 17KB, 실측).
 *
 * ## 원본은 건드리지 않는다
 *
 * `~/Desktop/Data/Praise` 는 읽기 전용이다. 여기서는 읽기만 하고, 원본이 있어야
 * 언제든 다시 변환할 수 있다.
 *
 * ## 파일 이름
 *
 * 규칙은 `lib/sheet-files.ts` 에 있다 — **서버도 같은 것을 쓴다.** 두 곳에 따로 적으면
 * 한쪽이 뒤처져 '변환은 됐는데 화면에 안 나온다' 가 된다.
 *
 * ## 필요한 것
 *
 * ImageMagick(`magick`). macOS 기본 `sips` 는 WebP 를 못 쓰고, `cwebp` 는 BMP 를
 * 못 읽는다. 한 번만 돌리는 반입 도구라 외부 도구를 써도 된다 — 예배 중에 도는
 * 코드가 아니다.
 *
 * ```
 * brew install imagemagick
 * ```
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';

import { sheetFileName, sheetNumberOf } from '../lib/sheet-files.ts';
import { paths } from '../server/paths.ts';

/** 악보 원본이 있는 곡집. 지금은 찬미예수 2000 뿐이다 */
const SOURCES: ReadonlyArray<{ songbookId: string; folder: string; label: string }> = [
  { songbookId: 'chanmi2000', folder: '찬미예수 2000 악보', label: '찬미예수 2000' },
];

interface Job {
  songbookId: string;
  number: number;
  from: string;
  to: string;
  /** 원본 크기 (바이트) — 미리보기에서 얼마나 줄어드는지 어림한다 */
  bytes: number;
}

/** 내려받다 만 원본 — 변환 실패와 구분해서 알린다 */
interface Broken {
  label: string;
  number: number;
  file: string;
  missingBytes: number;
}

/**
 * 원본이 **끝까지 받아진 파일**인가.
 *
 * BMP 머리 14바이트에 파일 전체 크기가 적혀 있다. 실제 크기가 그보다 작으면 내려받다
 * 만 것이다 — 도구가 '헤더가 잘못됐다' 고만 말해서 원본이 깨진 것인지 변환이 실패한
 * 것인지 구분이 안 된다. 미리 걸러 **원본 문제라고 정확히 알린다.**
 *
 * 실제로 하나 있었다: `1255.bmp` 가 정확히 128KB(131,072) 에서 잘려 있었고 헤더는
 * 172,794 를 가리켰다. 억지로 열면 새까만 그림이 나온다 (2026-09-04 실측).
 */
function truncatedBy(file: string): number | undefined {
  const size = statSync(file).size;
  const head = Buffer.alloc(14);
  const fd = openSync(file, 'r');
  try {
    if (readSync(fd, head, 0, 14, 0) < 14) return size;
  } finally {
    closeSync(fd);
  }
  if (head.toString('latin1', 0, 2) !== 'BM') return undefined; // BMP 가 아니면 여기서 판단하지 않는다
  const declared = head.readUInt32LE(2);
  return declared > size ? declared - size : undefined;
}

function hasImageMagick(): boolean {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function collect(force: boolean): { jobs: Job[]; skipped: number; unnamed: string[]; broken: Broken[] } {
  const jobs: Job[] = [];
  const unnamed: string[] = [];
  const broken: Broken[] = [];
  let skipped = 0;

  for (const source of SOURCES) {
    const dir = path.join(paths.praiseSourceDir, source.folder);
    if (!existsSync(dir)) {
      console.log(`⚠️  원본 폴더가 없습니다: ${dir}`);
      continue;
    }

    const outDir = path.join(paths.sheetsDir, source.songbookId);
    const seen = new Map<number, string>();

    for (const entry of readdirSync(dir).sort()) {
      if (!entry.toLowerCase().endsWith('.bmp')) continue;

      const number = sheetNumberOf(entry);
      if (number === undefined) {
        unnamed.push(`${source.folder}/${entry}`);
        continue;
      }
      // 같은 번호가 두 번 나오면 어느 쪽이 맞는지 알 수 없다 — 알리고 첫 것만 쓴다
      const already = seen.get(number);
      if (already !== undefined) {
        console.log(`⚠️  ${source.label} ${number}번이 둘입니다: ${already} · ${entry} — 앞의 것을 씁니다`);
        continue;
      }
      seen.set(number, entry);

      const to = path.join(outDir, sheetFileName(number));
      if (!force && existsSync(to)) {
        skipped++;
        continue;
      }
      const from = path.join(dir, entry);

      // 깨진 원본은 아예 시도하지 않는다 — 억지로 열면 새까만 그림이 저장된다
      const missingBytes = truncatedBy(from);
      if (missingBytes !== undefined) {
        broken.push({ label: source.label, number, file: entry, missingBytes });
        continue;
      }

      jobs.push({ songbookId: source.songbookId, number, from, to, bytes: statSync(from).size });
    }
  }

  return { jobs, skipped, unnamed, broken };
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : undefined;

  const { jobs: all, skipped, unnamed, broken } = collect(force);
  const jobs = limit !== undefined && Number.isInteger(limit) ? all.slice(0, limit) : all;

  console.log(`원본 : ${paths.praiseSourceDir}  (읽기만 합니다)`);
  console.log(`결과 : ${paths.sheetsDir}`);
  console.log('');
  console.log(`바꿀 것 ${jobs.length}장 · 이미 있어 건너뜀 ${skipped}장${limit ? ` · --limit ${limit}` : ''}`);
  if (unnamed.length > 0) {
    console.log(`⚠️  번호를 못 읽은 파일 ${unnamed.length}개: ${unnamed.slice(0, 5).join(', ')}`);
  }
  if (broken.length > 0) {
    console.log('');
    console.log(`⚠️  **원본이 잘려 있어** 건너뛴 것 ${broken.length}장 — 변환 문제가 아니라 자료 문제입니다:`);
    for (const one of broken) {
      console.log(`   ${one.label} ${one.number}번 (${one.file}) — ${one.missingBytes.toLocaleString()}바이트 모자람`);
    }
    console.log('   → docs/KNOWN-DATA-ISSUES.md 참고. 원본을 다시 받으면 이 스크립트가 알아서 넣습니다.');
  }
  if (jobs.length === 0) {
    console.log('\n할 일이 없습니다.');
    return;
  }

  const sourceBytes = jobs.reduce((sum, job) => sum + job.bytes, 0);
  if (!apply) {
    console.log(`\n원본 합계 ${mb(sourceBytes)} → 약 ${mb(sourceBytes * 0.147)} (실측 14.7%)`);
    console.log('\n미리보기입니다 — 아무것도 쓰지 않았습니다. 실제로 바꾸려면 --apply');
    return;
  }

  if (!hasImageMagick()) {
    console.error('\n❌ ImageMagick(magick) 이 없습니다. 설치하고 다시 실행하세요:\n   brew install imagemagick');
    process.exitCode = 1;
    return;
  }

  let done = 0;
  let outBytes = 0;
  const failed: Array<{ number: number; message: string }> = [];

  for (const job of jobs) {
    mkdirSync(path.dirname(job.to), { recursive: true });
    try {
      execFileSync(
        'magick',
        [
          job.from,
          // 회전으로 생기는 빈 자리는 흰색 (악보 바탕과 같다)
          '-background', 'white',
          '-deskew', '40%',
          '+repage',
          // 회전이 만든 회색을 다시 흑백으로 — 안 하면 무손실 용량이 7배가 된다
          '-threshold', '50%',
          '-define', 'webp:lossless=true',
          job.to,
        ],
        { stdio: 'pipe' },
      );
      outBytes += statSync(job.to).size;
      done++;
    } catch (err) {
      failed.push({ number: job.number, message: err instanceof Error ? err.message.split('\n')[0]! : String(err) });
    }
    if (done % 200 === 0) console.log(`  … ${done}/${jobs.length}`);
  }

  console.log('');
  console.log(`바꿨습니다: ${done}장  ${mb(sourceBytes)} → ${mb(outBytes)} (${((outBytes / sourceBytes) * 100).toFixed(1)}%)`);
  console.log('기울기를 폈으므로 그림 크기가 원본과 조금 다릅니다 — 좌표는 이 결과 기준입니다.');
  if (failed.length > 0) {
    console.log(`❌ 실패 ${failed.length}장: ${failed.slice(0, 5).map((f) => f.number).join(', ')}`);
    for (const one of failed.slice(0, 3)) console.log(`   ${one.number}: ${one.message}`);
    process.exitCode = 1;
  }

  // 스스로 확인한다 — 만들었다고 말했으면 실제로 있어야 한다
  const missing = jobs.filter((job) => !existsSync(job.to));
  if (missing.length > 0) {
    console.log(`❌ 만들었다고 했는데 없는 파일 ${missing.length}장`);
    process.exitCode = 1;
  }
}

main();
