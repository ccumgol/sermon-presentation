/**
 * 프로젝터에 **가사**를 낼지 **악보**를 낼지 고르는 토글.
 *
 * 예배 순서 항목 설정과 찬양 탭 곡 카드 **두 곳**이 쓴다. 한 곳에 적어 두지
 * 않으면 한쪽만 고쳐 '순서표에서는 되는데 찬양 탭에서는 안 된다' 가 된다.
 *
 * ## 왜 조작 화면에 두는가
 *
 * 전에는 프로젝터 창에서 `S` 를 눌러야 했다. 그 창은 대개 다른 화면에 띄워
 * 두고 손이 닿지 않는다. 게다가 **보이지 않는 스위치**라 한 번 끄면 되돌리는
 * 법을 알 수 없었다 (사용자 보고 2026-09-04).
 */
/*
 * OBS 출력과 강사 모니터는 이 값과 무관하게 **언제나 가사**다 — 회중은 악보를,
 * 방송 화면은 가사를 봐야 한다.
 *
 * 악보가 없는 곡이면 **그렇다고 말해 준다.** 눌러도 아무 일이 없으면 고장으로
 * 보인다. 악보가 있는 곡집은 지금 찬미예수 2000 뿐이다.
 */
export function ProjectorSheetToggle({
  value, hasSheet, onChange,
}: {
  value: boolean;
  /** 이 곡에 악보가 있는가. 아직 못 읽었으면 `undefined` */
  hasSheet: boolean | undefined;
  onChange: (sheet: boolean) => void;
}): React.JSX.Element {
  const none = hasSheet === false;
  return (
    <>
      <span className="toggle-row">
        {([[false, '가사'], [true, '악보']] as const).map(([key, label]) => (
          <button
            key={label}
            type="button"
            className={`toggle${value === key ? ' active' : ''}`}
            disabled={none && key}
            title={
              none && key
                ? '이 곡에는 악보가 없습니다'
                : key
                  ? '지금 부르는 줄의 악보 단만 크게 보여 줍니다'
                  : 'OBS 화면과 같은 가사가 나갑니다'
            }
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        ))}
      </span>
      {none && <span className="muted">악보 없음</span>}
    </>
  );
}
