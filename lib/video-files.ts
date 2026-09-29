/**
 * 동영상 파일 판정 — **예배 전에 미리 걸러 준다** (2026-09-29 사용자 요청).
 *
 * ## 왜 확장자만으로 판정하는가
 *
 * 코덱까지 정확히 알려면 파일을 열어 봐야 하고, 그러려면 해독기가 하나 늘어난다.
 * 그런데 실제로 막히는 경우는 대부분 **컨테이너 수준**에서 갈린다 — `.mkv` 를
 * 브라우저가 아예 안 여는 식이다. 그래서 확장자로 세 갈래만 낸다:
 *
 * | 갈래 | 뜻 |
 * |---|---|
 * | `ok` | OBS 안의 크롬이 여는 것이 보통이다 |
 * | `risky` | 열릴 수도 있고 아닐 수도 있다 — **예배 전에 틀어 보라고 알린다** |
 * | 목록에서 뺀다 | 동영상이 아니다 |
 *
 * ## 왜 `risky` 를 목록에서 빼지 않는가
 *
 * 빼 버리면 "USB 에서 넣었는데 목록에 없다" 가 되고, 사람은 **파일을 잘못 넣은 줄**
 * 안다. 보여 주되 **왜 위험한지 적어 두는** 편이 낫다 — 이 저장소가 원본 자료 문제를
 * 다루는 방식과 같다.
 */

/** OBS 안의 크롬에서 대체로 열리는 것 */
const SAFE = ['.mp4', '.m4v', '.webm'] as const;

/**
 * 동영상이긴 한데 코덱에 따라 안 열릴 수 있는 것.
 *
 * `.mov` 는 H.264 면 열리고 ProRes 면 안 열린다. `.mkv` 는 컨테이너부터 지원이
 * 들쭉날쭉하고, `.avi`·`.wmv` 는 대개 안 된다. 그래도 목록에는 낸다(머리말 참고).
 */
const RISKY = ['.mov', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.m2ts', '.ts', '.flv'] as const;

export type VideoRisk = 'ok' | 'risky';

export function videoExtension(name: string): string {
  const at = name.lastIndexOf('.');
  return at < 0 ? '' : name.slice(at).toLowerCase();
}

export function isVideoFile(name: string): boolean {
  const ext = videoExtension(name);
  return (SAFE as readonly string[]).includes(ext) || (RISKY as readonly string[]).includes(ext);
}

export function videoRisk(name: string): VideoRisk {
  return (SAFE as readonly string[]).includes(videoExtension(name)) ? 'ok' : 'risky';
}

/** 왜 위험한지 — 사람이 읽을 한 줄. 안전하면 `undefined` */
export function videoWarning(name: string): string | undefined {
  if (videoRisk(name) === 'ok') return undefined;
  const ext = videoExtension(name);
  if (ext === '.mov') {
    return 'MOV 는 H.264 로 만든 것만 열립니다 (아이폰 영상은 대개 됩니다). 예배 전에 한 번 틀어 보세요.';
  }
  return `${ext.replace('.', '').toUpperCase()} 는 열리지 않을 수 있습니다. 예배 전에 한 번 틀어 보고, 안 되면 MP4 로 바꿔 두세요.`;
}
