/*
 * 프로젝터 화면의 조작 부분. 의존성 0.
 *
 * 렌더는 `/output/output.js` 가 한다 (이 파일보다 먼저 실행된다). 여기서 하는 일은
 * 네 가지뿐이다 — 글자 크기, 색 반전, 전체 화면, 막대 숨기기.
 *
 * ## 왜 렌더러를 건드리지 않는가
 *
 * 성경·찬양·교독문·전례문 렌더러는 1044줄이고 예배 중에 도는 코드다. 이 화면 때문에
 * 그것을 고치면 OBS 송출까지 위험해진다. 그래서 **CSS 변수만 만지고**, 렌더러가
 * 이미 열어 둔 문(`window.SermonOutput`)으로만 들여다본다.
 *
 * ## 저장한다
 *
 * 글자 크기와 반전은 브라우저에 남긴다. 예배 중에 창을 다시 열 일이 생겼을 때
 * 다시 맞추게 하면 안 된다.
 */
(function () {
  'use strict';

  var el = {
    body: document.body,
    bar: document.getElementById('bar'),
    zoomValue: document.getElementById('zoom-value'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    invert: document.getElementById('invert'),
    full: document.getElementById('full'),
    overflow: document.getElementById('overflow'),
    sheet: document.getElementById('sheet'),
    hint: document.getElementById('hint'),
  };

  // ── 저장 ─────────────────────────────────────────────────────
  var ZOOM_KEY = 'sermon.projector.zoom';
  var INVERT_KEY = 'sermon.projector.invert';
  /*
   * '전체 화면으로 쓰고 있었다' 를 기억한다.
   *
   * 브라우저는 **사용자 동작 없이는** 전체 화면으로 들어가지 못한다 (규칙이고, 우회할
   * 방법이 없다). 그래서 자동으로 켜 줄 수는 없지만, 다음에 열었을 때 **첫 클릭이나
   * 첫 키 입력**에 얹어 줄 수는 있다 — 매주 F 를 찾아 누르지 않아도 된다.
   */
  var FULL_KEY = 'sermon.projector.fullscreen';

  /** localStorage 는 없거나 막혀 있을 수 있다. 그때도 화면은 떠야 한다 */
  function save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* 저장만 안 된다. 화면은 그대로 쓴다 */
    }
  }

  function load(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  // ── 글자 크기 ────────────────────────────────────────────────
  /*
   * 0.5 ~ 2.5 배. 프로젝터·거리·예배당 크기가 교회마다 달라 고정할 수 없다.
   * 배수를 곱하는 자리는 projector.css 의 `--proj-zoom` 이다.
   */
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 2.5;
  var ZOOM_STEP = 0.1;
  var zoom = 1;

  function clampZoom(value) {
    if (!isFinite(value)) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
  }

  function applyZoom(next, persist) {
    zoom = clampZoom(next);
    el.body.style.setProperty('--proj-zoom', String(zoom));
    if (el.zoomValue) el.zoomValue.textContent = Math.round(zoom * 100) + '%';
    if (persist) save(ZOOM_KEY, String(zoom));
    checkOverflow();
  }

  // ── 색 반전 ──────────────────────────────────────────────────
  var inverted = false;

  function applyInvert(next, persist) {
    inverted = !!next;
    el.body.classList.toggle('inverted', inverted);
    if (el.invert) {
      el.invert.textContent = inverted ? '반전 해제' : '반전';
      el.invert.setAttribute('aria-pressed', inverted ? 'true' : 'false');
    }
    if (persist) save(INVERT_KEY, inverted ? '1' : '0');
  }

  // ── 넘침 알림 ────────────────────────────────────────────────
  /*
   * 이 화면은 autoFit 을 끈다 (서버가 `autoFitMinScale: 1` 로 보낸다).
   * 켜 두면 + 로 키운 만큼 되돌려 깎아서 **글자 크기가 안 바뀌는 것처럼 보인다.**
   * 대신 넘칠 때는 알려야 한다 — 잘린 글을 조작자가 눈치채지 못하면 회중이 못 읽는다.
   */
  function checkOverflow() {
    if (!el.overflow) return;
    var api = window.SermonOutput;
    if (!api || typeof api.measure !== 'function') return;
    try {
      el.overflow.hidden = !api.measure().overflow;
    } catch (err) {
      el.overflow.hidden = true;
    }
  }

  // ── 막대 보이기/숨기기 ───────────────────────────────────────
  /*
   * 요청: 평소에는 안 보이고 마우스를 올릴 때만. 영상 재생기와 같은 방식으로
   * **아무 곳에서나** 마우스를 움직이면 나온다 — 상단만 반응하게 하면 보이지 않는
   * 막대를 마우스로 찾아야 한다.
   */
  var HIDE_AFTER = 2500;
  var hideTimer = null;
  var pointerOnBar = false;

  function showBar() {
    if (el.bar) el.bar.hidden = false;
    // 아직 전체 화면이 아니면 방법을 함께 알려 준다 (막대와 같이 나오고 같이 숨는다)
    if (el.hint) el.hint.hidden = isFull();
    el.body.classList.add('bar-shown');
    checkOverflow();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBar, HIDE_AFTER);
  }

  function hideBar() {
    hideTimer = null;
    // 막대 위에 마우스가 있으면 숨기지 않는다 — 누르려는 중이다
    if (pointerOnBar) {
      hideTimer = setTimeout(hideBar, HIDE_AFTER);
      return;
    }
    if (el.bar) el.bar.hidden = true;
    if (el.hint) el.hint.hidden = true;
    el.body.classList.remove('bar-shown');
  }

  window.addEventListener('mousemove', showBar);
  // 터치 화면(태블릿을 프로젝터에 물린 경우)에서도 나와야 한다
  window.addEventListener('touchstart', showBar, { passive: true });

  if (el.bar) {
    el.bar.addEventListener('mouseenter', function () {
      pointerOnBar = true;
    });
    el.bar.addEventListener('mouseleave', function () {
      pointerOnBar = false;
    });
  }

  // ── 전체 화면 ────────────────────────────────────────────────
  /*
   * **브라우저 주소줄은 웹페이지가 지울 수 없다.** 전체 화면이 유일한 방법이고,
   * 그래서 요청("주소줄을 없애고 풀 스크린")이 한 가지 동작으로 모인다.
   *
   * 전체 화면은 사용자의 클릭·키 입력에서만 시작할 수 있다 (브라우저 규칙).
   * 그래서 창을 열자마자 저절로 되지는 않는다 — 아래 안내가 그것을 알린다.
   */
  /** 지금 전체 화면인가 */
  function isFull() {
    return !!document.fullscreenElement;
  }

  function enterFull() {
    if (isFull()) return;
    try {
      var promise = document.documentElement.requestFullscreen();
      // 거절되면(사용자 동작이 아니었다) 조용히 넘긴다. 콘솔 오류만 남지 않게 한다
      if (promise && typeof promise.catch === 'function') promise.catch(function () {});
    } catch (err) {
      /* 막혀 있으면 그냥 창 모드로 쓴다. 화면은 정상이다 */
    }
  }

  function toggleFull() {
    if (isFull()) {
      try {
        document.exitFullscreen();
      } catch (err) {
        /* 이미 나와 있다 */
      }
      // 사람이 **직접** 나갔으면 다음에도 창 모드로 여는 것이 뜻에 맞다
      save(FULL_KEY, '0');
      return;
    }
    save(FULL_KEY, '1');
    enterFull();
  }

  /*
   * 지난번에 전체 화면으로 쓰고 있었다면, **첫 동작**에 얹어 들어간다.
   *
   * 마우스 이동은 세지 않는다 — 브라우저가 그것을 '사용자 동작' 으로 인정하지 않아
   * 거절되고, 거절된 뒤에는 다시 시도할 기회를 잃는다. 클릭과 키 입력만 센다.
   */
  var pendingAutoFull = load(FULL_KEY) === '1';

  function autoFullOnce() {
    if (!pendingAutoFull) return;
    pendingAutoFull = false;
    enterFull();
  }

  function syncFullLabel() {
    if (el.full) el.full.textContent = isFull() ? '전체 화면 해제' : '전체 화면';
    /*
     * 안내는 **전체 화면이 아닐 때만** 뜻이 있다. 다 됐는데도 계속 띄우면 프로젝터에
     * 같은 자리가 오래 비쳐 번인 위험이 있다.
     */
    if (el.hint) el.hint.hidden = isFull();
  }

  document.addEventListener('fullscreenchange', function () {
    syncFullLabel();
    // 화면 크기가 바뀌면 넘침 여부도 바뀐다
    setTimeout(checkOverflow, 150);
  });

  // ── 버튼·키 ──────────────────────────────────────────────────
  if (el.zoomIn) {
    el.zoomIn.addEventListener('click', function () {
      applyZoom(zoom + ZOOM_STEP, true);
    });
  }
  if (el.zoomOut) {
    el.zoomOut.addEventListener('click', function () {
      applyZoom(zoom - ZOOM_STEP, true);
    });
  }
  if (el.invert) {
    el.invert.addEventListener('click', function () {
      applyInvert(!inverted, true);
    });
  }
  if (el.full) el.full.addEventListener('click', toggleFull);

  /*
   * **화면을 클릭하면 전체 화면.**
   *
   * `F` 를 눌러야 하는 것을 모르면 주소줄을 없앨 방법을 찾을 수 없다 (사용자가 실제로
   * 스크린샷으로 물어봤다, 2026-08-20). 클릭이 가장 찾기 쉬운 동작이다.
   *
   * 나가는 것은 여기에 얹지 않는다 — 예배 중 실수로 클릭했을 때 벽에 브라우저 창이
   * 드러나면 안 된다. 나가려면 막대의 버튼이나 `F`·`Esc` 를 쓴다.
   */
  document.addEventListener('click', function (event) {
    // 막대를 누른 것은 조작이다. 그 클릭으로 전체 화면에 들어가지 않는다 —
    // 단, 지난번에 전체 화면이었다면 그 동작에 얹어 들어간다
    if (el.bar && el.bar.contains(event.target)) {
      autoFullOnce();
      return;
    }
    if (isFull()) return;
    pendingAutoFull = false;
    save(FULL_KEY, '1');
    enterFull();
  });

  // ── 가사 대신 악보 ───────────────────────────────────────────
  /*
   * 곡 슬라이드가 악보 조각(`sheet`)을 **들고 왔을 때만** 악보를 그린다.
   * OBS 화면과 강사 모니터는 언제나 가사다 (사용자 결정: 강사 모니터에는
   * 가사가 나가야 한다).
   *
   * ## 주인은 조작 화면이다 (2026-09-04 에 바뀌었다)
   *
   * 악보로 낼지는 **조작 화면**이 항목마다 정하고, 서버가 그 결정대로 `sheet` 를
   * 싣거나 뺀다. 여기서는 실려 온 것을 그릴 뿐이다.
   *
   * 전에는 이 창의 `S` 키가 주인이었는데 두 가지가 나빴다:
   *   · 프로젝터 창은 대개 다른 화면에 있어 손이 닿지 않는다
   *   · **보이지 않는 스위치**라 한 번 끄면 되돌리는 법을 알 수 없었다
   *     (사용자 보고 — 실제로 그렇게 막혔다)
   *
   * ## 그래도 이 창에 끄는 길을 남긴다
   *
   * 악보가 이상하게 잘려 나갈 때 **가장 빠른 탈출구**가 여기다. 다만
   * **저장하지 않는다** — 다음에 창을 열면 다시 조작 화면을 따른다. 지난주에
   * 꺼 둔 것이 이번 주에도 꺼져 있으면 그게 바로 사용자가 겪은 함정이다.
   * 그리고 막대에 **보이는 단추**로 둔다 (아래 syncSheetButton).
   */
  var sheetOn = true;

  window.SermonSlideFilter = function (slide) {
    if (!sheetOn || !slide || slide.kind !== 'song' || !slide.sheet) return slide;
    return {
      kind: 'image',
      src: slide.sheet.src,
      alt: (slide.title || '') + ' ' + (slide.sectionLabel || ''),
      crop: slide.sheet.crop,
    };
  };

  /**
   * 지금 화면에 악보를 낼 수 있는가 — 슬라이드가 악보를 들고 왔는가.
   * 낼 수 없으면 단추를 흐리게 한다. 눌러도 아무 일이 없으면 고장으로 보인다.
   */
  function sheetAvailable() {
    var api = window.SermonOutput;
    var slide = api && typeof api.currentSlide === 'function' ? api.currentSlide() : null;
    return !!(slide && slide.kind === 'song' && slide.sheet);
  }

  function syncSheetButton() {
    if (!el.sheet) return;
    var can = sheetAvailable();
    var showing = sheetOn && can;
    el.sheet.disabled = !can;
    // 글자는 **지금 나가고 있는 것**이다. 악보가 실려 오지 않은 화면에서 '악보' 라고
    // 적혀 있으면, 악보가 나가는 줄 알고 벽을 다시 쳐다보게 된다
    el.sheet.textContent = showing ? '악보' : '가사';
    el.sheet.classList.toggle('on', showing);
    el.sheet.title = can
      ? sheetOn
        ? '지금 악보가 나갑니다 — 누르면 가사로 바뀝니다 (S)'
        : '지금 가사가 나갑니다 — 누르면 악보로 돌아갑니다 (S)'
      : '이 화면에는 악보가 없습니다 (조작 화면의 찬양 항목에서 켭니다)';
  }

  /** 지금 화면을 새 설정으로 다시 그린다 — 다음 슬라이드까지 기다리지 않게 */
  function applySheet(next) {
    sheetOn = next;
    var api = window.SermonOutput;
    if (api && typeof api.redraw === 'function') api.redraw();
    syncSheetButton();
  }

  if (el.sheet) el.sheet.addEventListener('click', function () { applySheet(!sheetOn); });

  window.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // 지난번에 전체 화면이었다면 아무 키에서든 들어간다 (아래 처리보다 먼저)
    autoFullOnce();
    var key = event.key;
    if (key === '+' || key === '=') applyZoom(zoom + ZOOM_STEP, true);
    else if (key === '-' || key === '_') applyZoom(zoom - ZOOM_STEP, true);
    else if (key === '0') applyZoom(1, true);
    else if (key === 'i' || key === 'I') applyInvert(!inverted, true);
    else if (key === 'f' || key === 'F') toggleFull();
    else if (key === 's' || key === 'S') applySheet(!sheetOn);
    else return;
    event.preventDefault();
    showBar();
  });

  // 창 크기가 바뀌면 넘침 여부가 달라진다 (output.js 가 자기 몫을 한 뒤에 본다)
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      checkOverflow();
    }, 200);
  });

  // ── 시작 ─────────────────────────────────────────────────────
  applyZoom(parseFloat(load(ZOOM_KEY) || '1'), false);
  applyInvert(load(INVERT_KEY) === '1', false);
  syncFullLabel();
  syncSheetButton();

  /*
   * 처음 열었을 때 막대를 잠깐 보여 준다. 이것이 없으면 **아무것도 없는 검은 화면**이
   * 뜨고, 마우스를 움직여야 조작이 나오는 것을 알 방법이 없다.
   *
   * 안내는 `showBar`/`hideBar` 가 막대와 함께 다룬다 (전체 화면이 아닐 때만).
   * 상시 표시하지 않는 이유는 프로젝터 번인이다.
   */
  showBar();

  // 새 슬라이드가 그려지면 넘침 여부가 바뀐다. 렌더러를 고치지 않고 화면을 지켜본다 —
  // 예배 중에 도는 코드에 손을 대는 것보다 이쪽이 안전하다.
  if (typeof MutationObserver === 'function') {
    var blocks = document.getElementById('blocks');
    if (blocks) {
      new MutationObserver(function () {
        checkOverflow();
        // 새 슬라이드에 악보가 있는지 없는지에 따라 단추가 살거나 흐려진다
        syncSheetButton();
      }).observe(blocks, { childList: true, subtree: true, characterData: true });
    }
  }
})();
