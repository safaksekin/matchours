"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "./lib/supabaseClient";

const COLORS = {
  bg: "#EEF2F2", surface: "#FFFFFF", card: "#FFFFFF", cardAlt: "#F5F8F8",
  border: "#D8E2E2", accent: "#0FB894", accentDim: "rgba(15,184,148,0.10)",
  teal: "#BBD5DA", mint: "#DFF1F1",
  textPrimary: "#1A2A2A", textSecondary: "#5C7374", textMuted: "#9AAEAE",
  red: "#E2473F", yellow: "#D9A521",
};
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

const I18N = {
  tr: { tagline: "Tum spor istatistikleri, tek ekranda.", email: "E-posta", password: "Sifre",
    login: "Giris Yap", loggingIn: "Giris yapiliyor...", noAccount: "Hesabin yok mu?", signup: "Kayit ol",
    matches: "Musabaka", noMatches: "Bu kategoride musabaka bulunamadi.", loading: "Yukleniyor...",
    live: "CANLI", info: "Bilgi", squads: "Kadrolar", grid: "Grid", tv: "Yayin", comments: "Yorumlar",
    referee: "Hakem", stadium: "Stadyum", city: "Sehir", rank: "Lig Sirasi",
    last5: "Son 5 Mac", draw: "Berabere", totalMatches: "karsilasma", h2hLoad: "H2H yukle",
    writeComment: "Yorum yaz...", send: "Gonder", now: "simdi", lineupSoon: "Kadrolar mac oncesi aciklanir.",
    profile: "Profil", back: "Geri", member: "matchours uyesi", pro: "PRO uye",
    followedMatches: "Takip Edilen", commentsCount: "Yorum", favLeague: "Favori Lig", membership: "Uyelik",
    favTeams: "Favori Takimlar", recentActivity: "Son Aktivite", logout: "Cikis Yap",
    scorers: "Gol Krallari", standing: "Puan Durumu", points: "P", matchday: "Hafta", week: "Hafta", noStandings: "Puan durumu mevcut degil.", noH2h: "Gecmis karsilasma yok.",
    fillFields: "Email ve sifre gerekli.", checkEmail: "Onay icin e-postani kontrol et.",
    finished: "Mac Sonucu",
    vsHome: "vs", vsAway: "@",
    sports: { football: "Futbol", basketball: "Basketbol", motorsport: "Formula 1", tennis: "Tenis" } },
  en: { tagline: "All sports stats, on one screen.", email: "Email", password: "Password",
    login: "Log In", loggingIn: "Logging in...", noAccount: "No account?", signup: "Sign up",
    matches: "Matches", noMatches: "No matches in this category.", loading: "Loading...",
    live: "LIVE", info: "Info", squads: "Squads", grid: "Grid", tv: "Broadcast", comments: "Comments",
    referee: "Referee", stadium: "Stadium", city: "City", rank: "League Rank",
    last5: "Last 5 Matches", draw: "Draw", totalMatches: "meetings", h2hLoad: "Load H2H",
    writeComment: "Write a comment...", send: "Send", now: "now", lineupSoon: "Lineups announced before kickoff.",
    profile: "Profile", back: "Back", member: "matchours member", pro: "PRO member",
    followedMatches: "Followed", commentsCount: "Comments", favLeague: "Favorite League", membership: "Member Since",
    favTeams: "Favorite Teams", recentActivity: "Recent Activity", logout: "Log Out",
    scorers: "Top Scorers", standing: "Standings", points: "pts", matchday: "Matchday", week: "Week", noStandings: "Standings not available.", noH2h: "No previous meetings.",
    fillFields: "Email and password required.", checkEmail: "Check your email to confirm.",
    finished: "Full Time",
    vsHome: "vs", vsAway: "@",
    sports: { football: "Football", basketball: "Basketball", motorsport: "Formula 1", tennis: "Tennis" } },
  de: { tagline: "Alle Sportstatistiken auf einem Bildschirm.", email: "E-Mail", password: "Passwort",
    login: "Anmelden", loggingIn: "Anmeldung...", noAccount: "Kein Konto?", signup: "Registrieren",
    matches: "Spiele", noMatches: "Keine Spiele in dieser Kategorie.", loading: "Laden...",
    live: "LIVE", info: "Info", squads: "Kader", grid: "Grid", tv: "Ubertragung", comments: "Kommentare",
    referee: "Schiedsrichter", stadium: "Stadion", city: "Stadt", rank: "Tabellenplatz",
    last5: "Letzte 5 Spiele", draw: "Unentschieden", totalMatches: "Begegnungen", h2hLoad: "H2H laden",
    writeComment: "Kommentar schreiben...", send: "Senden", now: "jetzt", lineupSoon: "Aufstellung vor Anpfiff.",
    profile: "Profil", back: "Zuruck", member: "matchours Mitglied", pro: "PRO Mitglied",
    followedMatches: "Verfolgt", commentsCount: "Kommentare", favLeague: "Lieblingsliga", membership: "Mitglied seit",
    favTeams: "Lieblingsteams", recentActivity: "Letzte Aktivitat", logout: "Abmelden",
    scorers: "Torjager", standing: "Tabelle", points: "Pkt", matchday: "Spieltag", week: "Spieltag", noStandings: "Tabelle nicht verfugbar.", noH2h: "Keine fruheren Begegnungen.",
    fillFields: "E-Mail und Passwort erforderlich.", checkEmail: "Bestatige deine E-Mail.",
    finished: "Endstand",
    vsHome: "vs", vsAway: "@",
    sports: { football: "Fussball", basketball: "Basketball", motorsport: "Formel 1", tennis: "Tennis" } },
};

const SPORT_TABS = [{ id: "football" }, { id: "basketball" }, { id: "motorsport" }, { id: "tennis" }];

// Rich fallback so the UI looks like a real stats site even before a key is added
const MOCK = {
  football: [], // football uses real API only; no fabricated data
  basketball: [
    { id: "bk1", home: "Lakers", away: "Celtics", homeLogo: null, awayLogo: null,
      time: "03:00", date: "23.06", league: "NBA", status: "upcoming", score: null,
      stats: { referee: "Scott Foster", stadium: "Crypto.com Arena", city: "Los Angeles",
        homeForm: ["W","L","W","W","W"], awayForm: ["W","W","W","L","W"], homeRank: 4, awayRank: 1,
        homeSquad: ["James","Davis","Reaves","Russell","Hachimura"], awaySquad: ["Tatum","Brown","White","Holiday","Porzingis"],
        channels: ["ESPN"], h2h: { total: 30, homeWins: 14, awayWins: 16, draws: 0 }, comments: [] } },
  ],
  motorsport: [
    { id: "f1a", home: "British GP - Silverstone", away: "", homeLogo: null, awayLogo: null,
      time: "16:00", date: "28.06", league: "Formula 1", status: "upcoming", score: null,
      stats: { referee: "Niels Wittich", stadium: "Silverstone Circuit", city: "Silverstone",
        homeForm: ["VER","NOR","VER","LEC","VER"], awayForm: [], homeRank: null, awayRank: null,
        homeSquad: ["P1 Verstappen","P2 Norris","P3 Leclerc","P4 Piastri","P5 Sainz","P6 Hamilton","P7 Russell"],
        awaySquad: [], channels: ["S Sport"], h2h: { total: 0, homeWins: 0, awayWins: 0, draws: 0 }, comments: [] } },
  ],
  tennis: [
    { id: "tn1", home: "Djokovic", away: "Alcaraz", homeLogo: null, awayLogo: null,
      time: "15:00", date: "25.06", league: "Wimbledon", status: "upcoming", score: null,
      stats: { referee: "M. Lahyani", stadium: "Centre Court", city: "London",
        homeForm: ["W","W","W","W","W"], awayForm: ["W","W","W","L","W"], homeRank: 2, awayRank: 1,
        homeSquad: ["ATP #2","Grand Slam: 24","Wimbledon: 7"], awaySquad: ["ATP #1","Grand Slam: 4","Wimbledon: 2"],
        channels: ["Eurosport"], h2h: { total: 10, homeWins: 4, awayWins: 6, draws: 0 }, comments: [] } },
  ],
};

// ─── components ───
function TeamLogo({ src, name, size }) {
  var s = size || 22;
  if (src) return <img src={src} alt="" style={{ width: s, height: s, objectFit: "contain", flexShrink: 0 }} />;
  return <div style={{ width: s, height: s, borderRadius: 6, background: COLORS.accentDim, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.accent, fontSize: s*0.45, fontWeight: 800 }}>
    {name ? name[0] : "?"}</div>;
}

function FormBadge({ result }) {
  var c = { W: COLORS.accent, D: COLORS.yellow, L: COLORS.red };
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 24, height: 24, borderRadius: 7, fontSize: 10, fontWeight: 700,
    background: (c[result] || COLORS.textMuted) + "1F", color: c[result] || COLORS.textSecondary, marginRight: 4 }}>{result}</span>;
}

function StatRow({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0",
    borderBottom: "1px solid " + COLORS.border }}>
    <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{label}</span>
    <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{value}</span></div>;
}

function SportButton({ active, onClick, children }) {
  var [ripple, setRipple] = useState(null);
  var [hovered, setHovered] = useState(false);
  var ref = useRef(null);
  function enter(e) {
    var r = ref.current.getBoundingClientRect();
    setRipple({ x: e.clientX - r.left, y: e.clientY - r.top, size: Math.max(r.width, r.height) * 2.5, id: Date.now() });
    setHovered(true);
  }
  return <button ref={ref} onClick={onClick} onMouseEnter={enter} onMouseLeave={function(){ setRipple(null); setHovered(false); }}
    style={{ flexShrink: 0, position: "relative", overflow: "hidden", padding: "10px 20px",
      border: "1px solid " + (active ? COLORS.accent + "55" : COLORS.border), borderRadius: 18,
      fontSize: 13, fontWeight: active ? 700 : 600, cursor: "pointer",
      background: active ? COLORS.accentDim : COLORS.card, color: (active || hovered) ? COLORS.accent : COLORS.textSecondary,
      transition: "color 0.4s, background 0.4s, border-color 0.4s", fontFamily: FONT }}>
    {ripple && <span key={ripple.id} style={{ position: "absolute", borderRadius: "50%", width: ripple.size, height: ripple.size,
      left: ripple.x - ripple.size/2, top: ripple.y - ripple.size/2, background: COLORS.accent,
      animation: "rippleFill 0.8s cubic-bezier(0.16,1,0.3,1) forwards", pointerEvents: "none" }} />}
    <span style={{ position: "relative", zIndex: 1 }}>{children}</span></button>;
}

function CommentSection({ comments, t }) {
  var [v, setV] = useState("");
  var [list, setList] = useState(comments || []);
  function submit() { if (!v.trim()) return; setList([{ user: "sen", text: v, time: t.now }].concat(list)); setV(""); }
  return <div>
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <input value={v} onChange={function(e){ setV(e.target.value); }} onKeyDown={function(e){ if (e.key==="Enter") submit(); }}
        placeholder={t.writeComment} style={{ flex: 1, padding: "9px 13px", background: COLORS.cardAlt,
        border: "1px solid " + COLORS.border, borderRadius: 12, color: COLORS.textPrimary, fontSize: 13, outline: "none", fontFamily: FONT }} />
      <button onClick={submit} style={{ padding: "9px 16px", background: COLORS.accent, border: "none", borderRadius: 12,
        color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>{t.send}</button>
    </div>
    {list.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "16px 0" }}>—</div>}
    {list.map(function(c, i){ return <div key={i} style={{ padding: "10px 12px", background: COLORS.cardAlt, borderRadius: 12,
      marginBottom: 7, border: "1px solid " + COLORS.border }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 700 }}>@{c.user}</span>
        <span style={{ color: COLORS.textMuted, fontSize: 11 }}>{c.time}</span></div>
      <span style={{ color: COLORS.textPrimary, fontSize: 13 }}>{c.text}</span></div>; })}
  </div>;
}

function MatchDetail({ match, isF1, t }) {
  var s = match.stats;
  var [tab, setTab] = useState("info");
  var [h2h, setH2h] = useState(s.h2h);
  var [h2hLoading, setH2hLoading] = useState(false);
  var [standings, setStandings] = useState(null); // { home:{form,rank,points}, away:{...} }
  var [stLoading, setStLoading] = useState(false);
  var [scorers, setScorers] = useState(null);
  var [scLoading, setScLoading] = useState(false);
  var [recent, setRecent] = useState(null);
  var [rcLoading, setRcLoading] = useState(false);

  // lazy: standings (form + rank + points) for the info tab
  useEffect(function(){
    if (tab !== "info" || standings || isF1 || !match.comp || !match.homeId) return;
    setStLoading(true);
    fetch("/api/football?mode=standings&comp=" + match.comp)
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (j.standings) {
          setStandings({
            home: j.standings[match.homeId] || null,
            away: j.standings[match.awayId] || null,
          });
        } else { setStandings({ home: null, away: null }); }
      })
      .catch(function(){ setStandings({ home: null, away: null }); })
      .finally(function(){ setStLoading(false); });
  }, [tab]);

  // lazy: H2H
  useEffect(function(){
    if (tab !== "h2h" || h2h.total > 0 || !match.id) return;
    setH2hLoading(true);
    fetch("/api/football?mode=h2h&match=" + match.id)
      .then(function(r){ return r.json(); })
      .then(function(j){ if (j.h2h) setH2h(j.h2h); }).catch(function(){})
      .finally(function(){ setH2hLoading(false); });
  }, [tab]);

  // lazy: scorers
  useEffect(function(){
    if (tab !== "scorers" || scorers || !match.comp) return;
    setScLoading(true);
    fetch("/api/football?mode=scorers&comp=" + match.comp)
      .then(function(r){ return r.json(); })
      .then(function(j){ setScorers(j.scorers || []); }).catch(function(){ setScorers([]); })
      .finally(function(){ setScLoading(false); });
  }, [tab]);

  // lazy: last-5 matches with scores
  useEffect(function(){
    if (tab !== "info" || recent || isF1 || !match.homeId) return;
    setRcLoading(true);
    fetch("/api/football?mode=recent&home=" + match.homeId + "&away=" + (match.awayId || ""))
      .then(function(r){ return r.json(); })
      .then(function(j){ setRecent(j.recent || { home: [], away: [] }); })
      .catch(function(){ setRecent({ home: [], away: [] }); })
      .finally(function(){ setRcLoading(false); });
  }, [tab]);

  var homeSt = standings && standings.home;
  var awaySt = standings && standings.away;
  var homeForm = (homeSt && homeSt.form) || [];
  var awayForm = (awaySt && awaySt.form) || [];

  var tabs = [{ id: "info", label: t.info }];
  if (isF1 && s.homeSquad.length > 0) tabs.push({ id: "grid", label: t.grid });
  if (!isF1) tabs.push({ id: "h2h", label: "H2H" });
  if (!isF1) tabs.push({ id: "scorers", label: t.scorers });
  if (s.channels.length > 0) tabs.push({ id: "tv", label: t.tv });
  tabs.push({ id: "comments", label: t.comments });

  return <div style={{ background: COLORS.cardAlt, borderTop: "1px solid " + COLORS.border, padding: "14px 18px 18px",
    animation: "slideDown 0.32s cubic-bezier(0.16,1,0.3,1)" }}>
    <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto" }}>
      {tabs.map(function(tb){ var a = tab === tb.id;
        return <button key={tb.id} onClick={function(){ setTab(tb.id); }} style={{ flexShrink: 0, padding: "7px 14px",
          border: "none", borderRadius: 11, fontSize: 12, fontWeight: a ? 700 : 600, cursor: "pointer",
          background: a ? COLORS.accentDim : "transparent", color: a ? COLORS.accent : COLORS.textSecondary,
          transition: "all 0.2s", fontFamily: FONT }}>{tb.label}</button>; })}
    </div>

    {tab === "info" && <div>
      <StatRow label={t.referee} value={s.referee} />
      <StatRow label={t.stadium} value={s.stadium} />
      <StatRow label={t.city} value={s.city} />
      {match.matchday && <StatRow label={t.matchday} value={match.matchday + ". " + t.week} />}

      {!isF1 && <div style={{ marginTop: 16 }}>
        {stLoading && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "10px 0" }}>{t.loading}</div>}

        {(homeSt || awaySt) && <div style={{ marginBottom: 16 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10, fontWeight: 700 }}>{t.standing}</div>
          {[{ team: match.home, st: homeSt }, { team: match.away, st: awaySt }].map(function(x, i){
            return <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", marginBottom: 6, background: COLORS.card, borderRadius: 12, border: "1px solid " + COLORS.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: COLORS.accentDim, color: COLORS.accent,
                  fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {x.st && x.st.rank ? x.st.rank : "-"}</span>
                <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{x.team}</span>
              </div>
              <span style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700 }}>
                {x.st ? (x.st.points + " " + t.points) : "—"}</span>
            </div>; })}
        </div>}

        {(rcLoading || (recent && (recent.home.length > 0 || recent.away.length > 0))) && <div>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10, fontWeight: 700 }}>{t.last5}</div>
          {rcLoading && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "8px 0" }}>{t.loading}</div>}
          {recent && [{ team: match.home, list: recent.home }, { team: match.away, list: recent.away }].map(function(blk, bi){
            if (!blk.list || blk.list.length === 0) return null;
            return <div key={bi} style={{ marginBottom: 12 }}>
              <div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{blk.team}</div>
              {blk.list.map(function(m, i){
                var c = m.result === "W" ? COLORS.accent : (m.result === "L" ? COLORS.red : COLORS.yellow);
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 11px",
                  marginBottom: 5, background: COLORS.card, borderRadius: 10, border: "1px solid " + COLORS.border }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: c + "1F", color: c, fontSize: 10,
                    fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{m.result}</span>
                  <span style={{ color: COLORS.textSecondary, fontSize: 12, flex: 1 }}>
                    {m.home ? t.vsHome : t.vsAway} {m.opp}</span>
                  <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 800 }}>{m.score}</span>
                </div>; })}
            </div>; })}
        </div>}
      </div>}

      {isF1 && s.homeForm.length > 0 && <div style={{ marginTop: 16 }}>
        <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 8, fontWeight: 700 }}>{t.last5}</div>
        <div>{s.homeForm.map(function(r, i){ return <span key={i} style={{ display: "inline-block",
          background: COLORS.accentDim, color: COLORS.accent, fontWeight: 700, fontSize: 11, padding: "4px 9px",
          borderRadius: 8, marginRight: 6 }}>{r}</span>; })}</div></div>}
    </div>}

    {tab === "grid" && <div>
      {s.homeSquad.map(function(p, i){ return <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0",
        borderBottom: "1px solid " + COLORS.border }}>
        <span style={{ color: COLORS.accent, fontWeight: 700, fontSize: 12, width: 30 }}>P{i+1}</span>
        <span style={{ color: COLORS.textPrimary, fontSize: 13 }}>{p}</span></div>; })}
    </div>}

    {tab === "h2h" && <div>
      {h2hLoading ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.loading}</div>
       : h2h.total === 0 ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noH2h}</div>
       : <>
        <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center", marginBottom: 18 }}>
          {[{ l: match.home, v: h2h.homeWins, c: COLORS.accent }, { l: t.draw, v: h2h.draws, c: COLORS.yellow },
            { l: match.away, v: h2h.awayWins, c: COLORS.red }].map(function(x, i){
            return <div key={i}><div style={{ fontSize: 30, fontWeight: 800, color: x.c }}>{x.v}</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 3 }}>{x.l}</div></div>; })}
        </div>
        <div style={{ height: 5, borderRadius: 3, background: COLORS.card, overflow: "hidden", display: "flex" }}>
          <div style={{ width: (h2h.homeWins/h2h.total*100)+"%", background: COLORS.accent }} />
          <div style={{ width: (h2h.draws/h2h.total*100)+"%", background: COLORS.yellow }} />
          <div style={{ width: (h2h.awayWins/h2h.total*100)+"%", background: COLORS.red }} /></div>
        <div style={{ color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: 9 }}>{h2h.total} {t.totalMatches}</div>
       </>}
    </div>}

    {tab === "scorers" && <div>
      {scLoading ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.loading}</div>
       : (!scorers || scorers.length === 0) ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>—</div>
       : scorers.map(function(sc, i){ return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", marginBottom: 6, background: COLORS.card, borderRadius: 12, border: "1px solid " + COLORS.border }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, background: COLORS.accentDim, color: COLORS.accent,
            fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i+1}</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{sc.name}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{sc.team}</div></div>
          <span style={{ color: COLORS.accent, fontSize: 15, fontWeight: 800 }}>{sc.goals}</span>
        </div>; })}
    </div>}

    {tab === "tv" && <div>{s.channels.map(function(ch, i){ return <div key={i} style={{ display: "flex", alignItems: "center",
      gap: 12, padding: "11px 14px", marginBottom: 7, background: COLORS.card, borderRadius: 14, border: "1px solid " + COLORS.border }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: COLORS.accentDim, display: "flex",
        alignItems: "center", justifyContent: "center", color: COLORS.accent, fontSize: 12, fontWeight: 700 }}>TV</div>
      <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{ch}</span></div>; })}</div>}

    {tab === "comments" && <CommentSection comments={s.comments} t={t} />}
  </div>;
}

function MatchCard({ match, isF1, expanded, onToggle, t }) {
  var isLive = match.status === "live";
  var showScore = match.score && (isLive || match.status === "finished");
  return <div style={{ background: COLORS.card, borderRadius: 24, overflow: "hidden", marginBottom: 12,
    border: "1px solid " + (isLive ? COLORS.accent + "55" : COLORS.border), boxShadow: "0 2px 14px rgba(20,40,40,0.05)" }}>
    <div onClick={onToggle} style={{ padding: "20px 22px", cursor: "pointer", display: "flex",
      alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          {isLive ? <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.red, background: COLORS.red + "18",
            padding: "2px 9px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.red, animation: "pulse 1.5s infinite", display: "inline-block" }} />{t.live}</span>
          : match.status === "finished" ? <span style={{ fontSize: 11, color: COLORS.textMuted }}>
            <span style={{ fontWeight: 700, color: COLORS.textSecondary }}>{match.league}</span>{"  ·  "}
            <span style={{ fontWeight: 700, color: COLORS.accent }}>{t.finished}</span></span>
          : <span style={{ fontSize: 11, color: COLORS.textMuted }}>
            <span style={{ fontWeight: 700, color: COLORS.textSecondary }}>{match.league}</span>{match.date ? "  ·  " + match.date : ""}</span>}
        </div>
        {isF1 ? <div style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: 700 }}>{match.home}</div>
        : <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9 }}>
              <TeamLogo src={match.homeLogo} name={match.home} />
              <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 700 }}>{match.home}</span></div>
            <div style={{ minWidth: 58, textAlign: "center", padding: "5px 10px", borderRadius: 12,
              background: showScore ? COLORS.accentDim : COLORS.cardAlt }}>
              {showScore ? <span style={{ color: COLORS.accent, fontSize: 16, fontWeight: 800 }}>{match.score}</span>
               : <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700 }}>{match.time}</span>}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-end" }}>
              <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 700, textAlign: "right" }}>{match.away}</span>
              <TeamLogo src={match.awayLogo} name={match.away} /></div>
          </div>}
      </div>
      <div style={{ marginLeft: 14, color: COLORS.textMuted, fontSize: 16,
        transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.3s ease" }}>▾</div>
    </div>
    {expanded && <MatchDetail match={match} isF1={isF1} t={t} />}
  </div>;
}

function LangSwitch({ lang, setLang }) {
  var langs = [{ id: "tr", label: "TR" }, { id: "en", label: "EN" }, { id: "de", label: "DE" }];
  return <div style={{ display: "inline-flex", background: COLORS.cardAlt, borderRadius: 12, padding: 3, border: "1px solid " + COLORS.border }}>
    {langs.map(function(l){ var a = lang === l.id;
      return <button key={l.id} onClick={function(){ setLang(l.id); }} style={{ border: "none",
        background: a ? COLORS.accent : "transparent", color: a ? "#fff" : COLORS.textSecondary, borderRadius: 9,
        padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", fontFamily: FONT }}>{l.label}</button>; })}
  </div>;
}

// Logo slot top-left: drop /public/logo.png and it shows; else wordmark
function Logo() {
  var [ok, setOk] = useState(true);
  return <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    {ok && <img src="/logo.PNG" alt="matchours" onError={function(){ setOk(false); }}
      style={{ height: 30, width: "auto", objectFit: "contain" }} />}
    {!ok && <span style={{ color: COLORS.textPrimary, fontSize: 22, fontWeight: 800, letterSpacing: "-0.8px" }}>
      match<span style={{ color: COLORS.accent }}>ours</span></span>}
  </div>;
}

function ProfilePage({ onBack, onLogout, session, t, lang, setLang }) {
  var userEmail = (session && session.user && session.user.email) || "";
  var displayName = userEmail ? userEmail.split("@")[0] : "user";
  var initial = displayName ? displayName[0].toUpperCase() : "U";
  var stats = [{ label: t.followedMatches, val: "147" }, { label: t.commentsCount, val: "38" },
    { label: t.favLeague, val: "Super Lig" }, { label: t.membership, val: lang === "de" ? "Jan. 2024" : "Ocak 2024" }];
  var favTeams = ["Galatasaray", "Real Madrid", "Lakers"];
  var act = { tr: ["Galatasaray - Fenerbahce takip edildi", "El Clasico'ya yorum yapildi", "Wimbledon favoriledi"],
    en: ["Followed Galatasaray - Fenerbahce", "Commented on El Clasico", "Favorited Wimbledon"],
    de: ["Galatasaray - Fenerbahce verfolgt", "El Clasico kommentiert", "Wimbledon favorisiert"] };
  var times = { tr: ["2s once", "1g once", "3g once"], en: ["2h ago", "1d ago", "3d ago"], de: ["vor 2 Std", "vor 1 Tag", "vor 3 Tagen"] };
  return <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: FONT }}>
    <div style={{ maxWidth: 500, margin: "0 auto", width: "100%" }}>
      <div style={{ padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 10, background: COLORS.bg,
        borderBottom: "1px solid " + COLORS.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: COLORS.card, border: "1px solid " + COLORS.border, borderRadius: 12,
            padding: "8px 14px", color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>{t.back}</button>
          <span style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: 800 }}>{t.profile}</span></div>
        <LangSwitch lang={lang} setLang={setLang} /></div>
      <div style={{ padding: "24px 20px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
          <div style={{ width: 68, height: 68, borderRadius: 22, flexShrink: 0,
            background: "linear-gradient(135deg, " + COLORS.accent + ", " + COLORS.teal + ")",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800, color: "#fff" }}>{initial}</div>
          <div><div style={{ color: COLORS.textPrimary, fontSize: 19, fontWeight: 800, marginBottom: 3 }}>{displayName}</div>
            <div style={{ color: COLORS.textSecondary, fontSize: 13 }}>{userEmail}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, background: COLORS.accentDim,
              borderRadius: 8, padding: "3px 10px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.accent, display: "inline-block" }} />
              <span style={{ color: COLORS.accent, fontSize: 11, fontWeight: 700 }}>{t.pro}</span></div></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
          {stats.map(function(st, i){ return <div key={i} style={{ background: COLORS.card, borderRadius: 18, padding: 16,
            border: "1px solid " + COLORS.border }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{st.val}</div>
            <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>{st.label}</div></div>; })}</div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.6px", marginBottom: 10 }}>{t.favTeams}</div>
          {favTeams.map(function(tm, i){ return <div key={i} style={{ display: "flex", alignItems: "center", gap: 12,
            padding: "12px 14px", marginBottom: 7, background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: COLORS.accentDim, display: "flex",
              alignItems: "center", justifyContent: "center", color: COLORS.accent, fontSize: 13, fontWeight: 800 }}>{tm[0]}</div>
            <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 700 }}>{tm}</span></div>; })}</div>
        <div>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.6px", marginBottom: 10 }}>{t.recentActivity}</div>
          {act[lang].map(function(text, i){ return <div key={i} style={{ padding: "11px 14px", marginBottom: 7,
            background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border, display: "flex",
            justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: COLORS.textPrimary, fontSize: 13, flex: 1, marginRight: 10 }}>{text}</span>
            <span style={{ color: COLORS.textMuted, fontSize: 11, flexShrink: 0 }}>{times[lang][i]}</span></div>; })}</div>
        <button onClick={onLogout} style={{ width: "100%", marginTop: 28, padding: 14, background: "transparent",
          border: "1px solid " + COLORS.red + "55", borderRadius: 16, color: COLORS.red, fontSize: 14,
          fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>{t.logout}</button>
      </div></div></div>;
}

function LoginScreen({ t, lang, setLang }) {
  var [mode, setMode] = useState("login"); // "login" | "signup"
  var [email, setEmail] = useState("");
  var [pass, setPass] = useState("");
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [info, setInfo] = useState("");

  function go() {
    setError(""); setInfo("");
    if (!email || !pass) { setError(t.fillFields); return; }
    setLoading(true);
    if (mode === "signup") {
      supabase.auth.signUp({ email: email, password: pass })
        .then(function(res){
          if (res.error) { setError(res.error.message); }
          else if (res.data && res.data.session) { /* auto signed in; onAuthStateChange handles it */ }
          else { setInfo(t.checkEmail); }
        })
        .catch(function(e){ setError(String(e)); })
        .finally(function(){ setLoading(false); });
    } else {
      supabase.auth.signInWithPassword({ email: email, password: pass })
        .then(function(res){ if (res.error) setError(res.error.message); })
        .catch(function(e){ setError(String(e)); })
        .finally(function(){ setLoading(false); });
    }
  }

  return <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT, position: "relative" }}>
    <div style={{ position: "absolute", top: 20, right: 20 }}><LangSwitch lang={lang} setLang={setLang} /></div>
    <div style={{ marginBottom: 40, textAlign: "center" }}>
      <h1 style={{ color: COLORS.textPrimary, fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: "-1px", fontFamily: FONT }}>
        match<span style={{ color: COLORS.accent }}>ours</span></h1>
      <p style={{ color: COLORS.textSecondary, fontSize: 14, marginTop: 8 }}>{t.tagline}</p></div>

    <div style={{ width: "100%", maxWidth: 360 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: COLORS.cardAlt, borderRadius: 14,
        padding: 4, border: "1px solid " + COLORS.border }}>
        {[{ id: "login", label: t.login }, { id: "signup", label: t.signup }].map(function(m){ var a = mode === m.id;
          return <button key={m.id} onClick={function(){ setMode(m.id); setError(""); setInfo(""); }} style={{ flex: 1,
            border: "none", borderRadius: 11, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: a ? COLORS.accent : "transparent", color: a ? "#fff" : COLORS.textSecondary,
            transition: "all 0.2s", fontFamily: FONT }}>{m.label}</button>; })}
      </div>

      <input placeholder={t.email} value={email} onChange={function(e){ setEmail(e.target.value); }}
        style={{ width: "100%", padding: "14px 16px", background: COLORS.card, border: "1px solid " + COLORS.border,
          borderRadius: 16, color: COLORS.textPrimary, fontSize: 15, outline: "none", marginBottom: 12, boxSizing: "border-box", fontFamily: FONT }} />
      <input placeholder={t.password} type="password" value={pass} onChange={function(e){ setPass(e.target.value); }}
        onKeyDown={function(e){ if (e.key==="Enter") go(); }}
        style={{ width: "100%", padding: "14px 16px", background: COLORS.card, border: "1px solid " + COLORS.border,
          borderRadius: 16, color: COLORS.textPrimary, fontSize: 15, outline: "none", marginBottom: 16, boxSizing: "border-box", fontFamily: FONT }} />

      {error && <div style={{ color: COLORS.red, fontSize: 12, marginBottom: 12, textAlign: "center" }}>{error}</div>}
      {info && <div style={{ color: COLORS.accent, fontSize: 12, marginBottom: 12, textAlign: "center" }}>{info}</div>}

      <button onClick={go} disabled={loading} style={{ width: "100%", padding: 14, background: loading ? COLORS.textMuted : COLORS.accent,
        border: "none", borderRadius: 16, color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: FONT }}>
        {loading ? t.loggingIn : (mode === "signup" ? t.signup : t.login)}</button>
    </div></div>;
}

export default function Home() {
  var [lang, setLang] = useState("tr");
  var [session, setSession] = useState(null);
  var [authReady, setAuthReady] = useState(false);
  var [activeSport, setActiveSport] = useState("football");
  var [expandedId, setExpandedId] = useState(null);
  var [showProfile, setShowProfile] = useState(false);
  var [data, setData] = useState({});
  var [loading, setLoading] = useState(false);
  var t = I18N[lang];
  var loggedIn = !!session;

  // Track Supabase auth session
  useEffect(function(){
    supabase.auth.getSession().then(function(res){
      setSession(res.data ? res.data.session : null);
      setAuthReady(true);
    });
    var sub = supabase.auth.onAuthStateChange(function(_event, sess){
      setSession(sess);
    });
    return function(){ if (sub && sub.data && sub.data.subscription) sub.data.subscription.unsubscribe(); };
  }, []);

  function logout() {
    supabase.auth.signOut();
    setShowProfile(false);
  }

  useEffect(function(){
    if (!loggedIn || data[activeSport]) return;
    var cancelled = false;
    setLoading(true);
    // Only football has a live API route; other sports use rich mock for now
    if (activeSport === "football") {
      fetch("/api/football?mode=list").then(function(r){ return r.json(); })
        .then(function(j){ if (cancelled) return;
          var arr = (j.matches && j.matches.length) ? j.matches : [];
          setData(function(p){ var n = {}; n.football = arr; return Object.assign({}, p, n); });
          setLoading(false); })
        .catch(function(){ if (cancelled) return;
          setData(function(p){ var n = {}; n.football = []; return Object.assign({}, p, n); });
          setLoading(false); });
    } else {
      setTimeout(function(){ if (cancelled) return;
        setData(function(p){ var n = {}; n[activeSport] = MOCK[activeSport] || []; return Object.assign({}, p, n); });
        setLoading(false); }, 300);
    }
    return function(){ cancelled = true; };
  }, [loggedIn, activeSport]);

  if (!authReady) return <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex",
    alignItems: "center", justifyContent: "center", color: COLORS.textSecondary, fontFamily: FONT, fontSize: 14 }}>{t.loading}</div>;
  if (!loggedIn) return <LoginScreen t={t} lang={lang} setLang={setLang} />;
  if (showProfile) return <ProfilePage onBack={function(){ setShowProfile(false); }} onLogout={logout} session={session} t={t} lang={lang} setLang={setLang} />;

  var matches = data[activeSport] || [];
  return <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: FONT }}>
    <style>{"@keyframes slideDown{from{opacity:0;max-height:0}to{opacity:1;max-height:1400px}}" +
      "@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}" +
      "@keyframes rippleFill{0%{transform:scale(0);opacity:0.18}60%{opacity:0.12}100%{transform:scale(1);opacity:0}}" +
      "*{box-sizing:border-box}::-webkit-scrollbar{display:none}body{margin:0}"}</style>
    <div style={{ maxWidth: 500, margin: "0 auto", width: "100%" }}>
      <div style={{ padding: "20px 20px 14px", position: "sticky", top: 0, zIndex: 10, background: COLORS.bg,
        borderBottom: "1px solid " + COLORS.border }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Logo />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LangSwitch lang={lang} setLang={setLang} />
            <button onClick={function(){ setShowProfile(true); }} style={{ width: 38, height: 38, borderRadius: 13,
              background: COLORS.card, border: "1px solid " + COLORS.border, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", color: COLORS.textPrimary, fontSize: 15, fontWeight: 700 }}>S</button>
          </div></div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {SPORT_TABS.map(function(sp){ var a = activeSport === sp.id;
            return <div key={sp.id} style={{ flexShrink: 0 }}>
              <SportButton active={a} onClick={function(){ setActiveSport(sp.id); setExpandedId(null); }}>{t.sports[sp.id]}</SportButton></div>; })}
        </div></div>
      <div style={{ padding: "16px 16px 80px" }}>
        {loading ? <div style={{ textAlign: "center", padding: "70px 20px", color: COLORS.textSecondary, fontSize: 14 }}>{t.loading}</div>
         : matches.length === 0 ? <div style={{ textAlign: "center", padding: "70px 20px", color: COLORS.textSecondary, fontSize: 14 }}>{t.noMatches}</div>
         : <><div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: "0.6px",
            textTransform: "uppercase", marginBottom: 12, paddingLeft: 2 }}>{matches.length} {t.matches}</div>
            {matches.map(function(m){ return <MatchCard key={m.id} match={m} isF1={activeSport === "motorsport"}
              expanded={expandedId === m.id} t={t} onToggle={function(){ setExpandedId(expandedId === m.id ? null : m.id); }} />; })}
           </>}
      </div></div></div>;
}