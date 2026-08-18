import { useCallback, useEffect, useState } from 'react';

/**
 * 라이트/다크 테마.
 *
 * 세 가지 상태를 둔다 — `system` 이 기본이다. 방송실이 어두우면 OS 도 다크일 것이고,
 * 밝은 곳에서 랩탑으로 준비할 때는 OS 도 라이트일 것이다. 대개 OS 설정이 맞다.
 * 그래도 어긋날 때가 있으니(어두운 방에서 밝은 화면을 원하는 등) 고정할 길을 둔다.
 *
 * **`localStorage` 에 둔다.** 서버 설정이 아니라 **이 PC 의 취향**이다 —
 * 같은 순서표를 다른 PC 에서 열었을 때 그 PC 의 밝기를 따라야 한다.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'sermon.theme';

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // 사생활 보호 모드 등에서 막힐 수 있다 — 그때는 기본값으로 둔다
  }
  return 'system';
}

/** 실제로 적용된 값 (system 은 OS 설정으로 풀어서 알려 준다) */
function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: 'light' | 'dark';
  setChoice: (next: ThemeChoice) => void;
  /** 라이트 ↔ 다크 한 번에 (지금 보이는 것의 반대로) */
  toggle: () => void;
} {
  const [choice, setStoredChoice] = useState<ThemeChoice>(readStored);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readStored()));

  const setChoice = useCallback((next: ThemeChoice) => {
    setStoredChoice(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 저장에 실패해도 이번 세션에는 적용된다
    }
  }, []);

  // `system` 일 때 OS 설정이 바뀌면 따라간다
  useEffect(() => {
    setResolved(resolve(choice));
    if (choice !== 'system' || typeof matchMedia !== 'function') return;

    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setResolved(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  /**
   * `data-theme` 을 붙인다. `system` 이면 **속성을 지운다** —
   * 그래야 CSS 의 `prefers-color-scheme` 블록이 다시 살아난다.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  }, [choice]);

  const toggle = useCallback(() => {
    setChoice(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setChoice]);

  return { choice, resolved, setChoice, toggle };
}
