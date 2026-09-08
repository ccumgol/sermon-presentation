/**
 * **배경으로 쓸 그림 목록** — 예배 순서 탭이 고를 수 있는 것들.
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-08). 상태 넷이 화면 블록 셋에 흩어져 있어서,
 * 자를 때마다 프롭이 늘었다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 칸을 **열 때마다** 다시 읽는다 | 템플릿 탭에서 올린 것을 여기서도 골라야 한다 |
 * | 기본 설정 칸도 센다 | 빼먹으면 설정을 열었을 때 목록이 비어 '배경이 없다' 고 오해한다 |
 * | 못 읽어도 **작업이 멈추지 않는다** | 고를 파일이 없을 뿐이다. 배너를 띄우지 않는다 |
 * | 폴더 경로를 들고 있는다 | 고를 폴더가 없을 때 '어디에 넣어야 하는지' 를 알려 준다 |
 */

import { useCallback, useEffect, useState } from 'react';

import type { CueItem } from '../../../shared/types.ts';
import { api, type BackgroundFile } from '../api.ts';

/** 슬라이드쇼가 가리킬 수 있는 하위 폴더 (그림이 있는 것만) */
export interface BackgroundFolders {
  library: Array<{ name: string; count: number }>;
  data: Array<{ name: string; count: number }>;
}

export interface PlanBackgrounds {
  /** `data/backgrounds/` 파일 목록 — 그림·동영상 항목이 여기서 고른다 */
  files: BackgroundFile[];
  /** `~/Desktop/Data/Background` 의 그림들 — 전례문·교독문 배경을 여기서 고른다 */
  library: BackgroundFile[];
  folders: BackgroundFolders;
  /** 고를 폴더가 없을 때 '어디에 넣어야 하는지' 를 알려 주려고 들고 있는다 */
  dirs: { library: string; data: string };
  /** 지금 다시 읽는다 (템플릿 탭에서 올린 직후 등) */
  reload: () => Promise<void>;
}

export function usePlanBackgrounds(options: {
  /** 기본 설정 칸을 펼쳤는지 — 그 안에도 배경 드롭다운이 있다 */
  defaultsOpen: boolean;
  /** 지금 고른 추가 종류 — 배경을 고르는 종류면 미리 읽어 둔다 */
  addKind: string;
  /** 순서표의 항목들 — 전례문·교독문이 있으면 편집 칸에서 배경을 고른다 */
  items: readonly CueItem[];
}): PlanBackgrounds {
  const { defaultsOpen, addKind, items } = options;

  const [files, setFiles] = useState<BackgroundFile[]>([]);
  const [library, setLibrary] = useState<BackgroundFile[]>([]);
  const [folders, setFolders] = useState<BackgroundFolders>({ library: [], data: [] });
  const [dirs, setDirs] = useState<{ library: string; data: string }>({ library: '', data: '' });

  /**
   * 배경 폴더 파일 목록. 템플릿 탭에서 올린 것을 여기서도 골라야 하므로
   * 그림·동영상 칸을 열 때마다 다시 읽는다.
   */
  const reload = useCallback(async () => {
    try {
      const result = await api.backgrounds();
      setFiles(result.files);
      setLibrary(result.library ?? []);
      setFolders(result.folders ?? { library: [], data: [] });
      setDirs({ library: result.libraryDir ?? '', data: result.dataDir ?? '' });
    } catch {
      // 목록을 못 읽어도 순서표 작업은 계속돼야 한다 — 고를 파일이 없을 뿐이다
      setFiles([]);
      setLibrary([]);
      setFolders({ library: [], data: [] });
    }
  }, []);

  useEffect(() => {
    // 기본 설정 칸에도 배경 드롭다운이 있다. 이걸 빼먹으면 설정을 열었을 때
    // 목록이 비어 '배경이 없다'고 오해한다.
    const needsFiles =
      defaultsOpen ||
      addKind === 'liturgy' ||
      addKind === 'reading' ||
      addKind === 'slideshow' ||
      items.some((i) => i.type === 'liturgy' || i.type === 'reading');
    if (needsFiles) void reload();
  }, [defaultsOpen, addKind, items, reload]);

  return { files, library, folders, dirs, reload };
}
