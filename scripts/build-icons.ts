/**
 * 앱 아이콘을 만든다 — `build-resources/icon.svg` → `.icns`(맥) · `.ico`(윈도우).
 *
 * 실행: `npm run icons`
 *
 * ## 왜 스크립트로 만드는가
 *
 * 손으로 그린 PNG 를 저장소에 두면 **고칠 수가 없다.** 색 하나를 바꾸려 해도
 * 원본이 어디 있는지 모르고, 크기마다 따로 손봐야 한다. SVG 하나를 원본으로 두면
 * 고치고 다시 돌리면 끝이다.
 *
 * ## 왜 작은 크기는 다른 그림인가
 *
 * 16pt 에서는 세로로 쓸 수 있는 픽셀이 열 개 남짓이라 줄 세 개가 뭉친다(실측).
 * 그 크기만 `icon-small.svg`(줄 두 개)를 쓴다 — 애플·마이크로소프트 지침도
 * 작은 크기에서는 요소를 덜어내라고 한다. 맥의 목록·메뉴와 윈도우 작업표시줄이
 * 이 크기를 쓰므로, **사람이 가장 자주 보는 크기**다.
 *
 * ## 필요한 도구
 *
 * `rsvg-convert`(SVG→PNG) · `iconutil`(맥 내장) · `magick`(ICO 묶기).
 * 없으면 무엇을 어떻게 설치하는지 알려 주고 멈춘다 — 조용히 넘기면 아이콘 없는
 * 배포판이 나간다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { APP_ROOT } from '../server/paths.ts';

/** `.gitignore` 가 `build/` 를 무시하므로 이름을 나눴다 — 아이콘은 커밋되어야 한다 */
const BUILD_DIR = path.join(APP_ROOT, 'build-resources');
const MAIN_SVG = path.join(BUILD_DIR, 'icon.svg');
const SMALL_SVG = path.join(BUILD_DIR, 'icon-small.svg');

/** 이 크기부터는 큰 그림(줄 세 개)을 쓴다. 그 아래는 작은 변형 */
const SMALL_UPTO = 16;

interface IcnsEntry {
  /** iconutil 이 요구하는 이름 */
  name: string;
  /** 실제 픽셀 크기 */
  px: number;
  /** 이 항목이 나타내는 논리 크기 (pt) — 어느 그림을 쓸지 정한다 */
  pt: number;
}

/** 맥이 요구하는 조합. 하나라도 빠지면 그 크기에서 흐릿하게 늘어난다 */
const ICNS: IcnsEntry[] = [
  { name: 'icon_16x16.png', px: 16, pt: 16 },
  { name: 'icon_16x16@2x.png', px: 32, pt: 16 },
  { name: 'icon_32x32.png', px: 32, pt: 32 },
  { name: 'icon_32x32@2x.png', px: 64, pt: 32 },
  { name: 'icon_128x128.png', px: 128, pt: 128 },
  { name: 'icon_128x128@2x.png', px: 256, pt: 128 },
  { name: 'icon_256x256.png', px: 256, pt: 256 },
  { name: 'icon_256x256@2x.png', px: 512, pt: 256 },
  { name: 'icon_512x512.png', px: 512, pt: 512 },
  { name: 'icon_512x512@2x.png', px: 1024, pt: 512 },
];

/** 윈도우 ICO 에 담을 크기들 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function need(tool: string, how: string): void {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [tool], { stdio: 'pipe' });
  } catch {
    throw new Error(`'${tool}' 이(가) 필요합니다. ${how}`);
  }
}

function render(sourceSvg: string, px: number, out: string): void {
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), sourceSvg, '-o', out]);
}

/** 그 크기에 쓸 원본 — 작은 크기는 줄 두 개짜리 */
function svgFor(pt: number): string {
  return pt <= SMALL_UPTO ? SMALL_SVG : MAIN_SVG;
}

function buildIcns(work: string): string {
  const iconset = path.join(work, 'icon.iconset');
  mkdirSync(iconset, { recursive: true });
  for (const entry of ICNS) render(svgFor(entry.pt), entry.px, path.join(iconset, entry.name));

  const out = path.join(BUILD_DIR, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out]);
  return out;
}

function buildIco(work: string): string {
  const parts = ICO_SIZES.map((px) => {
    const file = path.join(work, `ico-${px}.png`);
    render(svgFor(px), px, file);
    return file;
  });

  const out = path.join(BUILD_DIR, 'icon.ico');
  execFileSync('magick', [...parts, out]);
  return out;
}

/**
 * 프로젝터 PWA 아이콘도 함께 맞춘다.
 *
 * 따로 두면 **같은 앱인데 아이콘이 둘**이 된다 — 홈 화면에 추가한 프로젝터와
 * 독의 앱이 달라 보인다.
 */
function buildPwa(): string[] {
  const dir = path.join(APP_ROOT, 'public', 'projector');
  return [192, 512].map((px) => {
    const out = path.join(dir, `icon-${px}.png`);
    render(MAIN_SVG, px, out);
    return out;
  });
}

function main(): void {
  need('rsvg-convert', '맥: brew install librsvg');
  need('magick', '맥: brew install imagemagick');
  if (process.platform === 'darwin') need('iconutil', 'Xcode 명령줄 도구에 들어 있습니다');

  for (const svg of [MAIN_SVG, SMALL_SVG]) {
    if (!existsSync(svg)) throw new Error(`원본을 찾을 수 없습니다: ${svg}`);
  }

  const work = path.join(BUILD_DIR, '.work');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  try {
    const made: string[] = [];
    // icns 는 맥에서만 만들 수 있다 (iconutil 이 맥 전용). 윈도우 CI 에서는
    // 저장소에 커밋된 icns 를 그대로 쓴다
    if (process.platform === 'darwin') made.push(buildIcns(work));
    made.push(buildIco(work));
    made.push(...buildPwa());

    for (const file of made) console.log(`  ✓ ${path.relative(APP_ROOT, file)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
