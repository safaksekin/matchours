// app/[[...slug]]/page.js — single catch-all route for the whole app.
// Handles /, /[sport], /[sport]/[league] in ONE page component so the client <Home>
// never remounts when navigating between them (smooth transitions, no full reload).
import Home from "../Home";
import { notFound } from "next/navigation";
import { SPORT_SLUGS, isSport, SPORT_NAMES, prettyFromSlug, SITE_URL } from "../_lib/routes";

// Prerender "/" and each "/[sport]" as static; league pages are server-rendered on demand.
export function generateStaticParams() {
  return [{ slug: [] }].concat(SPORT_SLUGS.map(function (s) { return { slug: [s] }; }));
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

  // league name derived from the slug (no network call — avoids a self-subrequest that 500s on Cloudflare)
  const realName = prettyFromSlug(league);
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
