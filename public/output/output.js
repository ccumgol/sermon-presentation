/*
 * 출력 페이지 스크립트. 의존성 0, 빌드 단계 없음.
 *
 * Phase 0 범위: 쿼리 파라미터 처리, 데모 렌더, 진단 배지.
 * Phase 2 에서 이 파일에 WebSocket 클라이언트를 추가한다 (아래 TODO 지점).
 *
 * 절대 원칙: 어떤 오류 상황에서도 화면을 스스로 비우지 않는다.
 * 예배 중 검은 화면은 치명적이므로, 마지막으로 성공한 렌더를 유지한다.
 */
(function () {
  'use strict';

  /** 이 페이지가 로드된 시각 — 옛 판인지 서버가 판정하는 데 쓴다 */
  var LOADED_AT = Date.now();

  var params = new URLSearchParams(location.search);
  var opts = {
    layer: params.get('layer') || 'main',
    preview: params.get('preview') === '1',
    debug: params.get('debug') === '1',
    demo: params.get('demo') === '1',
    // 측정 전용 모드 — WS 에 붙지 않는다. 컨트롤 패널이 숨긴 iframe 으로 쓴다.
    measure: params.get('measure') === '1',
  };

  var el = {
    body: document.body,
    backdrop: document.getElementById('backdrop'),
    stage: document.getElementById('stage'),
    slide: document.getElementById('slide'),
    blocks: document.getElementById('blocks'),
    heading: document.getElementById('heading'),
    reference: document.getElementById('reference'),
    credit: document.getElementById('credit'),
    debug: document.getElementById('debug'),
  };

  if (opts.preview) el.body.classList.add('preview');

  // ── 진단 배지 ────────────────────────────────────────────────
  var diag = { layer: opts.layer, revision: 0, ws: 'off', lastRender: '-', errors: 0, dropped: 0, fit: '1' };

  // 현재 템플릿. behavior(절 번호 표시 여부 등)와 언어별 override 에 쓴다.
  var template = null;
  var lastSlide = null;
  var lastFit = { overflow: false, scale: 1 };

  function renderDebug() {
    if (!opts.debug) return;
    el.debug.hidden = false;
    el.debug.textContent = Object.keys(diag)
      .map(function (k) {
        return k + ': ' + diag[k];
      })
      .join('\n');
  }

  // 출력 페이지에서 발생한 오류는 서버로 보고해 컨트롤 패널에 경고를 띄운다.
  // (Phase 2 에서 WS 로 실제 전송. 지금은 수집만 한다.)
  var pendingErrors = [];
  window.addEventListener('error', function (e) {
    diag.errors++;
    pendingErrors.push({ message: String(e.message), stack: e.error && e.error.stack, url: location.href });
    renderDebug();
  });

  // ── 앵커 → CSS 변수 ──────────────────────────────────────────
  var ANCHOR_MAP = {
    'top-left': ['start', 'start'],
    'top-center': ['center', 'start'],
    'top-right': ['end', 'start'],
    'mid-left': ['start', 'center'],
    center: ['center', 'center'],
    'mid-right': ['end', 'center'],
    'bottom-left': ['start', 'end'],
    'bottom-center': ['center', 'end'],
    'bottom-right': ['end', 'end'],
  };

  function applyAnchor(anchor) {
    var pair = ANCHOR_MAP[anchor] || ANCHOR_MAP['bottom-center'];
    document.documentElement.style.setProperty('--justify', pair[0]);
    document.documentElement.style.setProperty('--align', pair[1]);
  }

  /** 서버가 보내는 CSS 변수 패치를 그대로 적용한다. DOM 재구성 없음. */
  function applyStylePatch(patch) {
    var root = document.documentElement;
    Object.keys(patch).forEach(function (key) {
      if (key === 'anchor') {
        applyAnchor(patch[key]);
        return;
      }
      // 배경 그림·동영상은 요소를 만들어야 해서 CSS 변수로 표현할 수 없다.
      // 편집 중 style:set 으로도 오므로 여기서 함께 처리한다(저장 전 즉시 반영).
      if (key === 'backdrop') {
        applyBackdropFromString(patch[key]);
        return;
      }
      root.style.setProperty(key, String(patch[key]));
    });
  }

  /** '{"mode":"image","src":"a.jpg"}' 또는 빈 문자열 */
  function applyBackdropFromString(value) {
    if (!value) {
      applyBackdrop(null);
      return;
    }
    try {
      applyBackdrop(JSON.parse(value));
    } catch (err) {
      // 값이 깨져도 화면은 그대로 둔다
      diag.errors++;
      renderDebug();
    }
  }

  /**
   * 언어·역본별 스타일 override 를 블록에 인라인으로 적용한다.
   *
   * CSS 변수는 문서 전역이라 "헬라어 블록만 다른 폰트"를 표현할 수 없다.
   * 그래서 해당 블록 요소에만 직접 붙인다 (역본 지정이 언어 지정보다 구체적이므로 나중에 덮는다).
   */
  function applyBlockOverrides(node, role, translationId, lang) {
    if (!template) return;
    var byLang = (template.overridesByLang || {})[lang];
    var byTranslation = (template.overridesByTranslation || {})[translationId];
    if (!byLang && !byTranslation) return;

    var merged = {};
    if (byLang) Object.keys(byLang).forEach(function (k) { merged[k] = byLang[k]; });
    if (byTranslation) Object.keys(byTranslation).forEach(function (k) { merged[k] = byTranslation[k]; });

    if (merged.fontFamily) node.style.fontFamily = merged.fontFamily;
    if (merged.fontSize) node.style.fontSize = merged.fontSize + 'px';
    if (merged.fontWeight) node.style.fontWeight = String(merged.fontWeight);
    if (merged.lineHeight) node.style.lineHeight = String(merged.lineHeight);
    if (merged.color) node.style.color = merged.color;
    if (merged.italic !== undefined) node.style.fontStyle = merged.italic ? 'italic' : 'normal';
    if (merged.wordBreak) node.style.wordBreak = merged.wordBreak;
  }

  // ── 렌더 ─────────────────────────────────────────────────────

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ── 배경 그림·동영상 ─────────────────────────────────────────
  //
  // 카메라 영상이 없을 때 자막 뒤에 깐다. 지금 무엇이 깔려 있는지 기억해 두고
  // **같으면 다시 만들지 않는다** — 템플릿 메시지가 올 때마다 새로 만들면
  // 반복 동영상이 매번 처음으로 되감겨 화면이 튄다.
  var backdropKey = '';

  function applyBackdrop(background) {
    var mode = background && background.mode;
    var src = background && background.src;
    var key = mode === 'image' || mode === 'video' ? mode + ':' + src : '';

    // 같은 파일이면 아무것도 하지 않는다 — 맞춤·불투명도는 CSS 변수
    // (--backdrop-fit / --backdrop-opacity)로 따로 오므로 다시 만들 필요가 없다.
    if (key === backdropKey) return;
    backdropKey = key;
    clearChildren(el.backdrop);
    if (!key || !src) return;

    var node;
    if (mode === 'video') {
      node = document.createElement('video');
      node.muted = true; // 자동 재생은 음소거일 때만 허용된다
      node.loop = true;
      node.autoplay = true;
      node.playsInline = true;
    } else {
      node = document.createElement('img');
    }

    // 파일이 없거나 코덱을 못 읽어도 **화면을 비우지 않는다** — 배경만 빠진다.
    // 대신 컨트롤 패널이 알 수 있게 오류로 올린다.
    node.addEventListener('error', function () {
      clearChildren(el.backdrop);
      backdropKey = '';
      diag.errors++;
      pendingErrors.push({ message: '배경 파일을 불러오지 못했습니다: ' + src, url: location.href });
      renderDebug();
    });

    node.src = '/backgrounds/' + encodeURIComponent(src);
    el.backdrop.appendChild(node);

    if (mode === 'video' && typeof node.play === 'function') tryPlay(node);
  }

  /**
   * 배경 동영상 재생 시도.
   *
   * **송출을 멈추지 않는다** — 자동 재생이 막혀도 배경만 첫 프레임에서 멈춘다.
   * 그런데 그냥 삼키면 '동영상이 왜 안 움직이나' 를 알 길이 없다. 브라우저는
   * 화면에 그려지지 않는 동안(OBS 소스가 감춰졌거나 장면이 바뀐 동안) 재생을
   * 미루므로, **다시 보이게 될 때 한 번 더 시도한다.** 그래야 장면을 되돌렸을 때
   * 얼어붙은 그림이 남지 않는다.
   */
  function tryPlay(node) {
    var started = node.play();
    if (!started || typeof started.catch !== 'function') return;

    started.catch(function () {
      if (document.visibilityState === 'visible') {
        // 보이는데도 막혔다 — 조작자가 알아야 한다 (진단 배지·컨트롤 패널)
        diag.errors++;
        pendingErrors.push({
          message: '배경 동영상 자동 재생이 막혀 첫 화면에서 멈췄습니다',
          url: location.href,
        });
        renderDebug();
        return;
      }
      // 아직 안 보이는 것뿐이다 — 보이게 되면 다시 시도한다
      document.addEventListener('visibilitychange', function retry() {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', retry);
        // 그 사이 배경이 바뀌었으면 이 노드는 이미 떨어져 나갔다
        if (node.isConnected) tryPlay(node);
      });
    });
  }


  /** 성경 본문 블록 렌더 */
  function renderBible(payload) {
    clearChildren(el.blocks);
    var behavior = (template && template.behavior) || {};
    var showNums = behavior.showVerseNumbers !== false;

    payload.blocks.forEach(function (block, index) {
      var div = document.createElement('div');
      div.className = 'block ' + (index === 0 ? 'line-primary' : 'line-secondary');
      div.setAttribute('dir', block.direction === 'rtl' ? 'rtl' : 'ltr');
      div.setAttribute('data-translation', block.translationId);
      div.setAttribute('data-lang', block.lang);
      applyBlockOverrides(div, index === 0 ? 'primary' : 'secondary', block.translationId, block.lang);

      if (block.unavailable) {
        // 역본에 해당 본문이 없을 때(헬라어로 구약 조회 등) 화면에 오류를 띄우지 않는다.
        // 블록 자체를 비워 조용히 넘긴다 — 송출 화면에 기술적 메시지가 보이면 안 된다.
        return;
      }

      block.verses.forEach(function (v) {
        var span = document.createElement('span');
        span.className = 'verse';
        if (showNums) {
          var num = document.createElement('span');
          num.className = 'verse-num';
          num.textContent = String(v.verse);
          span.appendChild(num);
        }
        span.appendChild(document.createTextNode(v.text + ' '));
        div.appendChild(span);
      });

      el.blocks.appendChild(div);
    });

    setOptional(el.heading, behavior.showHeadings === false ? null : payload.heading);
    setOptional(el.reference, behavior.showReference === 'none' ? null : payload.reference);
    setOptional(el.credit, null);

    // 참조를 위에 둘지 아래에 둘지 — DOM 순서를 바꿔 반영한다
    if (behavior.showReference === 'top') el.slide.insertBefore(el.reference, el.blocks);
    else el.slide.appendChild(el.reference);
  }

  /**
   * 섹션 라벨에서 절 번호 접두사를 만든다 — '1절' → '1. '
   *
   * ⚠️ lib/song-slides.ts 의 verseNumberPrefix 와 **같은 규칙이어야 한다.**
   * 출력 페이지는 의존성 0 이라 그 모듈을 가져다 쓸 수 없다(ANCHOR_MAP 과 같은 사정).
   * 번호가 없는 섹션(후렴·브리지)은 붙이지 않는다.
   */
  function verseNumberPrefix(sectionLabel) {
    var matched = /(\d+)/.exec(sectionLabel || '');
    return matched ? matched[1] + '. ' : '';
  }

  /** 찬양 가사 렌더 — 각 줄은 언어별 페어 묶음 */
  function renderSong(payload) {
    clearChildren(el.blocks);

    // 절 번호는 **그 절의 첫 장, 첫 줄에만** 붙인다
    var prefix = payload.sectionStart ? verseNumberPrefix(payload.sectionLabel) : '';

    payload.lines.forEach(function (pair, lineIndex) {
      var lineWrap = document.createElement('div');
      lineWrap.className = 'song-line';

      pair.forEach(function (part, i) {
        var div = document.createElement('div');
        div.className = i === 0 ? 'line-primary' : 'line-secondary';
        div.setAttribute('data-lang', part.lang);
        applyBlockOverrides(div, i === 0 ? 'primary' : 'secondary', '', part.lang);

        // 주 언어의 첫 줄에만 번호를 얹는다. 보조 언어(번역)에는 붙이지 않는다 —
        // 같은 번호가 두 번 보이면 줄이 어긋나 보인다.
        if (prefix && lineIndex === 0 && i === 0) {
          var num = document.createElement('span');
          num.className = 'verse-no';
          num.textContent = prefix;
          div.appendChild(num);
          div.appendChild(document.createTextNode(part.text));
        } else {
          div.textContent = part.text;
        }
        lineWrap.appendChild(div);
      });

      el.blocks.appendChild(lineWrap);
    });

    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, payload.credit);
  }

  function renderText(payload) {
    clearChildren(el.blocks);
    payload.lines.forEach(function (line) {
      var div = document.createElement('div');
      div.className = 'line-primary';
      div.textContent = line;
      el.blocks.appendChild(div);
    });
    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, null);
  }

  /**
   * 순서 이름을 **글자마다 크기와 높이를 달리해** 채운다 (붓글씨 같은 리듬).
   *
   * 규칙은 파도(cos) 하나다. 무작위를 쓰지 않는 이유가 중요하다 —
   * 무작위면 새로고침하거나 다시 그릴 때마다 글자 배치가 달라져, 예배 중
   * 같은 순서가 매번 다른 모양으로 나간다. 정해진 규칙이라 언제나 같다.
   *
   * 걸음(0.9)을 유리수로 딱 떨어지지 않게 둬서 2~5글자에서 기계적인 반복이
   * 보이지 않게 했다. 작아진 글자는 그만큼 아래로 내려 아랫선을 흔든다.
   */
  /*
   * 자동 리듬의 네 글자 표 (2026-08-15 사용자 지정).
   *
   * ⚠️ lib/order-rhythm.ts 의 AUTO_PATTERN 과 **같은 값이어야 한다.**
   * 출력 페이지는 의존성 0 원칙 때문에 그 모듈을 가져다 쓸 수 없다(ANCHOR_MAP 과 같은 사정).
   * 어긋나면 컨트롤 패널의 슬라이더 눈금과 실제 화면이 달라진다.
   */
  var AUTO_PATTERN = [
    { size: 1.0, dy: 0 },
    { size: 0.96, dy: -0.19 },
    { size: 0.9, dy: 0.1 },
    { size: 0.9, dy: -0.05 },
  ];

  function fillRhythmicText(node, text, charStyles) {
    clearChildren(node);
    var manual = charStyles || [];
    // 공백을 뺀 글자 순서 = 슬라이더 한 줄. lib/order-rhythm.ts 의 adjustableChars 와 같아야 한다.
    var manualIndex = 0;

    var root = getComputedStyle(document.documentElement);
    var amount = parseFloat(root.getPropertyValue('--title-rhythm'));
    // 높낮이는 크기와 **따로** 조절한다. 크기만 흔들고 아랫선은 가지런히 두거나,
    // 크기는 그대로 두고 높낮이만 흔드는 배치가 각각 쓸모가 있다.
    var amountY = parseFloat(root.getPropertyValue('--title-rhythm-y'));
    if (!(amount > 0)) amount = 0;
    if (!(amountY > 0)) amountY = 0;

    // 자동 리듬이 꺼져 있고 사람이 만진 글자도 없으면 쪼갤 이유가 없다
    var hasManual = manual.some(function (style) {
      return style && (typeof style.size === 'number' || typeof style.dy === 'number');
    });
    if (amount === 0 && amountY === 0 && !hasManual) {
      node.textContent = text;
      return;
    }

    // 어절 단위로 나눈다. 띄어쓰기를 넘어가면 리듬을 처음부터 다시 탄다 —
    // '찬양과 경배' 처럼 **뒤 어절의 첫 글자가 다시 커져야** 캡처의 리듬이 된다.
    var words = text.split(' ');
    for (var w = 0; w < words.length; w++) {
      if (w > 0) node.appendChild(document.createTextNode(' ')); // 공백은 감싸지 않는다(줄바꿈 기회 유지)
      var chars = Array.from(words[w]);

      for (var i = 0; i < chars.length; i++) {
        // 표는 네 글자까지만. 그 뒤는 흔들지 않고 글자별 조정에 맡긴다
        var pattern = AUTO_PATTERN[i] || { size: 1, dy: 0 };
        // 사람이 슬라이더로 만진 글자는 그 값이 이긴다. 만지지 않은 글자만 자동 리듬.
        var style = manual[manualIndex] || {};
        manualIndex += 1;
        var size = typeof style.size === 'number' ? style.size : 1 + (pattern.size - 1) * amount;
        var dy = typeof style.dy === 'number' ? style.dy : pattern.dy * amountY;

        var span = document.createElement('span');
        span.className = 'rhythm-char';
        span.style.fontSize = size.toFixed(3) + 'em';
        span.style.transform = 'translateY(' + dy.toFixed(3) + 'em)';
        span.textContent = chars[i];
        node.appendChild(span);
      }
    }
  }

  /**
   * 순서 표시 — 왼쪽 순서 이름, 오른쪽 담당자(밑줄).
   *
   * 담당자가 없으면 오른쪽 칸을 아예 만들지 않는다. 빈 밑줄만 떠 있으면
   * 이름을 못 넣은 것처럼 보인다.
   */
  /**
   * 템플릿의 외곽선에서 **색만 가져와** 두께를 바꾼 값을 만든다.
   *
   * `-webkit-text-stroke-width` 만 인라인으로 덮으면, 템플릿이 외곽선을 끈 상태
   * (`none`)에서는 색이 글자색으로 잡혀 글자가 굵어진 것처럼 보인다.
   * 그래서 색을 함께 지정한다. 템플릿에 색이 없으면 검정으로 둔다 —
   * 이 프로젝트의 외곽선은 밝은 영상 위에서 글자를 읽히게 하는 장치다.
   */
  function strokeWithWidth(varName, widthPx) {
    var current = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    var color = current.split(/\s+/).slice(1).join(' ') || '#000000';
    // 0 도 '0px' 로 적는다. 'none' 은 이 속성에 유효한 값이 아니라 선언이 통째로
    // 버려지고, 그러면 스타일시트의 템플릿 값으로 되돌아간다(실측으로 확인).
    return Math.max(widthPx, 0) + 'px ' + color;
  }

  function renderOrder(payload) {
    clearChildren(el.blocks);

    var row = document.createElement('div');
    row.className = 'order-row';

    var title = document.createElement('div');
    title.className = 'order-title line-primary';
    if (typeof payload.titleStroke === 'number') {
      title.style.webkitTextStroke = strokeWithWidth('--primary-stroke', payload.titleStroke);
    }
    fillRhythmicText(title, payload.title || '', payload.charStyles);
    row.appendChild(title);

    if (payload.presenter) {
      var presenter = document.createElement('div');
      presenter.className = 'order-presenter line-secondary';
      // 담당자 크기는 템플릿의 보조 텍스트 크기를 기준으로 한 **배수**다.
      // em 으로 두면 부모(.order-row) 크기를 따라가 템플릿 설정과 어긋난다.
      if (typeof payload.presenterScale === 'number' && payload.presenterScale > 0) {
        presenter.style.fontSize = 'calc(var(--secondary-size) * ' + payload.presenterScale + ')';
      }
      if (typeof payload.presenterStroke === 'number') {
        presenter.style.webkitTextStroke = strokeWithWidth('--secondary-stroke', payload.presenterStroke);
      }
      presenter.textContent = payload.presenter;
      row.appendChild(presenter);
    }

    el.blocks.appendChild(row);
    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, null);
  }

  function setOptional(node, value) {
    if (value) {
      node.textContent = value;
      node.hidden = false;
    } else {
      node.textContent = '';
      node.hidden = true;
    }
  }

  /**
   * 그림·동영상 한 장 (예배 전 안내).
   *
   * 배경 장치(`applyBackdrop`)를 그대로 쓴다 — 파일을 못 읽어도 화면을 비우지 않고,
   * 같은 파일이면 노드를 다시 만들지 않아 동영상이 되감기지 않으며, 자동 재생이
   * 막히면 보일 때 다시 시도한다. 그 성질이 전부 필요하다.
   *
   * 글자는 얹지 않는다. 맞춤은 기본 `contain` — 안내는 글자가 잘리면 안 된다.
   * 불투명도는 템플릿 값을 쓰지 않고 1 로 고정한다(내용이므로 흐려지면 안 된다).
   */
  function renderMedia(payload) {
    clearSlide();
    el.backdrop.style.setProperty('--backdrop-fit', payload.fit === 'cover' ? 'cover' : 'contain');
    el.backdrop.style.setProperty('--backdrop-opacity', '1');
    applyBackdrop({ mode: payload.mediaKind === 'video' ? 'video' : 'image', src: payload.src });
  }

  var RENDERERS = {
    bible: renderBible, song: renderSong, text: renderText, order: renderOrder, media: renderMedia,
  };

  /**
   * 배경을 지금 슬라이드에 맞춘다.
   *
   * 안내 슬라이드가 배경 자리를 빌려 쓰므로, 다른 슬라이드로 넘어가면 **템플릿 배경을
   * 되돌려야** 한다. 이게 없으면 안내 그림이 설교 본문 뒤에 그대로 남는다.
   */
  function restoreTemplateBackdrop() {
    el.backdrop.style.removeProperty('--backdrop-fit');
    el.backdrop.style.removeProperty('--backdrop-opacity');
    applyBackdrop(template && template.canvas && template.canvas.background);
  }

  /**
   * 슬라이드 내용을 실제로 비운다.
   *
   * '공백' 슬라이드와 '내용 없음' 이 같은 일을 하므로 한 곳에 둔다.
   * **`blanked` 클래스는 건드리지 않는다** — 그것은 `B`(블랙)의 장치다.
   */
  function clearSlide() {
    clearChildren(el.blocks);
    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, null);
    el.slide.dataset.empty = 'true';
  }

  /**
   * 슬라이드를 그린다. 렌더 중 예외가 나면 이전 화면을 그대로 둔다.
   * @returns {boolean} 성공 여부
   */
  function render(payload) {
    // 안내 슬라이드가 아니면 템플릿 배경으로 되돌린다 (안내 그림이 남지 않게)
    if (!payload || payload.kind !== 'media') restoreTemplateBackdrop();

    if (!payload || payload.kind === 'blank') {
      // 내용을 **지운다**. 예전에는 blanked 클래스(투명도 0)만 켰는데,
      // 곧이어 applyState 가 setBlank(live.blank=false) 로 그 클래스를 다시 꺼서
      // 공백 항목을 송출해도 **이전 화면이 그대로 남았다**(2026-08-15 실사용에서 발견).
      // 블랙(B)은 '내용을 남긴 채 숨기기'라 즉시 복구가 목적이고,
      // 공백은 '내용이 없는 슬라이드'라 서로 다른 일이다.
      clearSlide();
      diag.lastRender = 'blank';
      renderDebug();
      return true;
    }

    var fn = RENDERERS[payload.kind];
    if (!fn) {
      diag.errors++;
      renderDebug();
      return false;
    }

    try {
      fn(payload);
      el.slide.dataset.empty = 'false';
      el.body.classList.remove('blanked');
      // 렌더 직후 실측해 넘치면 배율로 줄인다
      lastFit = applyAutoFit();
      diag.lastRender = payload.kind;
      renderDebug();
      return true;
    } catch (err) {
      // 화면을 비우지 않는다 — 이전 렌더 상태 유지
      diag.errors++;
      pendingErrors.push({ message: String(err && err.message), stack: err && err.stack, url: location.href });
      renderDebug();
      return false;
    }
  }

  /**
   * 실제 렌더 높이를 측정한다. 자동 분할·자동 축소는 서버 추정이 아니라
   * 이 실측값을 기준으로 판단한다 (계획서 §11).
   *
   * 측정은 배율을 1로 되돌린 상태에서 해야 의미가 있다 —
   * 축소된 상태의 높이를 재면 "이미 맞다"는 잘못된 결론이 나온다.
   */
  function measure() {
    var stage = el.stage;
    var available = stage.clientHeight - paddingOf(stage);
    var previous = el.slide.style.getPropertyValue('--fit-scale');
    el.slide.style.setProperty('--fit-scale', '1');
    var used = el.slide.scrollHeight;
    if (previous) el.slide.style.setProperty('--fit-scale', previous);
    else el.slide.style.removeProperty('--fit-scale');
    return { overflow: used > available, height: used, available: available };
  }

  function paddingOf(node) {
    var cs = getComputedStyle(node);
    return parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
  }

  /**
   * 넘치는 본문을 배율로 줄여 화면에 맞춘다.
   *
   * 서버에 되물어 다시 나누는 방식(피드백 루프)은 진동 위험이 있어 쓰지 않는다.
   * 여기서는 순수히 로컬 계산으로 한 번에 결정하고, 최소 배율에서도 넘치면
   * 그 사실을 서버에 보고해 컨트롤 패널이 '더 잘게 나누라'고 안내할 수 있게 한다.
   */
  function applyAutoFit() {
    var behavior = (template && template.behavior) || {};
    if (behavior.autoFit === false) {
      el.slide.style.removeProperty('--fit-scale');
      diag.fit = 'off';
      return { overflow: false, scale: 1 };
    }

    el.slide.style.setProperty('--fit-scale', '1');
    var m = measure();
    if (!m.overflow || m.height <= 0) {
      diag.fit = '1';
      return { overflow: false, scale: 1 };
    }

    var minScale = typeof behavior.autoFitMinScale === 'number' ? behavior.autoFitMinScale : 0.6;
    // 여유 2% — 반올림 때문에 스크롤바가 생기는 것을 막는다
    var needed = (m.available / m.height) * 0.98;
    var scale = Math.max(minScale, Math.min(1, needed));

    el.slide.style.setProperty('--fit-scale', String(scale));
    diag.fit = scale.toFixed(2);

    // 최소 배율로도 부족한가
    return { overflow: needed < minScale, scale: scale };
  }

  // ── 외부 인터페이스 ──────────────────────────────────────────
  // Phase 2 의 WebSocket 클라이언트와 컨트롤 패널의 iframe 미리보기가
  // 공통으로 사용하는 진입점.
  window.SermonOutput = {
    render: render,
    applyStylePatch: applyStylePatch,
    applyAnchor: applyAnchor,
    measure: measure,
    /**
     * 슬라이드 후보를 그려 보고 높이만 재서 돌려준다 (컨트롤 패널 자동 분할용).
     * 측정이 끝나면 이전 화면으로 되돌린다 — 측정 때문에 송출이 흔들리면 안 된다.
     */
    measureSlide: function (payload, candidateTemplate) {
      var savedTemplate = template;
      var savedSlide = lastSlide;
      if (candidateTemplate) template = candidateTemplate;
      try {
        var fn = RENDERERS[payload && payload.kind];
        if (!fn) return null;
        fn(payload);
        var m = measure();
        return m;
      } catch (err) {
        return null;
      } finally {
        template = savedTemplate;
        if (savedSlide) { lastSlide = savedSlide; render(savedSlide); }
      }
    },
    applyTemplate: applyTemplate,
    setBlank: function (on) {
      el.body.classList.toggle('blanked', !!on);
    },
    diag: diag,
    drainErrors: function () {
      var out = pendingErrors.slice();
      pendingErrors.length = 0;
      return out;
    },
  };

  // 컨트롤 패널이 iframe(미리보기·측정)으로 이 페이지를 쓸 때의 통로
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'render') {
      lastSlide = msg.payload;
      render(msg.payload);
    } else if (msg.t === 'style') {
      applyStylePatch(msg.patch);
      lastFit = applyAutoFit();
      renderDebug();
    } else if (msg.t === 'template') {
      applyTemplate(msg.payload);
    } else if (msg.t === 'blank') {
      window.SermonOutput.setBlank(msg.on);
    } else if (msg.t === 'measure') {
      // 요청한 슬라이드를 그려 높이만 재서 돌려준다 (자동 분할용)
      var result = window.SermonOutput.measureSlide(msg.payload, msg.template);
      if (e.source && typeof e.source.postMessage === 'function') {
        e.source.postMessage({ t: 'measure:result', id: msg.id, payload: result }, '*');
      }
    }
  });

  // ── WebSocket 클라이언트 ─────────────────────────────────────
  //
  // 예배 운영의 핵심 세 가지가 여기에 들어 있다:
  //   1. 접속 시 서버가 전체 스냅샷을 보내므로 **새로고침해도 화면이 복구된다**
  //   2. 끊기면 지수 백오프로 재연결하되 **화면은 절대 비우지 않는다**
  //   3. revision 이 현재값보다 작은 메시지는 버린다 (연타 시 순서 뒤바뀜 방지)

  var RECONNECT_MIN = 250;
  var RECONNECT_MAX = 5000;

  var socket = null;
  var reconnectDelay = RECONNECT_MIN;
  var reconnectTimer = null;
  var knownRevision = -1;

  function wsUrl() {
    var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return scheme + '//' + location.host + '/ws';
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // 지수 백오프 — 서버가 오래 죽어 있어도 재연결 시도가 폭주하지 않는다
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
  }

  function applyState(live) {
    // 순서가 뒤바뀐 오래된 메시지는 버린다
    if (typeof live.revision === 'number') {
      if (live.revision < knownRevision) {
        diag.dropped++;
        renderDebug();
        return;
      }
      knownRevision = live.revision;
      diag.revision = live.revision;
    }

    if (live.slide === null || live.slide === undefined) {
      // 서버가 '내용 없음'을 알린 것이므로 비우는 것이 맞다.
      // 연결 끊김과는 다른 상황이다.
      clearSlide();
      diag.lastRender = 'empty';
    } else {
      lastSlide = live.slide;
      render(live.slide);
    }

    window.SermonOutput.setBlank(Boolean(live.blank));
    renderDebug();
    reportErrors();
    reportMeasure();
  }

  function connect() {
    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      diag.ws = 'fail';
      renderDebug();
      scheduleReconnect();
      return;
    }

    diag.ws = 'connecting';
    renderDebug();

    socket.onopen = function () {
      diag.ws = 'open';
      reconnectDelay = RECONNECT_MIN;
      renderDebug();
      // 이 페이지가 로드된 시각을 함께 보낸다. 서버가 출력 파일 수정 시각과 비교해
      // '옛 판이니 OBS 소스를 새로고침하라'를 컨트롤 패널에 띄운다.
      // 서버를 재시작해도 이 페이지는 다시 읽히지 않으므로 스스로는 알 수 없다.
      sendMsg({ t: 'hello', role: 'output', layer: opts.layer, loadedAt: LOADED_AT });
    };

    socket.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        diag.errors++;
        renderDebug();
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'state') {
        applyState(msg.payload);
      } else if (msg.t === 'style:patch') {
        applyStylePatch(msg.payload);
        // 글자 크기·여백이 바뀌면 넘침 여부가 달라지므로 다시 맞춘다.
        // 이걸 빼면 편집으로 글자를 키웠을 때 화면을 넘긴 채 방치된다.
        lastFit = applyAutoFit();
        renderDebug();
        reportMeasure();
      } else if (msg.t === 'template') {
        applyTemplate(msg.payload);
      }
    };

    socket.onclose = function () {
      // 화면은 그대로 둔다. 예배 중 검은 화면이 나가는 것이 최악이다.
      diag.ws = 'closed';
      renderDebug();
      scheduleReconnect();
    };

    socket.onerror = function () {
      diag.ws = 'error';
      renderDebug();
    };
  }

  function sendMsg(msg) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      return false;
    }
  }

  /** 모아 둔 오류를 서버로 올려 컨트롤 패널에 경고가 뜨게 한다 */
  function reportErrors() {
    if (pendingErrors.length === 0) return;
    var batch = pendingErrors.slice(0, 5);
    for (var i = 0; i < batch.length; i++) {
      if (sendMsg({ t: 'client:error', payload: batch[i] })) pendingErrors.shift();
      else break;
    }
  }

  /**
   * 실측 결과를 보고한다.
   * overflow 는 '최소 배율로도 넘친다'는 뜻이다 — 컨트롤 패널이
   * '화면 넘김 단위를 더 잘게' 안내할 근거가 된다.
   */
  function reportMeasure() {
    var m = measure();
    sendMsg({
      t: 'measure:report',
      payload: { overflow: lastFit.overflow, height: m.height, revision: knownRevision },
    });
  }

  /**
   * 템플릿을 받는다. CSS 변수는 서버가 style:patch 로 따로 보내므로
   * 여기서는 behavior·override 처럼 렌더 방식이 달라지는 부분만 반영한다.
   * 렌더 방식이 바뀌었으니 현재 슬라이드를 다시 그린다.
   */
  function applyTemplate(next) {
    if (!next) return;
    template = next;
    applyBackdrop(next.canvas && next.canvas.background);
    if (lastSlide) render(lastSlide);
    else lastFit = applyAutoFit();
    renderDebug();
  }

  // OBS 브라우저 소스 크기를 바꾸면 가용 높이가 달라지므로 다시 맞춘다
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      lastFit = applyAutoFit();
      renderDebug();
    }, 120);
  });

  // 데모 모드에서는 연결하지 않는다 — 서버 상태가 데모 화면을 덮어쓰면
  // 스타일·폰트 확인이 불가능해진다.
  if (!opts.demo && !opts.measure) connect();

  // ── 데모 (?demo=1) ───────────────────────────────────────────
  if (opts.demo) {
    applyStylePatch({
      anchor: 'bottom-center',
      '--safe-bottom': '96px',
      '--safe-left': '120px',
      '--safe-right': '120px',
      '--primary-size': '68px',
      '--primary-stroke': '3px #000000',
      '--secondary-size': '44px',
      '--secondary-color': '#ffe9a8',
      '--secondary-stroke': '2px #000000',
      '--reference-stroke': '2px #000000',
    });
    render({
      kind: 'bible',
      reference: '요한복음 3:16',
      blocks: [
        {
          translationId: 'nkrv',
          translationName: '개역개정',
          lang: 'ko',
          direction: 'ltr',
          verses: [
            {
              book: 43,
              chapter: 3,
              verse: 16,
              text: '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라',
            },
          ],
        },
        {
          translationId: 'niv',
          translationName: 'NIV',
          lang: 'en',
          direction: 'ltr',
          verses: [
            {
              book: 43,
              chapter: 3,
              verse: 16,
              text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
            },
          ],
        },
      ],
    });
  }

  renderDebug();
})();
