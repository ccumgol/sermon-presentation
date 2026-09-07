// @vitest-environment jsdom
/**
 * **설정 탭의 태블릿 준비 카드** — 화면이 지켜야 하는 순서와 표시.
 *
 * 이 카드는 2026-09-07(점검 P-1)에 만들었다. 그전에는 `presentation lan` 과
 * `npm run password` 를 입력하라는 안내였고, **설치판에는 터미널도 저장소도 없어서**
 * 할 수 없는 일을 시키고 있었다.
 *
 * ## 여기서 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 암호 없이 **[열기] 를 누를 수 없다** | 그 상태의 랜이 감사 H-1 이 막으려던 것이다 |
 * | 버튼은 **저장된 선택**(`lanWanted`)을 뒤집는다 | `lanOpen` 으로 하면 켠 직후 '열기' 로 남아 되돌릴 수 없다 |
 * | 열려 있으면 **[없애기] 가 없다** | 서버가 409 로 막는 조건과 같아야 한다 |
 * | 오류를 그대로 보여 준다 | 삼키면 눌렀는데 아무 일도 없는 것으로 보인다 |
 *
 * 화면만 막으면 화면을 우회할 수 있으므로 **서버도 같은 것을 막는다** —
 * 그쪽은 `tests/integration/tablet-setup.test.ts` 가 검사한다. 둘이 짝이다.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabletAccess } from '../../src/control/api.ts';

/** 실제로 서버를 부르지 않는다 — 카드가 무엇을 부르는지만 본다 */
const setPassword = vi.fn();
const clearPassword = vi.fn();
const setLanOpen = vi.fn();

vi.mock('../../src/control/api.ts', () => ({
  api: {
    setPassword: (password: string) => setPassword(password),
    clearPassword: () => clearPassword(),
    setLanOpen: (open: boolean) => setLanOpen(open),
  },
  ApiError: class ApiError extends Error {},
}));

const { TabletSetup } = await import('../../src/control/components/TabletSetup.tsx');
const { ApiError } = await import('../../src/control/api.ts');

afterEach(cleanup);

beforeEach(() => {
  setPassword.mockReset().mockResolvedValue({ passwordSet: true });
  clearPassword.mockReset().mockResolvedValue({ passwordSet: false });
  setLanOpen.mockReset().mockResolvedValue({ lanOpen: false, restartRequired: true, packaged: false });
});

function access(patch: Partial<TabletAccess> = {}): TabletAccess {
  return {
    lanOpen: false,
    lanWanted: false,
    passwordSet: false,
    packaged: false,
    targets: [],
    ...patch,
  };
}

/**
 * 상태 문자열이 아니라 **역할** 로 찾는다 — 문구를 다듬어도 검사가 살아 있게.
 *
 * `toBeDisabled` 같은 matcher 는 `@testing-library/jest-dom` 것이다. 그것 하나를
 * 더 들이지 않고 `disabled` 를 직접 본다 — 검사에 필요한 것은 그 값 하나다.
 */
const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement;
const openButton = (): HTMLButtonElement => button('열기');
const closeButton = (): HTMLButtonElement => button('닫기');

describe('암호가 없을 때', () => {
  it('★ [열기] 를 누를 수 없다', () => {
    render(<TabletSetup access={access()} onChanged={() => undefined} />);
    expect(openButton().disabled).toBe(true);
    expect(openButton().title).toContain('암호');
  });

  it('왜 못 누르는지 적어 준다', () => {
    render(<TabletSetup access={access()} onChanged={() => undefined} />);
    expect(screen.getByText(/암호를 정해야 열 수 있습니다/)).toBeTruthy();
  });

  it('암호 입력칸이 처음부터 펼쳐져 있다 — 할 일이 그것뿐이다', () => {
    render(<TabletSetup access={access()} onChanged={() => undefined} />);
    expect(screen.getByLabelText('새 접속 암호')).toBeTruthy();
  });
});

describe('암호 정하기', () => {
  it('4자 미만이면 저장할 수 없고 그 이유를 말한다', async () => {
    render(<TabletSetup access={access()} onChanged={() => undefined} />);
    await userEvent.type(screen.getByLabelText('새 접속 암호'), 'abc');
    await userEvent.type(screen.getByLabelText('한 번 더'), 'abc');

    expect(button('암호 정하기').disabled).toBe(true);
    expect(screen.getByText(/4자 이상/)).toBeTruthy();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('두 번 넣은 값이 다르면 저장할 수 없다', async () => {
    render(<TabletSetup access={access()} onChanged={() => undefined} />);
    await userEvent.type(screen.getByLabelText('새 접속 암호'), '암호1234');
    await userEvent.type(screen.getByLabelText('한 번 더'), '암호5678');

    expect(button('암호 정하기').disabled).toBe(true);
    expect(screen.getByText(/두 번 넣은 값이 다릅니다/)).toBeTruthy();
  });

  it('맞게 넣으면 서버에 그 값을 보내고, 바뀐 것을 알린다', async () => {
    const onChanged = vi.fn();
    render(<TabletSetup access={access()} onChanged={onChanged} />);
    await userEvent.type(screen.getByLabelText('새 접속 암호'), '암호1234');
    await userEvent.type(screen.getByLabelText('한 번 더'), '암호1234');
    await userEvent.click(screen.getByRole('button', { name: '암호 정하기' }));

    expect(setPassword).toHaveBeenCalledWith('암호1234');
    expect(onChanged).toHaveBeenCalled();
    // 이미 붙어 있던 기기가 로그아웃되는 것을 말해 준다
    expect(screen.getByText(/다시 넣어야 합니다/)).toBeTruthy();
  });

  it('★ 서버가 거절하면 그 말을 그대로 보여 준다 — 삼키지 않는다', async () => {
    setPassword.mockRejectedValue(new ApiError('암호는 4자 이상이어야 합니다.'));
    render(<TabletSetup access={access()} onChanged={() => undefined} />);
    await userEvent.type(screen.getByLabelText('새 접속 암호'), '암호1234');
    await userEvent.type(screen.getByLabelText('한 번 더'), '암호1234');
    await userEvent.click(screen.getByRole('button', { name: '암호 정하기' }));

    expect(screen.getByText('암호는 4자 이상이어야 합니다.')).toBeTruthy();
  });
});

describe('암호가 정해져 있을 때', () => {
  it('[열기] 를 누를 수 있고, 입력칸은 접혀 있다', () => {
    render(<TabletSetup access={access({ passwordSet: true })} onChanged={() => undefined} />);
    expect(openButton().disabled).toBe(false);
    expect(screen.queryByLabelText('새 접속 암호')).toBeNull();
    expect(screen.getByRole('button', { name: '바꾸기' })).toBeTruthy();
  });

  it('닫혀 있으면 [없애기] 가 있다', () => {
    render(<TabletSetup access={access({ passwordSet: true })} onChanged={() => undefined} />);
    expect(screen.getByRole('button', { name: '없애기' })).toBeTruthy();
  });

  it('★ 열기로 정해 두었으면 [없애기] 가 없다 — 서버가 409 로 막는 조건과 같다', () => {
    render(
      <TabletSetup access={access({ passwordSet: true, lanWanted: true })} onChanged={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: '없애기' })).toBeNull();
  });
});

describe('태블릿 접속 열기·닫기', () => {
  it('닫혀 있으면 [열기] 를 눌러 켠다', async () => {
    render(<TabletSetup access={access({ passwordSet: true })} onChanged={() => undefined} />);
    await userEvent.click(openButton());
    expect(setLanOpen).toHaveBeenCalledWith(true);
  });

  it('★ 켜 둔 직후에는 [닫기] 가 되고, 다시 시작하라고 말한다', () => {
    render(
      <TabletSetup access={access({ passwordSet: true, lanWanted: true })} onChanged={() => undefined} />,
    );
    // 아직 실제로 열리지는 않았다 (lanOpen: false)
    expect(closeButton()).toBeTruthy();
    expect(screen.getByText(/다시 시작하면 열립니다/)).toBeTruthy();
  });

  it('★ 그 상태에서 [닫기] 를 누르면 되돌린다 — 되돌릴 길이 있어야 한다', async () => {
    render(
      <TabletSetup access={access({ passwordSet: true, lanWanted: true })} onChanged={() => undefined} />,
    );
    await userEvent.click(closeButton());
    expect(setLanOpen).toHaveBeenCalledWith(false);
  });

  it('열려서 돌고 있으면 [닫기] 다', () => {
    render(
      <TabletSetup
        access={access({ passwordSet: true, lanWanted: true, lanOpen: true })}
        onChanged={() => undefined}
      />,
    );
    expect(closeButton()).toBeTruthy();
    expect(screen.getByText('열려 있습니다')).toBeTruthy();
  });

  it('무엇을 다시 시작해야 하는지 소스/설치판에 따라 갈라 말한다', async () => {
    setLanOpen.mockResolvedValue({ lanOpen: true, restartRequired: true, packaged: true });
    render(<TabletSetup access={access({ passwordSet: true })} onChanged={() => undefined} />);
    await userEvent.click(openButton());
    // 설치판에는 터미널이 없다 — 앱을 닫고 다시 열라고 말해야 한다
    expect(screen.getByText(/앱을 닫고 다시 열면/)).toBeTruthy();
  });

  it('소스에서 돌릴 때는 명령을 알려 준다', async () => {
    setLanOpen.mockResolvedValue({ lanOpen: true, restartRequired: true, packaged: false });
    render(<TabletSetup access={access({ passwordSet: true })} onChanged={() => undefined} />);
    await userEvent.click(openButton());
    expect(screen.getByText(/start\.sh lan/)).toBeTruthy();
  });
});
