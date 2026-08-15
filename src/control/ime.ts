/**
 * 한글 입력기(IME) 조합 중인 키를 가려낸다.
 *
 * **왜 필요한가 — 2026-08-15 실사용에서 발견한 버그.**
 * '예배로의 부름' 을 치고 Enter 를 누르면 구분이 **두 개** 생겼다.
 * 두 번째 이름은 마지막 글자인 '름'.
 *
 * 한글은 마지막 글자가 아직 **조합 중**인 상태로 남아 있다. 그 상태에서 Enter 를
 * 누르면 브라우저는
 *   1. `keydown`(조합 확정용, `isComposing = true`)
 *   2. `compositionend`
 *   3. `keydown`(우리가 기대한 그 Enter)
 * 순서로 보낸다. 1번을 걸러내지 않으면 **한 번 누른 Enter 가 두 번 처리**되고,
 * 두 번째 처리 때는 입력창에 방금 확정된 글자만 남아 있어 '름' 이 들어간다.
 *
 * 영문만 치면 조합이 없어 드러나지 않는다 — 한글로 써 봐야 보이는 종류의 버그다.
 */
export function isComposing(event: { nativeEvent: Event }): boolean {
  // React 합성 이벤트에는 isComposing 이 없어 원본 이벤트를 본다.
  // keyCode 229 는 조합 중임을 알리는 옛 방식으로, 일부 환경에서 이쪽만 온다.
  const native = event.nativeEvent as KeyboardEvent;
  return native.isComposing === true || native.keyCode === 229;
}
