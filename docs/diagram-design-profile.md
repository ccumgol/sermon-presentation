<!--
  이 파일은 **사본**입니다. diagram-design 스킬은 여기를 읽지 않습니다.

  저장소 뿌리의 `.diagram-design` 마커가 `profile: sermon-presentation` 을 가리키는데,
  스킬은 그 프로필을 **홈 폴더**에서 찾습니다. 새 PC 에서 다이어그램을 그리려면 한 번만:

      mkdir -p ~/.diagram-design/profiles
      cp docs/diagram-design-profile.md ~/.diagram-design/profiles/sermon-presentation.md

  이 사본을 저장소에 두는 이유: 마커만 커밋하면 다른 PC 에서 가리킬 프로필이 없어
  스킬이 오류를 냅니다. 색의 출처는 `src/control/styles.css` 이고, 이 파일은 그것을
  다이어그램 역할(paper/ink/accent…)에 대응시킨 결과입니다.

  ⚠ 본문 안의 링크(`onboarding.md`·`profiles.md` 등)는 **스킬 자체의 파일**을 가리킵니다.
  이 저장소에는 없으므로 눌러도 열리지 않습니다. 사본은 바이트 그대로 두는 것이 규칙이라
  (스킬의 `profiles.md`) 링크를 고치지 않았습니다.
-->

<!-- diagram-design-profile
name: Sermon Presentation
slug: sermon-presentation
source-url: none
created: 2026-08-21
updated: 2026-08-21
notes: 이 앱의 UI 색 (src/control/styles.css) · accent 는 앱의 파랑, live 빨강은 일부러 제외
-->

# Style Guide

**The single source of truth for colors, typography, and tokens.** Every diagram draws from this — not from hex values inlined in other reference files. If you want to change the visual skin of Diagram Design, change this file.

Default skin is a cool editorial palette — white-smoke paper, jet-black ink, atomic-tangerine accent, blue-slate muted. It's designed to look good out of the box; swap these values (or run [`onboarding.md`](onboarding.md)) and every new diagram inherits the new skin without touching any type-specific logic.

To generate your own from a website URL, see [`onboarding.md`](onboarding.md).

---

## Tokens

### Semantic roles

Every token is referred to by **semantic role**, not by its hex value. Type references (`type-*.md`) and SKILL.md say `accent`, not `#f7591f`.

| Role | Purpose | Default (light) | Default (dark) |
|---|---|---|---|
| `paper` | Page background, default node fill | `#f2f4f7` | `#0e1116` |
| `paper-2` | Diagram container bg, secondary fill | `#eaeef3` | `#242b35` |
| `ink` | Primary text, primary stroke | `#131720` | `#eef1f6` |
| `muted` | Secondary text, default arrow stroke | `#515b6b` | `#aab3c0` |
| `soft` | Sublabels, boundary labels | `#737d8c` | `#808b99` |
| `rule` | Hairline borders | `rgba(19,23,32,0.12)` | `rgba(238,241,246,0.12)` |
| `rule-solid` | Stronger borders, baselines | `#b3bcca` | `#4a5462` |
| `accent` | Focal / 1–2 max per diagram | `#1f6feb` | `#58a6ff` |
| `accent-tint` | Fill for accent-bordered boxes | `rgba(31,111,235,0.08)` | `rgba(88,166,255,0.12)` |
| `link` | HTTP/API calls, external arrows | `#067647` | `#4ade80` |

> **Brand palette source:** Sermon Presentation — the church service presentation app in this project.
> Tokens are lifted verbatim from `src/control/styles.css` so a diagram sits beside the app's own
> screens without a colour clash: `--bg` → `paper`, `--panel-2` → `paper-2`, `--fg` → `ink`,
> `--muted` → `muted`, `--dim` → `soft`, `--line-strong` → `rule-solid`, `--accent` → `accent`
> (the app's blue, used on primary buttons and active toggles), `--ok` → `link`. The dark column comes
> from the app's own `prefers-color-scheme: dark` block, so both skins are the app's, not a derivation.
> `rule` is `ink` at 12% opacity, matching the app's hairline rows.
>
> Deliberately **not** mapped: the app's `--live` red `#d42a1f` ('송출 중' / on-air). It is the loudest
> colour in the product and is reserved there for 'this is going out to the congregation right now'.
> Spending it on diagram focals would dilute that meaning. `accent` stays the app's blue.

> **Note:** The pre-baked example HTML files in `assets/` were built under an earlier skin. Regenerating them against the current `style-guide.md` is a v5.1 task. New diagrams the skill produces will use the tokens above.

### Inversion rule (light → dark)

Any `rgba(19,23,32, X)` in light becomes `rgba(238,241,246, X)` in dark. Same opacities, RGB flipped. The accent brightens (`#1f6feb` → `#58a6ff`) exactly as the app's own dark theme does.

### Series palette (multi-series chart types only)

A small set of desaturated, editorial-tone colors for chart types that genuinely need to distinguish multiple overlapping entities (currently: **radar**). The "1-focal" rule still holds — `accent` is reserved for the focal series; the palette below covers the rest.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `series-1` | `#7c8f6f` (sage) | `#9caf8f` | Non-focal series |
| `series-2` | `#5e7a9b` (dusty-blue) | `#82a0c0` | Non-focal series |
| `series-3` | `#b8915a` (mustard) | `#d3ad7a` | Non-focal series |
| `series-4` | `#9c6b50` (rust-brown) | `#b88670` | Non-focal series |
| `series-5` | `#6e6479` (slate) | `#8d8298` | Non-focal series |

Fills sit at `0.18` opacity light, `0.22` dark; strokes use the full color. **Don't backfill these tokens to non-chart types** — architecture, swimlane, etc. continue to use muted-ink variants. The series palette is opt-in for diagrams where overlapping shapes demand distinguishable color, not a license to add color elsewhere.

### Terminal skin (opt-in alternate)

A self-contained palette for the terminal-window primitive (see [primitive-terminal.md](primitive-terminal.md)) — a CLI-chrome register for dev-tool posts and technical social cards. It does not replace the default skin above and isn't affected by onboarding; it's a second, fixed skin you opt into per-diagram.

| Token | Hex | Purpose |
|---|---|---|
| `terminal-page` | `#0a0a0a` | Page background behind the window |
| `terminal-paper` | `#141414` | Window body, node fill |
| `terminal-bar` | `#1b1b1b` | Titlebar strip |
| `terminal-border` | `#2b2b2b` | Window border, hairlines |
| `terminal-ink` | `#f5f5f5` | Primary text, primary stroke (same white-smoke as default `ink`) |
| `terminal-muted` | `#9a9a9a` | Secondary text, sublabels, ring stroke |
| `terminal-soft` | `#5c5c5c` | Tertiary — inactive dots, spokes |
| `terminal-accent` | `#ff5a36` | The one accent — focal station, prompt sign, active dot |
| `terminal-accent-tint` | `rgba(255,90,54,0.12)` | Fill for accent-bordered boxes |

**1-accent rule still holds.** Everything that isn't `terminal-ink` or `terminal-muted`/`terminal-soft` should be `terminal-accent` — never introduce a second hue.

---

## Typography

| Role | Family | Size | Weight | Usage |
|---|---|---|---|---|
| `title` | Instrument Serif | 1.75rem | 400 | Page H1 |
| `node-name` | Geist (sans) | 12px | 600 | Human-readable labels |
| `sublabel` | Geist Mono | 9px | 400 | Port, protocol, URL, field type |
| `eyebrow` | Geist Mono | 7–8px | 500, tracked 0.18em, uppercase | Type tags, axis labels |
| `arrow-label` | Geist Mono | 8px | 400, tracked 0.06em | Arrow annotations |
| `callout` | Instrument Serif *italic* | 14px | 400 | Editorial asides only |

### Font stack

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**Load-bearing rule:** Mono is for *technical* content (ports, commands, URLs, field types). Names go in Geist sans. Page title is Instrument Serif. Italic Instrument Serif is reserved for annotation callouts (see [primitive-annotation.md](primitive-annotation.md)). **Never JetBrains Mono** as a blanket "dev" font.

---

## Stroke, radius, spacing

| Token | Value | Use |
|---|---|---|
| `stroke-thin` | `0.8` | Tag-box outlines, leaf nodes |
| `stroke-default` | `1` | Most strokes |
| `stroke-strong` | `1.2` | Emphasis strokes |
| `radius-sm` | `4` | Small tags |
| `radius-md` | `6` | Node boxes |
| `radius-lg` | `8` | Containers, rings |
| `grid` | `4` | Every coord, size, and gap is divisible by 4 (hard rule) |

---

## Node type → treatment

Semantic role combinations — reference these by name in type specs.

| Type | Fill | Stroke |
|---|---|---|
| `focal` (1–2 max) | `accent-tint` | `accent` |
| `backend` | `#ffffff` (white) | `ink` |
| `store` | `ink @ 0.05` | `muted` |
| `external` | `ink @ 0.03` | `ink @ 0.30` |
| `input` | `muted @ 0.10` | `soft` |
| `optional` | `ink @ 0.02` | `ink @ 0.20` dashed `4,3` |
| `security` | `accent @ 0.05` | `accent @ 0.50` dashed `4,4` |

---

## Customizing the skin

Four options:

1. **Run onboarding** — see [`onboarding.md`](onboarding.md). Drop a URL; the skill extracts the palette + fonts and rewrites this file.
2. **Edit by hand** — change the hex values in the tables above. Run the pre-output taste gate afterward to verify the accent still reads as "focal" against the new paper color.
3. **Brand handoff** — paste your existing design-token JSON into a new section here and map its tokens to the semantic roles above.
4. **Client profiles** — save and switch named skins, or bind one to a project, using [`profiles.md`](profiles.md).

### Constraints (don't break these)

- **Contrast**: `ink` must hit WCAG AA on `paper`. `muted` must hit AA on `paper` for 11px+ text.
- **One accent**: pick one color for `accent`. Two accents erases the focal signal.
- **No rainbow palette**: if your brand ships 8 colors, pick 3 (paper, ink, accent). The rest become `muted` variants.
- **Serif + sans + mono**: three families, not more. If brand typography is all sans, keep Instrument Serif for `title` and `callout` anyway — the contrast is load-bearing.
- **Paper is warm-neutral, not pure white**: pure white turns the design sterile. Pick a cream, bone, or light grey with a hint of warmth.
- **Dot pattern is optional, not default**: the 22×22 dot pattern is an opt-in "dotted paper" variant (good for long-form editorial hero diagrams). The default background is a clean `paper` fill, no pattern. When the pattern is enabled, it should sit at ~10% opacity of `ink` on `paper` — visible but quiet.
- **Container is clean by default**: the diagram sits directly on the page paper, no secondary container background or border. A framed variant (`paper-2` bg + `rule` border + 8px radius + padding) is available as an opt-in for card-heavy layouts, but don't reach for it by default — the extra chrome fights the figure.
