/**
 * **영어 가사가 한국어 줄에 맞게 들어갔는지 본다.**
 *
 * ## 왜 필요한가 (2026-08-27 실측 · 2026-09-28 사용자 결정)
 *
 * 새찬송가 645곡에 영어를 넣었더니 **줄 수로는 97.8% 가 정상**이었다. 그런데
 * 실제로 쓸 수 있는 곡은 **36곡뿐**이었다. 영어가 한국어 줄에 맞춰 들어간 게
 * 아니라 **한 덩이 글을 30자쯤에서 기계적으로 자른** 상태였기 때문이다:
 *
 * ```
 * ko: 나 같은 죄인 살리신     en: Amazing grace! how sweet the
 * ko: 주 은혜 놀라워         en: sound! That saved a wretch like
 * ```
 *
 * `the / sound!` 처럼 낱말과 문장이 줄 사이에서 끊긴다. 줄 수만 세면 이 곡이
 * **'정상'** 으로 잡힌다.
 *
 * ## 어떻게 판정하는가
 *
 * **둘째 줄 이후인데 소문자로 시작하면** 문장 중간에서 끊긴 것으로 본다.
 * 영어 찬송 가사는 행마다 대문자로 시작하는 것이 관례이고, 실측에서 **첫 줄이
 * 소문자인 경우는 645곡 중 0건**이었다 — 무작위가 아니라 순서대로 자른 증거다.
 *
 * **완벽한 판정이 아니다.** `'Tis`·고유명사·이어지는 구절은 정상인데도 걸린다.
 * 그래서 이것은 **'여기를 보라'는 표시**이고, 고칠지는 사람이 내용을 보고 정한다
 * (자동 결과는 제안이라는 이 프로젝트의 규칙 그대로다).
 *
 * ## 왜 자동으로 다시 나누지 않는가 (2026-09-28 사용자 결정)
 *
 * 한 번에 맞추기 어려운 작업이다. **예배 순서를 준비하면서 그 주에 부를 곡만**
 * 사람이 보고 고치는 편이 낫다 — 645곡을 한꺼번에 손보는 것보다 실제로 쓰이는
 * 곡이 먼저 좋아진다.
 */

import type { LangCode, SongSection } from '../shared/types.ts';

/** 한 곡의 영어 가사 상태 */
export type BilingualGrade =
  /** 영어가 전혀 없다 */
  | 'none'
  /** 영어 줄이 한국어보다 적다 — 한 덩이를 적은 줄에 밀어 넣었다 */
  | 'fewer'
  /** 줄 수는 맞지만 문장이 줄 사이에서 끊긴 것으로 보인다 */
  | 'broken'
  /** 손댈 곳이 보이지 않는다 */
  | 'ok';

export interface BilingualReport {
  grade: BilingualGrade;
  koLines: number;
  otherLines: number;
  /** 끊긴 것으로 보이는 줄 수 */
  brokenLines: number;
  /** 사람이 볼 만한 곳: `구간 라벨 → 줄 번호들` */
  brokenAt: Array<{ label: string; indexes: number[] }>;
}

/**
 * 둘째 줄 이후인데 소문자로 시작 = 문장 중간에서 끊겼다.
 *
 * 따옴표로 시작하는 줄(`'Tis`)은 그 다음 글자를 본다 — 아포스트로피 때문에
 * 멀쩡한 줄이 걸리면 표시가 시끄러워져 아무도 보지 않게 된다.
 */
export function looksBroken(text: string, lineIndex: number): boolean {
  if (lineIndex <= 0) return false;
  const bare = text.trim().replace(/^['"‘’“”]+/, '');
  return /^[a-z]/.test(bare);
}

/**
 * 한 곡을 본다. `lang` 은 한국어와 견줄 언어 (기본 영어).
 *
 * 구간마다 따로 센다 — 한 구간의 줄 수가 맞아도 다른 구간이 어긋날 수 있고,
 * 사람이 고칠 때는 '어느 절' 인지가 필요하다.
 */
export function checkBilingual(
  sections: readonly SongSection[],
  lang: LangCode = 'en' as LangCode,
): BilingualReport {
  let koLines = 0;
  let otherLines = 0;
  let brokenLines = 0;
  const brokenAt: BilingualReport['brokenAt'] = [];

  for (const section of [...sections].sort((a, b) => a.position - b.position)) {
    const ko = section.lines.filter((line) => line.lang === 'ko');
    const other = section.lines.filter((line) => line.lang === lang);
    koLines += ko.length;
    otherLines += other.length;

    const indexes = other
      .filter((line) => looksBroken(line.text, line.lineIndex))
      .map((line) => line.lineIndex);
    if (indexes.length > 0) {
      brokenLines += indexes.length;
      brokenAt.push({ label: section.label, indexes });
    }
  }

  const grade: BilingualGrade =
    otherLines === 0 ? 'none' : otherLines < koLines ? 'fewer' : brokenLines > 0 ? 'broken' : 'ok';

  return { grade, koLines, otherLines, brokenLines, brokenAt };
}

/** 사람이 볼 한 줄 — 화면과 리포트가 같은 말을 쓴다 */
export function describeBilingual(report: BilingualReport): string {
  switch (report.grade) {
    case 'none':
      return '영어 가사가 없습니다';
    case 'fewer':
      return `영어가 ${report.otherLines}줄, 한국어가 ${report.koLines}줄 — 줄이 모자랍니다`;
    case 'broken':
      return `영어 ${report.brokenLines}줄이 문장 중간에서 끊긴 것 같습니다`;
    case 'ok':
      return '영어 가사가 줄에 맞습니다';
  }
}
