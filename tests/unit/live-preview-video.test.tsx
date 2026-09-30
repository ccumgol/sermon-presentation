// @vitest-environment jsdom
/**
 * **동영상 상태 줄** (`LivePreview` 의 재생 표시와 조작 단추).
 *
 * ## 왜 검사하는가
 *
 * 이 줄이 하는 일은 하나다 — **소리가 실제로 OBS 로 나가는지 예배 전에 알려 주는 것.**
 * 화면만 봐서는 알 수 없어서 둔 표시인데, 그 표시가 틀리면 둔 뜻이 없어진다.
 *
 * 실제로 여기서 한 번 틀렸다 (2026-09-29): 조작 화면의 작은 미리보기가 전력 절약으로
 * 멈추면 그 `AbortError` 를 「자동 재생이 막혔습니다」로 띄우고 **재생 단추까지
 * 숨겼다.** 멀쩡한데 고장 난 것으로 보였다. 그 갈림을 여기서 못 박는다.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LivePreview } from '../../src/control/components/LivePreview.tsx';
import type { VideoStatus } from '../../src/control/hooks/useLiveState.ts';

/*
 * jsdom 에는 `ResizeObserver` 가 없다. `LivePreview` 는 미리보기 iframe 의 배율을
 * 재는 데 그것을 쓴다 — 없으면 렌더가 통째로 죽어 **이 파일의 검사가 전부 실패한다.**
 * 배율은 여기서 볼 것이 아니므로 아무 일도 안 하는 것으로 끼운다.
 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

afterEach(cleanup);

function show(video: Partial<VideoStatus> | null, send = vi.fn()) {
  const status = video === null ? null : ({ layer: 'main', at_ms: 0, ...video } as VideoStatus);
  render(<LivePreview state={null} deck={null} video={status} send={send} connected />);
  return send;
}

describe('동영상 상태 줄', () => {
  it('영상이 없으면 줄이 아예 없다', () => {
    show(null);
    expect(document.querySelector('.video-line')).toBeNull();
  });

  it('소리가 나가는 중이면 그렇게 말한다', () => {
    show({ event: 'time', at: 12, duration: 220, muted: false, paused: false });
    const line = document.querySelector('.video-line')!;
    expect(line.textContent).toContain('0:12');
    expect(line.textContent).toContain('3:40');
    expect(line.textContent).toContain('소리 OBS 로 나감');
    expect(line.classList.contains('bad')).toBe(false);
  });

  it('음소거면 **소리 없음** 이라고 말한다', () => {
    // 이걸 놓치면 예배 중에 소리 없는 영상이 나간다
    show({ event: 'time', at: 0, duration: 10, muted: true, paused: false });
    expect(document.querySelector('.video-line')!.textContent).toContain('소리 없음');
  });

  it('길이를 모르면 --:-- 로 둔다 (0:00 이 아니다)', () => {
    // 0:00 으로 적으면 '길이가 0' 으로 읽힌다
    show({ event: 'time', at: 3, muted: false, paused: false });
    expect(document.querySelector('.video-line')!.textContent).toContain('--:--');
  });

  it('돌고 있으면 ⏸, 서 있으면 ▶ 가 나온다', () => {
    show({ event: 'time', paused: false, muted: false });
    expect(screen.getByRole('button', { name: /일시정지/ })).toBeTruthy();
    cleanup();

    show({ event: 'time', paused: true, muted: false });
    expect(screen.getByRole('button', { name: /재생/ })).toBeTruthy();
  });

  it('단추가 그 자리에 맞는 조작을 보낸다', () => {
    const send = show({ event: 'time', paused: false, muted: false });
    fireEvent.click(screen.getByRole('button', { name: /일시정지/ }));
    expect(send).toHaveBeenCalledWith({ t: 'video:control', action: 'pause' });

    cleanup();
    const send2 = show({ event: 'time', paused: true, muted: false });
    fireEvent.click(screen.getByRole('button', { name: /재생/ }));
    expect(send2).toHaveBeenCalledWith({ t: 'video:control', action: 'play' });

    fireEvent.click(screen.getByRole('button', { name: /멈춤/ }));
    expect(send2).toHaveBeenCalledWith({ t: 'video:control', action: 'stop' });
  });

  it('자동 재생 정책에 막힌 것만 경고로 띄운다', () => {
    show({ event: 'blocked', reason: 'NotAllowedError' });
    const line = document.querySelector('.video-line')!;
    expect(line.classList.contains('bad')).toBe(true);
    expect(line.textContent).toContain('오디오 제어');
    // 손볼 데가 있는 상황이라 조작 단추는 뜻이 없다
    expect(document.querySelector('.video-buttons')).toBeNull();
  });

  it('⚠️ 전력 절약으로 멈춘 것은 경고가 아니고, **단추도 그대로 있다**', () => {
    /*
     * 2026-09-29 에 실제로 틀렸던 자리다. 조작 화면의 작은 미리보기가 가려지면
     * 크롬이 소리 없는 영상을 멈추는데(AbortError), 그것까지 '막혔습니다' 로
     * 띄우는 바람에 멀쩡한 영상에 경고가 뜨고 재생 단추가 사라졌다.
     */
    show({ event: 'blocked', reason: 'AbortError', at: 5, duration: 10, muted: false, paused: false });
    const line = document.querySelector('.video-line')!;
    expect(line.classList.contains('bad')).toBe(false);
    expect(line.textContent).not.toContain('막혔습니다');
    expect(document.querySelector('.video-buttons')).toBeTruthy();
  });

  it('파일을 못 연 것은 형식을 보라고 한다', () => {
    show({ event: 'error' });
    const line = document.querySelector('.video-line')!;
    expect(line.classList.contains('bad')).toBe(true);
    expect(line.textContent).toContain('MP4');
  });

  it('끝난 영상은 줄을 지운다 — 다음 순서로 넘어갔다는 뜻이다', () => {
    show({ event: 'ended' });
    expect(document.querySelector('.video-line')).toBeNull();
  });

  it('조작 통로가 없으면 단추를 그리지 않는다', () => {
    // 태블릿처럼 읽기만 하는 화면에서 눌러도 아무 일이 없으면 고장으로 보인다
    render(<LivePreview state={null} deck={null} video={{ layer: 'main', at_ms: 0, event: 'time', muted: false } as VideoStatus} />);
    expect(document.querySelector('.video-line')).toBeTruthy();
    expect(document.querySelector('.video-buttons')).toBeNull();
  });
});
