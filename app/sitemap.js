// app/sitemap.js — lists the app's URLs (home + sports + football leagues) for crawlers.
import { SITE_URL, SPORT_SLUGS, slugify } from "./_lib/routes";

export default async function sitemap() {
  const urls = [{ url: SITE_URL + "/", changeFrequency: "daily", priority: 1 }];

  SPORT_SLUGS.forEach(function (s) {
    if (s === "live") return; // /live is just football's live view
    urls.push({ url: SITE_URL + "/" + s, changeFrequency: "daily", priority: 0.8 });
  });

  // football leagues (the main SEO surface) — resolved from the curated league list
  try {
    const res = await fetch(SITE_URL + "/api/football?mode=leagues&sport=football", { next: { revalidate: 86400 } });
    const j = await res.json();
    (j.leagues || []).forEach(function (g) {
      (g.leagues || []).forEach(function (l) {
        urls.push({ url: SITE_URL + "/football/" + slugify(l.name), changeFrequency: "daily", priority: 0.7 });
      });
    });
  } catch (e) {}

  return urls;
}
