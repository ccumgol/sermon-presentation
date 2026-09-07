/**
 * 태블릿에 열지 말지를 **설정에 담는다** (점검 P-1, 2026-09-07).
 *
 * ## 왜 있는가
 *
 * 전에는 `SERMON_HOST` 환경 변수뿐이었고, 그것을 정하는 곳은 `start.sh` 하나였다.
 * **설치판에는 터미널도 저장소도 없어서 태블릿을 열 방법이 아예 없었다.** 그런데
 * 화면은 `presentation lan` 을 입력하라고 안내했다 — 할 수 없는 일을 시킨 것이다.
 *
 * ## 왜 켜자마자 열리지 않는가
 *
 * 바인딩 주소는 서버가 뜰 때 한 번 정해진다. 도는 중에 바꾸려면 리스너를 하나 더
 * 열어야 하는데, **예배 중에 도는 서버**에 그런 장치를 넣는 것은 위험이 이득보다
 * 크다. 그래서 값만 저장하고 **다시 시작할 때** 반영한다 — 화면이 그렇게 안내한다.
 *
 * ## 번들에 담지 않는다
 *
 * 이것은 **그 PC 의 보안 결정**이다. 번들을 받은 PC 가 남의 선택 때문에 랜에
 * 열리면 안 된다 (`server/routes/backup.ts` 의 제외 목록).
 */

import { getSetting, setSetting } from './db/app.ts';

export const LAN_OPEN_KEY = 'lan_open';

/** 저장된 선택 — 정해진 적이 없으면 닫힘 (감사 H-1 의 기본값) */
export function storedLanOpen(): boolean {
  return getSetting(LAN_OPEN_KEY) === '1';
}

export function setStoredLanOpen(open: boolean): void {
  setSetting(LAN_OPEN_KEY, open ? '1' : '0');
}
