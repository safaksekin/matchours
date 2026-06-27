// app/[[...slug]]/page.js — single catch-all route for the whole app.
// Handles /, /[sport], /[sport]/[league] in ONE page component so the client <Home>
// never remounts when navigating between them (smooth transitions, no full reload).
import Home from "../Home";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { SPORT_SLUGS, isSport, SPORT_NAMES, prettyFromSlug, slugify, SITE_URL } from "../_lib/routes";

// Prerender "/" and each "/[sport]" as static; league pages are server-rendered on demand.
export function generateStaticParams() {
  return [{ slug: [] }].concat(SPORT_SLUGS.map(function (s) { return { slug: [s] }; }));
}

// Resolve the real league name from its slug (against the curated league list) for the page title.
async function leagueNameFromSlug(sport, leagueSlug) {
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return null;
    const proto = host.indexOf("localhost") === 0 || host.indexOf("127.0.0.1") === 0 ? "http" : "https";
    const res = await fetch(proto + "://" + host + "/api/football?mode=leagues&sport=" + sport, { next: { revalidate: 86400 } });
    const j = await res.json();
    let name = null;
    (j.leagues || []).forEach(function (g) {
      (g.leagues || []).forEach(function (l) { if (slugify(l.name) === leagueSlug) name = l.name; });
    });
    return name;
  } catch (e) { return null; }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const parts = slug || [];
  const sport = parts[0];
  const league = parts[1];

  if (!sport) {
    return {
      title: "fikstür.com — Tüm Spor İstatistikleri, Canlı Skorlar ve Fikstür",
      description: "Futbol, basketbol, voleybol ve daha fazlası: canlı skorlar, fikstür, puan durumu, gol krallığı ve maç istatistikleri tek ekranda.",
      alternates: { canonical: SITE_URL + "/" },
    };
  }

  const sportName = SPORT_NAMES[sport] || prettyFromSlug(sport);
  if (!league) {
    return {
      title: sportName + " Canlı Skorlar, Fikstür ve Puan Durumu | fikstür.com",
      description: sportName + " canlı skorlar, günün maçları, fikstür, puan durumu ve istatistikler — fikstür.com.",
      alternates: { canonical: SITE_URL + "/" + sport },
    };
  }

  const realName = (await leagueNameFromSlug(sport === "live" ? "football" : sport, league)) || prettyFromSlug(league);
  return {
    title: realName + " Puan Durumu, Fikstür ve Gol Krallığı | fikstür.com",
    description: realName + " puan durumu, fikstür, maç sonuçları, gol krallığı ve detaylı istatistikler — fikstür.com.",
    alternates: { canonical: SITE_URL + "/" + sport + "/" + league },
  };
}

export default async function Page({ params }) {
  const { slug } = await params;
  const parts = slug || [];
  if (parts.length > 2) notFound();
  const sport = parts[0] || "football";
  const league = parts[1] || null;
  if (parts.length > 0 && !isSport(sport)) notFound();
  return <Home initialSport={sport} initialLeagueSlug={league} />;
}
