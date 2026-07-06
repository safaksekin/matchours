# Product

## Register

product

## Users

Turkish-first football fans (UI defaults to Turkish, with EN/DE). Mobile-first —
they open the app on a phone during commutes, at halftime, in the minutes before
kickoff, and the morning after. Two overlapping motivations:

- **The watcher:** wants live scores, fixtures, standings, lineups, and match
  stats across many competitions (World Cup, the big European leagues, plus
  in-season summer leagues) — fast, at a glance.
- **The participant (the real target):** doesn't just consume the match — takes a
  position on it. Predicts the result, the man of the match, and specific players'
  ratings; rates players themselves after the whistle; and watches a personal
  "football identity" (reputation, Football DNA, community consensus) grow over
  time. This is who we build the retention loop for.

The job to be done shifts across the match lifecycle: **before** kickoff — lock a
prediction before the deadline; **during** — see how it's going; **after** — find
out if they were right and how they compared to the crowd. On match-less days the
pull is status: their leaderboard rank, their evolving DNA, an unresolved
consensus they're on the wrong side of.

## Product Purpose

fikstür.com is a multi-sport (football-first) stats app where the user does more
than watch — they take positions and accumulate a football identity. Scores and
fixtures are the front door; the engine is a **prediction + reputation loop**
(1X2, man-of-the-match, and per-player rating predictions, auto-scored, feeding
weekly / season / community-league leaderboards) plus an identity layer (Football
DNA, post-match "you vs the community" rating consensus).

The defensible moat is the **per-player match rating infrastructure**: because the
app already captures user ratings and reads real match ratings, it can do what
score-only competitors can't — score a "who will be man of the match" prediction,
run a rating-consensus moment, and derive a Football DNA. Success looks like a
fan opening the app with no live match on, because their profile changed this week
and their reputation is on the line.

### The spine: log the match, don't just predict it (architecture)

The prediction/reputation loop is a *feeder*, not the trunk. The trunk — the thing
that makes this a Letterboxd for football rather than a betting app — is the
**post-match Log**: after the whistle, the user rates the match itself (a "what a
watch it was" score), tags **why** it was what it was (style tags: "Savunma dersi",
"Gol düellosu", "Taktik satranç"…), and rates **3 players — at least one from each
side** (2-1 or 1-2, never 3-0, so both teams are always judged). Each log is a
diary entry that accumulates and a bundle of **votes** that move the user's **Taste
Graph**.

The log serves **two audiences under one structure**: the **stadium traveler** (who
physically attends and *checks in* at the ground) and the **home viewer** (who watches
on a screen). Every log therefore records *how it was watched* — **Statta** (attended,
capturing the venue → a real "Stadiums" collection / passport) or **Ekrandan** (screen).
The collection, the pre-match check-in, and the "Ben Demiştim" shareable card are
*developments on top* of this foundation, built after the log itself is solid.

The hard rule, and the reason this can work where a "Football Taste Graph" would
otherwise die: **identity is earned, never assigned.** The Taste Graph is not drawn
by AI ("you like possession football") — the user cannot argue with an AI label and
the moment they do, the system loses trust. Instead the graph is the *resultant of
the user's own 200 clicks*: rate Vinícius 9 → the graph slides "flair/attacker";
tag a 0-0 "Savunma dersi" → it slides "pragmatist". AI only holds the mirror; the
user paints, with every rating and tag. That makes the identity **irrefutable** —
the evidence is their own taps. This log → Taste Graph → (weekly seal, "you vs the
crowd") loop is the retention engine; prediction points and community leagues hang
off it, not the other way round.

## Brand Personality

**Playful · social · identity-focused** in spirit — a Strava/Letterboxd for
football, where the user shares *themselves*, not just the match. But the
playfulness lives in the *mechanics* (points, streaks of correct calls, DNA bars,
leaderboards, "kim haklı?" moments), never in the chrome. Voice is confident,
lightly competitive, warm, and Turkish-native — it speaks like a football friend
who keeps score, not like a corporate data vendor and not like a cartoon.

Emotional goals: the small thrill of calling it right, the sting of a dropped
leaderboard spot, the pride of a shareable identity.

## Anti-references

- **Flashscore / grey corporate stat-dumps.** Endless identity-less tables, muted
  grey-on-grey, zero personality. We are the opposite: the data is a stage for the
  user's take, not the end in itself.
- **Over-gamified / childish game UI.** No confetti storms, cartoon mascots,
  garish badge spam, or toy-like bounce. The reputation system is real and a
  little serious; gamification is felt, not shouted.
- **Betting-site clutter (Nesine / Bilyoner look).** No ad-dense, odds-bombarded,
  cramped screens. Prediction here is reputation-based and calm, not a coupon
  sales floor.
- **SaaS bevel / gradient-glow template.** Shiny embossed buttons, decorative
  glass, inset highlights — deliberately stripped out already; keep surfaces flat.
- **AI-assigned identity.** Never let the app *tell* the user who they are as a fan
  ("your taste is possession football"). An externally-assigned identity is one the
  user can reject, and rejection collapses the whole premise. The app only reflects
  the identity the user has *earned* through their own logged ratings and tags.

## Design Principles

1. **Take a position, don't just watch.** Every match surface invites an action —
   a one-tap 1X2 on the card, a coupon in the modal, a player rating after the
   whistle. Passive consumption is the fallback, not the default.
2. **The user is the product.** Lean into identity over raw statistics: reputation,
   Taste Graph, "you vs the community." What the user carries away (who they are
   as a football mind) matters more than any single table. This is the Strava move.
3. **Earned, not assigned — the user paints, AI holds the mirror.** Every identity
   surface (Taste Graph, DNA, "Football Take") must be visibly the sum of the user's
   own choices — this rating, that tag — never a label handed down. If a screen tells
   the user their taste instead of *showing them their own evidence*, it's wrong. The
   post-match Log (match score + style tags + 3 players, one per side) is the brush.
4. **Playful soul, minimalist surface.** The gamified/social energy belongs to the
   mechanics; the visual execution stays clean, flat, and modern — no bevels, no
   glow, no childish flourish. If a screen looks like a toy or a spreadsheet, it's
   wrong on opposite ends.
5. **Lean on the rating moat.** Prefer features only our per-player-rating data can
   power (man-of-the-match prediction, rating consensus, Taste Graph) over generic
   stats anyone can show.
6. **Earn every re-open.** Design each match phase — pre, in, post — to leave a
   concrete reason to come back (lock it in / how's it going / was I right / log it).

## Accessibility & Inclusion

- Target **WCAG 2.1 AA**. Body text ≥ 4.5:1, large/bold ≥ 3:1 — watch muted grays
  on tinted surfaces and the purple accent on light backgrounds.
- **Light and dark themes are both first-class.** Never let one theme silently
  break contrast (a real past bug: the light-mode purple navbar's global
  `color:#fff !important` whited out a portaled dropdown's text — theme-scoped
  overrides must not leak into detached layers).
- **Reduced motion is required.** The app uses slide/fade/pulse transitions; every
  one needs a `prefers-reduced-motion: reduce` fallback (crossfade or instant).
- **Mobile-first, touch-first**, with a bottom nav; desktop is a real second layout
  (Nesine-style two-column), not a stretched phone view. Tap targets ≥ 40px.
- Turkish-native copy with EN/DE support; keep locale-aware casing (Turkish İ/ı)
  in mind for any generated/transformed labels.
