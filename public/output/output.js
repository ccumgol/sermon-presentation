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

  /*
   * 이 파일은 프로젝터 화면(`/projector/`)도 그대로 쓴다 — 렌더러를 복제하지 않기
   * 위한 의도적 재사용이다. 그 화면은 layer 이름이 'projector' 여야 한다:
   * 서버가 그 layer 에만 '전체' 템플릿을 보내고, 'OBS 연결됨' 집계에서 빼기 때문이다.
   *
   * 쿼리(`?layer=`)에 맡기지 않고 **경로에서 정한다.** 사용자가 주소를 손으로 치거나
   * 즐겨찾기에 넣을 때 파라미터가 빠지면 프로젝터 창이 OBS 화면으로 집계되고
   * '옛 판이니 새로고침하라' 경고가 엉뚱하게 뜬다.
   */
  var pathLayer = location.pathname.indexOf('/projector') === 0 ? 'projector' : 'main';

  var opts = {
    layer: params.get('layer') || pathLayer,
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

  /**
   * **템플릿이 원하는 배경.** 실제로 무엇을 깔지는 `syncBackdrop` 이 정한다.
   *
   * 항목 배경(교독문·주기도문·사도신경)이 있으면 그것이 이기므로, 템플릿 값을
   * 곧바로 그리면 안 된다 — 그리는 순간 항목 배경이 지워진다.
   */
  var templateBackdrop = null;

  /** '{"mode":"image","src":"a.jpg"}' 또는 빈 문자열 */
  function applyBackdropFromString(value) {
    if (!value) {
      templateBackdrop = null;
      syncBackdrop(lastSlide);
      return;
    }
    try {
      templateBackdrop = JSON.parse(value);
      syncBackdrop(lastSlide);
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

  function applyBackdrop(background, urlPrefix) {
    var mode = background && background.mode;
    var src = background && background.src;
    var prefix = urlPrefix || '/backgrounds/';
    // 같은 파일 이름이 두 폴더에 있을 수 있으므로 앞머리도 열쇠에 넣는다
    var key = mode === 'image' ? 'image:' + prefix + ':' + src : '';

    // 같은 파일이면 아무것도 하지 않는다 — 맞춤·불투명도는 CSS 변수
    // (--backdrop-fit / --backdrop-opacity)로 따로 오므로 다시 만들 필요가 없다.
    if (key === backdropKey) return;
    backdropKey = key;
    clearChildren(el.backdrop);
    if (!key || !src) return;

    // 그림만 그린다. **반복 동영상 배경은 OBS 미디어 소스가 한다** (2026-08-18, D-B).
    // 브라우저에서 하면 자동 재생 차단·코덱 문제를 우리가 떠안는다.
    var node = document.createElement('img');

    // 파일이 없거나 코덱을 못 읽어도 **화면을 비우지 않는다** — 배경만 빠진다.
    // 대신 컨트롤 패널이 알 수 있게 오류로 올린다.
    node.addEventListener('error', function () {
      clearChildren(el.backdrop);
      backdropKey = '';
      diag.errors++;
      pendingErrors.push({ message: '배경 파일을 불러오지 못했습니다: ' + src, url: location.href });
      renderDebug();
    });

    node.src = prefix + encodeURIComponent(src);
    el.backdrop.appendChild(node);

  }

  /**
   * 표시 여부를 정한다 — **모양은 템플릿, 켜고 끄기는 항목.**
   *
   * 규칙의 원본은 `lib/item-display.ts` 다. 이 파일은 **의존성 0** 이 원칙이라(OBS
   * 브라우저 소스가 죽지 않게) import 할 수 없어 같은 규칙을 여기에도 적어 둔다.
   *
   * **결정을 여기서 한다.** 컨트롤 패널이 미리 풀어 슬라이드에 담으면, 나중에 템플릿만
   * 바꿨을 때(template:set) 그 값이 따라오지 않는다.
   *
   * 항목 값은 세 갈래다 — 없으면 템플릿 따름, true/false 면 그것이 이긴다.
   * 없는 것을 false 로 보면 이미 저장된 순서표가 모두 '끔' 이 된다.
   */
  function resolveDisplay(behavior, display) {
    var d = display || {};
    // showVerseNumbers 는 '없으면 켬' 이 기존 동작이다
    var reference = behavior.showReference || 'none';
    if (d.reference === false) reference = 'none';
    else if (d.reference === true && reference === 'none') reference = 'bottom';

    return {
      verseNumbers: d.verseNumbers !== undefined ? d.verseNumbers : behavior.showVerseNumbers !== false,
      headings: d.headings !== undefined ? d.headings : behavior.showHeadings === true,
      reference: reference,
    };
  }

  /** 성경 본문 블록 렌더 */
  function renderBible(payload) {
    clearChildren(el.blocks);
    var behavior = (template && template.behavior) || {};
    var show = resolveDisplay(behavior, payload.display);
    var showNums = show.verseNumbers;

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

    setOptional(el.heading, show.headings ? payload.heading : null);
    setOptional(el.reference, show.reference === 'none' ? null : payload.reference);
    setOptional(el.credit, null);

    // 참조를 위에 둘지 아래에 둘지 — DOM 순서를 바꿔 반영한다
    if (show.reference === 'top') el.slide.insertBefore(el.reference, el.blocks);
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

    /*
     * 절 번호는 **그 절의 첫 장, 첫 줄에만** 붙인다.
     *
     * **템플릿의 showVerseNumbers 는 보지 않는다.** 찬양에서는 원래부터 그 값을 보지
     * 않고 늘 붙였고, 이제 와서 보게 하면 '찬양 — 전체' 프리셋(false)에서 절 번호가
     * 조용히 사라진다 — 사용자가 요청하지 않은 변화다(실측으로 확인해 되돌렸다).
     *
     * 항목이 **명시적으로 끈 경우에만** 끈다. 새 기능은 새 값으로만 동작한다.
     */
    var songDisplay = payload.display || {};
    var songNumbers = songDisplay.verseNumbers !== false;
    var prefix = payload.sectionStart && songNumbers ? verseNumberPrefix(payload.sectionLabel) : '';

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
   * 교독문 한 화면 — 인도자 줄과 회중 줄을 **함께** 그린다.
   *
   * 회중은 자기 차례 줄이 화면에 있어야 읽을 수 있다. 한 줄씩 넘기면 인도자가
   * 읽는 동안 회중 줄이 안 보인다.
   *
   * 누가 읽을 차례인지 보이도록 템플릿의 **주 / 보조 텍스트 역할**로 나눈다
   * (성경 다역본과 같은 장치라 어느 템플릿에서도 이미 스타일이 잡혀 있다).
   * 마지막 '다같이' 줄은 짝이 없으므로 주 역할 한 줄만 그린다.
   */
  function renderReading(payload) {
    clearChildren(el.blocks);

    var leader = document.createElement('div');
    leader.className = 'line-primary reading-leader';
    leader.textContent = payload.leader;
    el.blocks.appendChild(leader);

    if (payload.people) {
      var people = document.createElement('div');
      people.className = 'line-secondary reading-people';
      people.textContent = payload.people;
      el.blocks.appendChild(people);
    }

    setOptional(el.heading, null);
    setOptional(el.reference, payload.reference || null);
    setOptional(el.credit, null);
  }

  /**
   * 그림 한 장 — 예배 전 안내·악보처럼 글자 없이 그림만 나가는 화면.
   *
   * 배경이 아니라 **내용**이므로 기본이 `contain` 이다. 안내문이나 악보는 잘리면
   * 읽을 수 없다 (배경은 화면을 채워야 하므로 `cover` 가 기본이다 — 반대다).
   *
   * `crop` 은 원본의 세로 일부만 보여 준다. 악보 한 장에서 지금 부르는 단만 잘라
   * 내기 위한 것이라 **파일을 슬라이드마다 만들지 않아도 된다.** 자르기는 감싼 상자의
   * 비율을 원본 조각의 비율로 맞추고 그림을 그만큼 키워 위로 밀어 올려서 한다.
   */
  function renderImage(payload) {
    clearChildren(el.blocks);
    setOptional(el.heading, null);
    setOptional(el.reference, null);
    setOptional(el.credit, null);

    var box = document.createElement('div');
    box.className = 'image-slide';
    var img = document.createElement('img');
    img.alt = payload.alt || '';
    img.src = payload.src;
    img.className = payload.fit === 'cover' ? 'fit-cover' : 'fit-contain';

    var crop = payload.crop;
    if (crop && typeof crop.top === 'number' && typeof crop.bottom === 'number') {
      var span = crop.bottom - crop.top;
      if (span > 0 && span <= 100) {
        box.classList.add('cropped');
        // 보이는 부분이 span% 이므로 그림을 (100/span) 배로 키우고 top% 만큼 올린다
        img.style.height = (100 / span) * 100 + '%';
        img.style.marginTop = '-' + (crop.top / span) * 100 + '%';
      }
    }

    box.appendChild(img);
    el.blocks.appendChild(box);
  }

  var RENDERERS = {
    bible: renderBible, song: renderSong, text: renderText, order: renderOrder,
    reading: renderReading, image: renderImage,
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
    // 템플릿 값은 CSS 패치로도 오므로(`applyStylePatch`) 기억해 둔 것을 쓴다.
    // `template.canvas` 만 보면 편집 중 값과 어긋난다.
    applyBackdrop(
      templateBackdrop || (template && template.canvas && template.canvas.background),
    );
  }

  /**
   * **화면에 무엇을 깔지 정하는 유일한 곳.**
   *
   * 순서: 항목 배경(교독문·전례문) → 템플릿 배경.
   *
   * 전에는 세 곳이 각자 배경을 그렸다 — `render`, `applyTemplate`, 그리고 템플릿
   * CSS 패치(`applyStylePatch` → `applyBackdropFromString`). 그래서 도착 순서에
   * 따라 결과가 달라졌고, 출력 페이지를 새로 열면 항목 배경이 템플릿 값에 지워졌다
   * (2026-08-18 실측). 결정은 한 곳에서만 한다.
   */
  function syncBackdrop(payload) {
    if (applyItemBackground(payload && payload.background)) return;
    restoreTemplateBackdrop();
  }

  /**
   * 항목 배경을 낼 주소 앞머리.
   *
   * **정해진 표로만 만든다.** 순서표에 담긴 값이 주소를 통째로 정하게 하면, WS 로
   * 아무 주소나 밀어넣어 바깥 그림을 불러오게 할 수 있다. 폴더 이름은 두 개뿐이다.
   */
  var BACKDROP_PREFIX = { data: '/backgrounds/', library: '/background-library/' };

  /**
   * 항목이 지정한 폰트 — 고딕/명조 두 갈래만.
   *
   * **정해진 표로만 만든다.** 순서표에 담긴 값이 font-family 를 통째로 정하게 하면
   * WS 로 아무 글꼴 이름이나 밀어넣을 수 있다. 배경 주소와 같은 규칙이다.
   *
   * 값의 원본은 `lib/korean-fonts.ts` 다. 이 파일은 **의존성 0** 이 원칙이라(OBS
   * 브라우저 소스가 죽지 않게) import 할 수 없어 같은 문자열을 여기에도 적어 둔다.
   * 두 벌이 어긋나면 `tests/unit/korean-fonts.test.ts` 가 깨진다 —
   * 전에 명조 2순위가 `Apple SD Gothic Neo`(고딕)여서 나눔명조가 없는 PC 에서
   * '명조' 를 골라도 고딕이 나왔다. 그 종류의 어긋남을 막는 장치다.
   */
  var ITEM_FONTS = {
    sans: '"Noto Sans KR", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    serif: '"Noto Serif KR", "Noto Serif CJK KR", "BareunBatangOTFPro", "NanumMyeongjoExtraBold", ' +
      '"Nanum Myeongjo", "AppleMyungjo", "Batang", serif',
  };

  /**
   * 교독문·전례문이 지정한 표시 설정(폰트·글자 크기)을 적용한다.
   *
   * 슬라이드마다 다시 정한다 — 지정이 없으면 **반드시 지운다**. 남겨 두면 다음 순서가
   * 앞 순서의 크기를 물려받아 예배 중에 글자가 갑자기 커진다.
   */
  function applyItemStyle(style) {
    var slide = el.slide;
    var font = style && ITEM_FONTS[style.font];
    if (font) slide.style.setProperty('--item-font', font);
    else slide.style.removeProperty('--item-font');

    var scale = style && typeof style.scale === 'number' && style.scale > 0 ? style.scale : null;
    if (scale) slide.style.setProperty('--item-scale', String(scale));
    else slide.style.removeProperty('--item-scale');
  }

  /**
   * 항목이 자기 배경을 지정했으면 그것을 깐다 (교독문·주기도문·사도신경).
   *
   * 템플릿 배경을 **그 항목에서만** 덮는다. 배경을 템플릿에 두면 배경을 바꿀 때마다
   * 템플릿을 새로 만들어야 하는데, 이 순서들은 글 스타일은 그대로 두고 배경만 바꾼다.
   *
   * @returns 항목 배경을 깔았는지 (아니면 부르는 쪽이 템플릿 배경으로 되돌린다)
   */
  function applyItemBackground(background) {
    if (!background || !background.src) return false;
    var prefix = BACKDROP_PREFIX[background.source];
    if (!prefix) return false;

    // 배경은 화면을 채워야 글자 뒤에 빈 자리가 안 생긴다 — 기본 cover
    el.backdrop.style.setProperty('--backdrop-fit', background.fit === 'contain' ? 'contain' : 'cover');
    el.backdrop.style.setProperty('--backdrop-opacity', '1');
    applyBackdrop({ mode: 'image', src: background.src }, prefix);
    return true;
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
    /*
     * 그림 슬라이드가 켰던 '여백 없음' 을 여기서도 끈다.
     *
     * `render` 만 끄면 모자란다 — 서버가 '내용 없음'(`clear`)을 알릴 때는
     * `applyState` 가 이 함수를 **직접** 부르고 `render` 를 거치지 않는다.
     * 그래서 그림을 띄운 뒤 비우면 다음 글자 슬라이드가 여백 없이 나갔다.
     */
    el.body.classList.remove('full-bleed');
  }

  /**
   * 슬라이드를 그린다. 렌더 중 예외가 나면 이전 화면을 그대로 둔다.
   * @returns {boolean} 성공 여부
   */
  function render(payload) {
    // 배경은 한 곳에서 정한다 (항목 → 템플릿)
    syncBackdrop(payload);
    /*
     * **그림 슬라이드는 화면을 꽉 쓴다.** 템플릿의 안쪽 여백(80/50px)은 글자가
     * 가장자리에 붙지 않게 하는 장치다. 안내 그림이나 악보에 그 여백을 주면
     * 정작 봐야 할 것이 작아진다.
     */
    el.body.classList.toggle('full-bleed', !!payload && payload.kind === 'image');
    // 폰트·글자 크기도 슬라이드마다 다시 정한다 (지정이 없으면 지운다)
    applyItemStyle(payload && payload.style);

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
      // 렌더 직후 실측해 넘치면 배율로 줄인다 (그림은 빼고 — 이미 맞춰져 있다)
      lastFit = applyAutoFit(payload.kind);
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
  function applyAutoFit(kind) {
    /*
     * **그림 슬라이드는 축소하지 않는다.** 그림은 이미 상자에 맞춰져 있는데
     * 자동 축소가 또 줄이면 화면 가장자리에 흰 띠가 남는다 (실측 0.87배).
     * 축소는 '글자가 넘칠 때 줄인다' 는 장치라 그림에는 뜻이 없다.
     */
    if (kind === 'image') {
      el.slide.style.removeProperty('--fit-scale');
      diag.fit = 'image';
      return { overflow: false, scale: 1 };
    }

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
      lastFit = applyAutoFit(lastSlide && lastSlide.kind);
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
        lastFit = applyAutoFit(lastSlide && lastSlide.kind);
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

    /*
     * 배경은 **render 가 정한다** — 항목 배경 → 템플릿 배경 순.
     *
     * 전에는 여기서 `applyBackdrop` 를 직접 불렀다. 그래서 템플릿 메시지가 올 때마다
     * 항목 배경(교독문·주기도문·사도신경)이 템플릿 배경으로 덮여 지워졌다.
     * 출력 페이지를 새로 열면 배경이 빠지는 증상이 이것이었다 — 접속 직후 서버가
     * 상태와 템플릿을 잇달아 보내는데, 템플릿이 뒤에 와서 배경을 지웠다.
     * 결정하는 곳이 둘이면 순서에 따라 결과가 달라진다. 한 곳으로 모은다.
     */
    if (lastSlide) {
      render(lastSlide);
    } else {
      syncBackdrop(null);
      lastFit = applyAutoFit(null);
    }
    renderDebug();
  }

  // OBS 브라우저 소스 크기를 바꾸면 가용 높이가 달라지므로 다시 맞춘다
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      lastFit = applyAutoFit(lastSlide && lastSlide.kind);
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
