// app/_lib/routes.js — URL slug <-> internal id helpers, shared by the server route pages.

// Canonical site origin (override per-env with NEXT_PUBLIC_SITE_URL). fikstür.com in punycode.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://xn--fikstr-7ya.com").replace(/\/+$/, "");

// Sport slug == internal sport id (keeps URLs clean: /football, /volleyball, ...).
export const SPORT_SLUGS = ["live", "football", "basketball", "motorsport", "tennis", "volleyball", "esports", "mma"];
export function isSport(s) { return SPORT_SLUGS.indexOf(s) !== -1; }

// Human-readable sport names for page titles / SEO.
export const SPORT_NAMES = {
  live: "Canlı Skorlar", football: "Futbol", basketball: "Basketbol", motorsport: "Formula 1",
  tennis: "Tenis", volleyball: "Voleybol", esports: "E-Spor", mma: "MMA",
};

// Fallback "Premier League" from "premier-league" when we can't resolve the real league name.
export function prettyFromSlug(slug) {
  return String(slug || "").split("-").map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join(" ");
}

// Turkish-aware slugify for league names: "Super Lig" -> "super-lig", "Serie A" -> "serie-a".
export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[ıi]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/İ/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
