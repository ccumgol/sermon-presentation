/**
 * **동영상 파일 판정** (`lib/video-files.ts`).
 *
 * ## 왜 검사하는가
 *
 * 이 판정이 틀리면 **예배 중에 화면이 안 나간다.** USB 로 받은 영상은 형식을
 * 고를 수 없고, 못 여는 형식인지는 예배 **전에** 알아야 한다.
 *
 * | 지키는 것 | 왜 |
 * |---|---|
 * | 못 열릴 수 있는 것도 **목록에 낸다** | 빼면 '파일을 잘못 넣었나' 하고 헤맨다 |
 * | 대신 **왜 위험한지** 말한다 | 그게 목록에 남겨 두는 값이다 |
 * | 대소문자를 가리지 않는다 | 카메라가 `.MP4` 로 쓴다 |
 * | 동영상이 아닌 것은 뺀다 | 자막·썸네일이 목록에 섞이면 고르기가 나빠진다 |
 */

import { describe, expect, it } from 'vitest';

import { isVideoFile, videoExtension, videoRisk, videoWarning } from '../../lib/video-files.ts';

describe('동영상 파일 가리기', () => {
  it('안전한 형식을 받는다', () => {
    for (const name of ['선교보고.mp4', 'clip.m4v', 'a.webm']) {
      expect(isVideoFile(name), name).toBe(true);
      expect(videoRisk(name), name).toBe('ok');
      expect(videoWarning(name), name).toBeUndefined();
    }
  });

  it('위험한 형식도 목록에는 낸다 — 다만 왜인지 말한다', () => {
    // 빼 버리면 '넣었는데 안 보인다' 가 되고 사람은 파일을 잘못 넣은 줄 안다
    for (const name of ['보고.mov', 'x.mkv', 'y.avi', 'z.wmv']) {
      expect(isVideoFile(name), name).toBe(true);
      expect(videoRisk(name), name).toBe('risky');
      expect(videoWarning(name), name).toBeTruthy();
    }
  });

  it('MOV 는 H.264 얘기를 해 준다 — 아이폰 영상이 대부분이라', () => {
    expect(videoWarning('IMG_1234.mov')).toContain('H.264');
  });

  it('위험 안내에 그 확장자가 들어간다', () => {
    // '안 될 수 있습니다' 만 있으면 무엇을 바꿔야 할지 모른다
    expect(videoWarning('a.mkv')).toContain('MKV');
    expect(videoWarning('a.avi')).toContain('AVI');
  });

  it('대소문자를 가리지 않는다', () => {
    // 카메라·휴대폰이 대문자로 쓴다
    expect(isVideoFile('VIDEO.MP4')).toBe(true);
    expect(videoRisk('VIDEO.MP4')).toBe('ok');
    expect(videoRisk('IMG.MOV')).toBe('risky');
  });

  it('동영상이 아닌 것은 뺀다', () => {
    for (const name of ['가사.txt', 'thumb.jpg', 'sub.srt', 'a.mp3', 'README', 'x.mp4.txt']) {
      expect(isVideoFile(name), name).toBe(false);
    }
  });

  it('확장자가 없는 이름에 걸려 죽지 않는다', () => {
    expect(videoExtension('movie')).toBe('');
    expect(isVideoFile('movie')).toBe(false);
    expect(isVideoFile('')).toBe(false);
  });

  it('점이 여럿이면 마지막 것만 본다', () => {
    // '2026.09.29 선교보고.mp4' 같은 이름이 실제로 온다
    expect(videoExtension('2026.09.29 선교보고.mp4')).toBe('.mp4');
    expect(isVideoFile('2026.09.29 선교보고.mp4')).toBe(true);
  });

  it('숨김 파일 이름도 확장자로만 판단한다', () => {
    // 목록에서 빼는 것은 스캐너가 한다 — 여기서 두 번 막으면 한쪽이 뒤처진다
    expect(isVideoFile('.hidden.mp4')).toBe(true);
  });
});
