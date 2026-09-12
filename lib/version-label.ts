/**
 * **사람이 읽는 판 번호** — `1.4.0` → `1.04` (2026-09-12 사용자 결정).
 *
 * ## 왜 두 가지가 있나
 *
 * `package.json` 의 `version` 은 **semver 여야 한다** — npm 과 electron-builder 가
 * 그 규격을 요구한다. 그런데 semver 는 `1.04.0` 처럼 **앞자리 0 을 금지한다**
 * (실측: `semver.valid('1.04.0')` 이 `null` 이다).
 *
 * 그래서 저장은 `1.4.0` 으로 하고 **보여 줄 때만** `1.04` 로 적는다.
 * 출처는 `package.json` 하나뿐이라 두 값이 어긋날 일이 없다.
 *
 * ## 왜 0 을 채우나
 *
 * 판이 열을 넘으면 `1.9` 다음이 `1.10` 인데, 글자로 늘어놓으면 `1.10` 이 `1.9`
 * 앞에 온다. `1.09` → `1.10` 이면 눈으로도 목록에서도 순서가 맞는다.
 */
export function versionLabel(version: string): string {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!match) return version;

  const [, major = '0', minor = '0', patch] = match;
  const padded = `${major}.${minor.padStart(2, '0')}`;

  /*
   * 마지막 자리는 우리 규칙에서 늘 0 이다(간단한 고침은 가운데 자리를 올린다).
   * 그래도 0 이 아닌 값이 오면 **숨기지 않는다** — 숨기면 두 빌드가 같은 이름이 된다.
   */
  return patch !== undefined && patch !== '0' ? `${padded}.${patch}` : padded;
}
