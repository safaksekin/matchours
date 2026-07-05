---
name: fikstür.com
description: A football-first stats app where you take positions and grow a football identity.
colors:
  accent: "#6A45E6"
  accent-light: "#5A33CC"
  accent-dim: "#6A45E62E"
  bg: "#0A0A0C"
  surface: "#1B1B1F"
  surface-alt: "#26262B"
  border: "#34343A"
  ink: "#E8EAFB"
  ink-secondary: "#A8AECE"
  ink-muted: "#767C9E"
  success: "#3FD176"
  warn: "#F8DE22"
  danger: "#FF0000"
  bg-light: "#F1F2F6"
  surface-light: "#FFFFFF"
  ink-light: "#161A35"
typography:
  display:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1.3
  body:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    letterSpacing: "0.5px"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  chip-selected:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "7px 13px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "7px 13px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  input:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 13px"
---

# Design System: fikstür.com

## 1. Overview

**Creative North Star: "The Football Passport"**

fikstür.com is not a scoreboard you read; it's a passport you fill. Every surface
exists to let a fan take a position — predict a result, call the man of the match,
rate a player — and carry away a growing football identity (reputation, Football
DNA, "you vs the community"). The visual system serves that: calm, flat, dark-or-light
canvases that get out of the way, with a single **electric purple** acting as the
stamp — the brand's ink, pressed onto the moments where the user commits (a locked
pick, an earned point, an active tab, the light-mode header).

The craft is deliberately **flat and confident**. Surfaces are solid, corners are
generously rounded (12–18px), and depth is conveyed by tonal layering (bg → surface
→ surface-alt), never by embossing. The playfulness of the product — points, DNA
bars, leaderboards, "kim haklı?" — lives entirely in the *mechanics and copy*, never
in shiny chrome. If a screen reads like a spreadsheet, it has failed the identity
principle; if it reads like a toy, it has failed the "not childish" line. It must
sit between: a serious, opinionated football companion that keeps score.

This system explicitly rejects the **grey, identity-less Flashscore stat-dump**, the
**over-gamified confetti/badge childishness**, the **ad-dense betting-site clutter**,
and the **SaaS bevel/gradient-glow template** (embossed buttons and inset highlights
were deliberately stripped out — do not reintroduce them).

**Key Characteristics:**
- Flat, solid surfaces; depth via tonal layers, not shadow.
- One electric purple accent as a commitment "stamp" (≤ a fifth of any screen).
- Dual light/dark themes, both first-class, driven by CSS variables.
- Single neo-grotesque sans in many weights; numbers and ratings are protagonists.
- Purple is the brand; green/yellow/red are a separate, functional rating scale.

## 2. Colors

A near-neutral dark-or-light stage, one saturated purple brand accent, and a small
functional traffic-light scale reserved for player ratings. Values are given
dark-theme first (canonical) / light-theme second where they differ.

### Primary
- **Electric Purple** (#6A45E6 dark / #5A33CC light): The brand's ink. Used for the
  committed state and nothing casual: selected 1X2 / tabs / chips, primary buttons,
  active underline, points and reputation numbers, the light-mode header fill
  (a `linear-gradient(135deg, #8B6CFF→#6A45E6→#4D2FB0)` — the one place the accent
  becomes a full surface). **Accent-Dim** (`rgba(106,69,230,0.18)`) tints the
  resting background of active pills and badges.

### Neutral
- **Void / Cloud** (bg #0A0A0C dark / #F1F2F6 light): The page canvas. Near-black in
  dark, cool off-white in light.
- **Surface** (#1B1B1F dark / #FFFFFF light): Cards, feed rows, dropdowns, sheets —
  one tonal step up from the canvas.
- **Surface-Alt** (#26262B dark / #E9EBF1 light): Inputs, score chips, rating tracks —
  a second tonal step, used instead of borders to separate.
- **Border** (#34343A dark / #D7DBE8 light): Hairline dividers and 1px outlines only.
- **Ink** (#E8EAFB dark / #161A35 light): Primary text.
- **Ink-Secondary** (#A8AECE dark / #585E82 light): Supporting text, labels, inactive tabs.
- **Ink-Muted** (#767C9E dark / #9AA0C0 light): Timestamps, league names, column heads.
  Never use Ink-Muted for anything that must clear 4.5:1 as body copy.

### Tertiary — the Rating Scale (functional, not decorative)
- **Success Green** (#3FD176 dark / #2FAE55 light): rating ≥ 7.0, wins, "you were
  right" confirmations. *(Note: this token is historically named `--purple` in code —
  it is green; do not confuse it with the brand accent.)*
- **Warn Yellow** (#F8DE22): rating 6.0–6.9, draws.
- **Danger Red** (#FF0000): rating < 6.0, losses, "you missed."

### Named Rules
**The Stamp Rule.** The purple accent marks *commitment and identity*, never
decoration. It appears where the user has taken a position or where their identity is
at stake (a locked pick, earned points, an active tab). If purple is coloring
something the user didn't choose, it's wrong.

**The Two-Purples Rule.** Purple is the brand; the rating scale's "purple" is green.
Ratings are always green/yellow/red on the 7.0/6.0 thresholds and never borrow the
brand accent — the two vocabularies must not blur.

**The Earned-Identity Rule.** Any surface that states who the user is (Taste Graph,
DNA, "Football Take", Contrarian Score) must render as the visible sum of the user's
own logged choices, with the evidence count in view — never a value the app assigned.
No axis shows a fabricated number: below a threshold of logs it reads "forming", not a
guess. The match's 5-star *watch* score is purple stars; player *performance* ratings
stay green/yellow/red — the two rating vocabularies never merge.

## 3. Typography

**Display / Body / Label Font:** Manrope (self-hosted via next/font, latin-ext for
Turkish; Helvetica Neue fallback). One modern geometric sans in many weights, no pairing.

**Character:** Modern, geometric, quietly confident with excellent numerals — the right
fit for a scores/ratings app. The family carries hierarchy through **weight** (600 body
→ 800 headings) and size, not through a second typeface. Big, bold numerals (scores,
ratings, points) are the real display type — they, not headlines, are the loudest thing
on most screens.

### Hierarchy
- **Display** (800, 22px, 1.1): Modal scores, the big reputation/rating number, the
  editor's live value. Numerals carrying weight, not sentence headings.
- **Headline** (800, 18px, 1.2): Page/section titles (profile name, "Bildirimler").
- **Title** (800, 14px, 1.3): Team names in the modal header, card row emphasis.
- **Body** (600, 13–14px, 1.45): Match rows, comments, descriptions. Keep prose ≤ 70ch.
- **Label** (800, 11px, +0.5px, UPPERCASE): Section eyebrows inside cards ("MAÇ SONUCU",
  "OYUNCU REYTİNGLERİ"). Micro meta (9–10px, Ink-Muted): league names, column heads.

### Named Rules
**The Weight-Not-Family Rule.** Hierarchy comes from weight and size within one
family. Never introduce a second typeface to signal a level; reach for 800 or a size
step instead.

**The Numbers-Are-Display Rule.** Scores, ratings, and points are the display type.
Give them size and 800 weight; let headings stay comparatively quiet.

## 4. Elevation

The system is **flat by default**. Cards, feed rows, chips, and inputs carry **no
shadow** — separation is tonal (bg → surface → surface-alt) and via 1px borders.
Depth is spent only where something genuinely floats above the page.

### Shadow Vocabulary (floating layers only)
- **Sheet** (`box-shadow: 0 -8px 40px rgba(20,40,40,0.22)`): Bottom sheets (rating
  editor, standouts) rising from the bottom edge.
- **Popover** (`box-shadow: 0 12px 36px rgba(20,40,40,0.30)`): Notification dropdown,
  AI-analysis popover, portaled menus.
- **Header** (light mode: `0 3px 14px rgba(0,0,0,0.18)`): The purple header's lift over
  scrolling content.

Frosted material is legitimate but rationed: bottom sheets and the light header use
`backdrop-filter: blur(18–22px) saturate(160%)` over the `--modalGrad` translucent
fill. This is the **only** sanctioned glass; it belongs to floating layers, never to
resting cards.

### Named Rules
**The Flat-By-Default Rule.** Resting surfaces are flat. A shadow is a signal that an
element has *left the page* (a sheet, a popover, the sticky header) — never ambient
decoration on a card. If a card has a drop shadow, delete it.

**The No-Bevel Rule.** Buttons are flat fills. Inset highlights, embossed edges, and
`accentGlow`-style inner shadows are forbidden — they were removed on purpose. Hover
is a brightness/tint change, not a lift-and-shine.

## 5. Components

### Buttons
- **Shape:** Rounded (12px; pills at 999px for compact toggles and the "yorum yap" /
  AI chips).
- **Primary:** Solid Electric Purple fill, white text, 10–14px vertical padding. Flat.
- **Hover / Focus:** `filter: brightness(1.06)` or a tint shift — never a translateY
  lift or a glow. Keep transitions ~0.2–0.3s.
- **Ghost / Secondary:** Transparent fill, 1px border (`--border`), Ink-Secondary text.
  Used for "Kapat", "Kaldır", secondary actions.

### Chips (league strip, scope filters, 1X2 quick-pick)
- **Style:** Surface fill, Ink-Secondary text, 12px radius, ~7×13px padding.
- **State:** Selected = solid purple fill + white text (or `--accent-dim` tint for the
  softer filter pills). The 1X2 result boxes are a signature variant: a picked box gets
  a **2.5px purple border**, the actual result gets a **success-green fill** — the only
  place a thick colored border is allowed, because it encodes a prediction outcome.

### Cards / Containers
- **Corner Style:** 16–18px (`--rounded.lg`).
- **Background:** Surface (#1B1B1F / #FFFFFF). Feed rows sit directly on the canvas with
  a hover tint (`rgba(106,69,230,0.10)`) rather than card chrome.
- **Shadow Strategy:** None (see Elevation). Tonal only.
- **Border:** None by default; hairline `--border` only as a divider between rows.
- **Internal Padding:** 14–16px.

### Inputs / Fields
- **Style:** Surface-Alt fill (#26262B / #E9EBF1), 12px radius, no or 1px border, Ink text.
- **Focus:** Border shifts to `--accent` at ~66% opacity. No glow.
- **Placeholder:** Must clear 4.5:1 — Ink-Muted is the floor, not lighter.

### Navigation
- **Top sport tabs:** Transparent buttons, 24px category icons, label in Ink-Secondary
  (in dark mode, inactive labels take the accent purple). Active = accent label + a
  sliding 3px purple underline. Hover paints a soft `rgba(128,128,145,0.16)` box.
- **Light-mode header:** The one drenched surface — purple gradient fill, all content
  forced white via `.mo-navlight`. **Because that rule is `color:#fff !important`, any
  floating layer opened from the header (dropdown, menu) MUST be portaled to `<body>`
  or its text will be whited-out.** (This was a real shipped bug.)
- **Mobile bottom nav:** Surface fill, top hairline border, 5 items with a single
  sliding indicator. Desktop hides it in favor of the header + two-column layout.

### Signature Component — the Prediction Coupon
The identity engine's face. Lives on a flat `--glassPurple` tint (no border, no card
chrome). 1/X/2 boxes, a man-of-the-match picker, and 2–3 player-rating sliders (0–10
track, filled purple). A pinned "system star" player sits above a real football pitch
(`Pitch`) where tapping a player opens a bottom-sheet rating editor. Post-match it
flips to a result breakdown (green/red boxes, Senin/Gerçek columns, per-row points).

### Signature Component — the Match Log (the spine)
The atomic post-match action, and the app's trunk (see PRODUCT.md). A bottom sheet,
three stops, each producing user-owned evidence:
1. **Rate the watch** — a 5-star row (half-steps). This is "how good a match was it
   to watch", deliberately a *different scale and shape* from the green/yellow/red
   0–10 player ratings, so the two never blur. Stars are Ink when empty, **accent
   purple** when filled (the stamp — the user committed a verdict).
2. **Style tags — the paint.** A wrap of ~8 tappable descriptor chips ("Savunma
   dersi", "Gol düellosu", "Taktik satranç"…), pick up to 3. Selected = the standard
   chip stamp (accent-dim tint + accent text + accent border). These are *why* the
   match was what it was, and each is a labelled vote into the Taste Graph.
3. **Three players, one per side minimum** — pick 3 across both XIs (a 2-1 / 1-2
   split is enforced; 3-0 is refused with a quiet inline hint), each rated on the
   same 0–10 purple slider as the coupon. Both teams always get judged.
Saving stamps a diary entry and nudges the Taste Graph. The sheet reuses `Pitch`
tokens, `RatingSlider`, and the chip vocabulary — no new form controls.

### Signature Component — the Taste Graph
The identity payoff, and the profile's centrepiece. A small radar/axis read of the
fan the user has *earned*: axes like Pragmatik↔Estetik, İşçi↔Şovmen, Konsensüs↔Kontra
(the headline "Contrarian Score"), each filled by the logs above — never by AI. Every
axis shows its **evidence count** ("42 puanlama") and, where thin, a "forming" state
rather than a fabricated value. Bars/spokes fill accent purple; the surface is flat.
It must always read as *the user's own resultant*, legible back to the taps that made
it.

## 6. Do's and Don'ts

### Do:
- **Do** keep resting surfaces flat; convey depth with the bg → surface → surface-alt
  tonal ladder and 1px `--border` dividers.
- **Do** reserve Electric Purple for commitment and identity (locked picks, points,
  active tab, primary action). Treat it as a stamp, not a highlighter.
- **Do** drive hierarchy with weight (600→800) and big numerals within one sans family.
- **Do** keep both themes correct: verify body text ≥ 4.5:1 in light *and* dark, and
  portal any header-launched floating layer to `<body>` to escape `.mo-navlight`.
- **Do** give every transition a `prefers-reduced-motion: reduce` fallback (crossfade
  or instant). Motion easing is ease-out (`cubic-bezier(0.22,1,0.36,1)`), ~0.2–0.34s.
- **Do** keep the rating scale green/yellow/red on the 7.0 / 6.0 thresholds, separate
  from the brand purple.

### Don't:
- **Don't** ship the grey, identity-less **Flashscore stat-dump** look — data is the
  stage for the user's take, never the whole show.
- **Don't** go **over-gamified / childish**: no confetti storms, cartoon mascots,
  garish badge spam, or bouncy toy motion. Reputation is felt, not shouted.
- **Don't** reproduce **betting-site clutter** (Nesine/Bilyoner): no ad-dense,
  odds-bombarded, cramped screens.
- **Don't** reintroduce the **SaaS bevel / gradient-glow** template: no embossed
  buttons, no inset highlights, no `accentGlow` inner shadow. Buttons are flat fills.
- **Don't** use `background-clip: text` gradient text, or a `border-left`/`border-right`
  > 1px colored stripe as an accent. (The 1X2 outcome border is the one sanctioned
  thick border, and it is a full 2.5px box border, not a side stripe.)
- **Don't** put a drop shadow on a resting card, or glass/`backdrop-filter` on anything
  that isn't a floating sheet, header, or popover.
- **Don't** color something purple that the user didn't choose or earn.
