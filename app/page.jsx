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
    live: "CANLI", info: "Bilgi", grid: "Grid", tv: "Yayin", comments: "Yorumlar",
    referee: "Hakem", stadium: "Stadyum", city: "Sehir", rank: "Lig Sirasi",
    last5: "Son 5 Mac", draw: "Berabere", totalMatches: "karsilasma", h2hLoad: "H2H yukle",
    writeComment: "Yorum yaz...", send: "Gonder", now: "simdi",
    profile: "Profil", back: "Geri", member: "matchours uyesi", pro: "PRO uye",
    followedMatches: "Takip Edilen", commentsCount: "Yorum", favLeague: "Favori Lig", membership: "Uyelik",
    favTeams: "Favori Takimlar", recentActivity: "Son Aktivite", logout: "Cikis Yap",
    scorers: "Gol Krallari", standing: "Puan Durumu", points: "P", matchday: "Hafta", week: "Hafta", noStandings: "Puan durumu mevcut degil.", noH2h: "Gecmis karsilasma yok.",
    fillFields: "Email ve sifre gerekli.", checkEmail: "Onay icin e-postani kontrol et.",
    finished: "Mac Sonucu",
    vsHome: "vs", vsAway: "@",
    squads: "Kadrolar", matchStats: "Istatistik", bench: "Yedekler", lineupSoon: "Kadro henuz aciklanmadi.", noMatchStats: "Istatistik mevcut degil.", possession: "Topla Oynama", shots: "Sut", shotsOn: "Isabetli Sut", shotsOff: "Isabetsiz Sut", corners: "Korner", fouls: "Faul", offsides: "Ofsayt", saves: "Kurtaris", throwIns: "Tac", freeKicks: "Serbest Vurus", goalKicks: "Kale Vurusu", yellowCards: "Sari Kart", redCards: "Kirmizi Kart",
    blockedShots: "Bloke Sut", totalPasses: "Toplam Pas", accuratePasses: "Isabetli Pas",
    substitutions: "Degisiklikler",
    h2hLabel: "Rekabet Gecmisi", pastMatches: "Gecmis Maclar", vsLabel: "vs",
    searchPlaceholder: "Takim veya lig ara...", noResults: "Sonuc bulunamadi.", weather: "Hava Durumu", wxClear: "Acik", wxCloudy: "Bulutlu", wxFog: "Sisli", wxRain: "Yagmurlu", wxSnow: "Karli", wxShowers: "Saganak", wxStorm: "Firtina",
    team: "Takim", played: "O", gd: "AV",
    sports: { football: "Futbol", basketball: "Basketbol", motorsport: "Formula 1", tennis: "Tenis" } },
  en: { tagline: "All sports stats, on one screen.", email: "Email", password: "Password",
    login: "Log In", loggingIn: "Logging in...", noAccount: "No account?", signup: "Sign up",
    matches: "Matches", noMatches: "No matches in this category.", loading: "Loading...",
    live: "LIVE", info: "Info", grid: "Grid", tv: "Broadcast", comments: "Comments",
    referee: "Referee", stadium: "Stadium", city: "City", rank: "League Rank",
    last5: "Last 5 Matches", draw: "Draw", totalMatches: "meetings", h2hLoad: "Load H2H",
    writeComment: "Write a comment...", send: "Send", now: "now",
    profile: "Profile", back: "Back", member: "matchours member", pro: "PRO member",
    followedMatches: "Followed", commentsCount: "Comments", favLeague: "Favorite League", membership: "Member Since",
    favTeams: "Favorite Teams", recentActivity: "Recent Activity", logout: "Log Out",
    scorers: "Top Scorers", standing: "Standings", points: "pts", matchday: "Matchday", week: "Week", noStandings: "Standings not available.", noH2h: "No previous meetings.",
    fillFields: "Email and password required.", checkEmail: "Check your email to confirm.",
    finished: "Full Time",
    vsHome: "vs", vsAway: "@",
    squads: "Lineups", matchStats: "Stats", bench: "Bench", lineupSoon: "Lineup not announced yet.", noMatchStats: "Stats not available.", possession: "Possession", shots: "Shots", shotsOn: "Shots on", shotsOff: "Shots off", corners: "Corners", fouls: "Fouls", offsides: "Offsides", saves: "Saves", throwIns: "Throw-ins", freeKicks: "Free kicks", goalKicks: "Goal kicks", yellowCards: "Yellow cards", redCards: "Red cards",
    blockedShots: "Blocked", totalPasses: "Total Passes", accuratePasses: "Accurate Passes",
    substitutions: "Substitutions",
    h2hLabel: "H2H", pastMatches: "Past Matches", vsLabel: "vs",
    searchPlaceholder: "Search team or league...", noResults: "No results.", weather: "Weather", wxClear: "Clear", wxCloudy: "Cloudy", wxFog: "Fog", wxRain: "Rain", wxSnow: "Snow", wxShowers: "Showers", wxStorm: "Storm",
    team: "Team", played: "P", gd: "GD",
    sports: { football: "Football", basketball: "Basketball", motorsport: "Formula 1", tennis: "Tennis" } },
  de: { tagline: "Alle Sportstatistiken auf einem Bildschirm.", email: "E-Mail", password: "Passwort",
    login: "Anmelden", loggingIn: "Anmeldung...", noAccount: "Kein Konto?", signup: "Registrieren",
    matches: "Spiele", noMatches: "Keine Spiele in dieser Kategorie.", loading: "Laden...",
    live: "LIVE", info: "Info", grid: "Grid", tv: "Ubertragung", comments: "Kommentare",
    referee: "Schiedsrichter", stadium: "Stadion", city: "Stadt", rank: "Tabellenplatz",
    last5: "Letzte 5 Spiele", draw: "Unentschieden", totalMatches: "Begegnungen", h2hLoad: "H2H laden",
    writeComment: "Kommentar schreiben...", send: "Senden", now: "jetzt",
    profile: "Profil", back: "Zuruck", member: "matchours Mitglied", pro: "PRO Mitglied",
    followedMatches: "Verfolgt", commentsCount: "Kommentare", favLeague: "Lieblingsliga", membership: "Mitglied seit",
    favTeams: "Lieblingsteams", recentActivity: "Letzte Aktivitat", logout: "Abmelden",
    scorers: "Torjager", standing: "Tabelle", points: "Pkt", matchday: "Spieltag", week: "Spieltag", noStandings: "Tabelle nicht verfugbar.", noH2h: "Keine fruheren Begegnungen.",
    fillFields: "E-Mail und Passwort erforderlich.", checkEmail: "Bestatige deine E-Mail.",
    finished: "Endstand",
    vsHome: "vs", vsAway: "@",
    squads: "Aufstellung", matchStats: "Statistik", bench: "Bank", lineupSoon: "Aufstellung noch nicht bekannt.", noMatchStats: "Statistik nicht verfugbar.", possession: "Ballbesitz", shots: "Schusse", shotsOn: "Aufs Tor", shotsOff: "Daneben", corners: "Ecken", fouls: "Fouls", offsides: "Abseits", saves: "Paraden", throwIns: "Einwurfe", freeKicks: "Freistosse", goalKicks: "Abstosse", yellowCards: "Gelbe Karten", redCards: "Rote Karten",
    blockedShots: "Geblockt", totalPasses: "Passe gesamt", accuratePasses: "Genaue Passe",
    substitutions: "Wechsel",
    h2hLabel: "Eins gegen Eins", pastMatches: "Fruhere Spiele", vsLabel: "vs",
    searchPlaceholder: "Team oder Liga suchen...", noResults: "Keine Ergebnisse.", weather: "Wetter", wxClear: "Klar", wxCloudy: "Bewolkt", wxFog: "Nebel", wxRain: "Regen", wxSnow: "Schnee", wxShowers: "Schauer", wxStorm: "Sturm",
    team: "Team", played: "Sp", gd: "TD",
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

// Animated stat bar: fills from center outward (left half + right half) on mount.
// Fades + slides its child in, with a delay — used to stagger info rows like a staircase.
function CascadeItem({ index, children }) {
  var [show, setShow] = useState(false);
  useEffect(function(){
    var id = setTimeout(function(){ setShow(true); }, 60 + (index || 0) * 85);
    return function(){ clearTimeout(id); };
  }, []);
  return <div style={{ opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(10px)",
    transition: "opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)" }}>
    {children}</div>;
}

function StatBar({ leftPct, rightPct, delay, leftColor, rightColor }) {
  var [grow, setGrow] = useState(false);
  var lc = leftColor || COLORS.accent;
  var rc = rightColor || COLORS.red;
  useEffect(function(){
    var id = setTimeout(function(){ setGrow(true); }, (delay || 0) + 40);
    return function(){ clearTimeout(id); };
  }, []);
  var ease = "width 0.7s cubic-bezier(0.22,1,0.36,1)";
  return <div style={{ height: 6, borderRadius: 4, background: COLORS.cardAlt, overflow: "hidden",
    display: "flex", justifyContent: "center" }}>
    <div style={{ width: "50%", display: "flex", justifyContent: "flex-end", overflow: "hidden" }}>
      <div style={{ width: grow ? leftPct + "%" : "0%", height: "100%", background: lc,
        borderTopLeftRadius: 4, borderBottomLeftRadius: 4, transition: ease }} />
    </div>
    <div style={{ width: "50%", display: "flex", justifyContent: "flex-start", overflow: "hidden" }}>
      <div style={{ width: grow ? rightPct + "%" : "0%", height: "100%", background: rc,
        borderTopRightRadius: 4, borderBottomRightRadius: 4, transition: ease }} />
    </div>
  </div>;
}

// Renders a team's starting XI on a football pitch using API grid "row:col".
// subbedOutIds: Set of player ids who were substituted off (red arrow).
function Jersey({ number, color, out }) {
  var fill = color || "#ffffff";
  var hex = fill.replace("#", "");
  var r = parseInt(hex.substring(0,2),16); var g = parseInt(hex.substring(2,4),16); var b = parseInt(hex.substring(4,6),16);
  if (isNaN(r)) { r = 255; g = 255; b = 255; }
  var lum = (0.299*r + 0.587*g + 0.114*b);
  var txt = lum > 150 ? "#15543f" : "#ffffff";
  return <div style={{ position: "relative", width: 44, height: 42 }}>
    <svg viewBox="0 0 40 38" width="44" height="42" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}>
      <path d="M14 2 L26 2 L38 9 L33 16 L29 13 L29 36 L11 36 L11 13 L7 16 L2 9 Z"
        fill={fill} stroke="rgba(0,0,0,0.18)" strokeWidth="1" strokeLinejoin="round" />
    </svg>
    <span style={{ position: "absolute", left: 0, right: 0, top: 11, display: "flex", alignItems: "center", justifyContent: "center",
      color: txt, fontSize: 15, fontWeight: 800 }}>{number != null ? number : ""}</span>
    {out && <span style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%",
      background: COLORS.red, display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7h10M13 3l4 4-4 4" /><path d="M17 17H7M11 21l-4-4 4-4" /></svg>
    </span>}
  </div>;
}

function Pitch({ lineup, subbedOut, flip, label, color }) {
  var starting = lineup.starting || [];
  var rows = {};
  var hasGrid = false;
  starting.forEach(function (p) {
    if (p.grid) {
      hasGrid = true;
      var parts = p.grid.split(":");
      var r = parseInt(parts[0], 10);
      if (!rows[r]) rows[r] = [];
      rows[r].push({ p: p, col: parseInt(parts[1], 10) });
    }
  });

  if (!hasGrid) {
    return <div>
      <div style={{ color: COLORS.accent, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{label}{lineup.formation ? "  ·  " + lineup.formation : ""}</div>
      {starting.map(function(p, i){
        var out = subbedOut && subbedOut[p.id];
        return <div key={i} style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 500, padding: "5px 0",
          borderBottom: "1px solid " + COLORS.border, display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: COLORS.textMuted, fontSize: 11, width: 18, textAlign: "right" }}>{p.shirt != null ? p.shirt : (i+1)}</span>
          <span style={{ flex: 1 }}>{p.name}</span>
          {out && <span style={{ display: "inline-flex", width: 16, height: 16, borderRadius: "50%", background: COLORS.red,
            alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7h10M13 3l4 4-4 4" /><path d="M17 17H7M11 21l-4-4 4-4" /></svg></span>}
        </div>; })}
    </div>;
  }

  var rowNums = Object.keys(rows).map(Number).sort(function(a,b){ return a-b; });

  return <div style={{ minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6 }}>
      <span style={{ color: COLORS.accent, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{label}</span>
      {lineup.formation && <span style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{lineup.formation}</span>}
    </div>
    <div style={{ position: "relative", width: "100%", aspectRatio: "68 / 100",
      background: "repeating-linear-gradient(180deg, #2fa56e 0px, #2fa56e 10%, #36ad75 10%, #36ad75 20%)",
      borderRadius: 14, overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.3)", display: "flex", flexDirection: "column",
      padding: "10px 2px", boxShadow: "inset 0 0 26px rgba(0,0,0,0.14)" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "rgba(255,255,255,0.45)" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 46, height: 46, marginLeft: -23, marginTop: -23,
        border: "2px solid rgba(255,255,255,0.45)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", left: "50%", top: 0, width: 66, height: 24, marginLeft: -33,
        border: "2px solid rgba(255,255,255,0.45)", borderTop: "none", borderTopLeftRadius: 0 }} />
      <div style={{ position: "absolute", left: "50%", bottom: 0, width: 66, height: 24, marginLeft: -33,
        border: "2px solid rgba(255,255,255,0.45)", borderBottom: "none" }} />

      {(flip ? rowNums.slice().reverse() : rowNums).map(function(rn){
        var line = rows[rn].slice().sort(function(a,b){ return a.col - b.col; });
        if (flip) line.reverse();
        return <div key={rn} style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center",
          position: "relative", zIndex: 1 }}>
          {line.map(function(cell, i){
            var p = cell.p;
            var out = subbedOut && subbedOut[p.id];
            return <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 68 }}>
              <Jersey number={p.shirt} color={color} out={out} />
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 500, marginTop: 3, textAlign: "center",
                textShadow: "0 1px 3px rgba(0,0,0,0.65)", lineHeight: 1.1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 72 }}>
                {p.name.split(" ").slice(-1)[0]}</span>
            </div>; })}
        </div>; })}
    </div>
  </div>;
}

// WMO weather code -> localized short label
function wxLabel(code, t) {
  if (code == null) return "";
  if (code === 0) return t.wxClear;
  if (code <= 3) return t.wxCloudy;
  if (code === 45 || code === 48) return t.wxFog;
  if (code >= 51 && code <= 67) return t.wxRain;
  if (code >= 71 && code <= 77) return t.wxSnow;
  if (code >= 80 && code <= 82) return t.wxShowers;
  if (code >= 95) return t.wxStorm;
  return t.wxCloudy;
}

function MatchDetail({ match, isF1, t }) {
  var s = match.stats;
  var [tab, setTab] = useState("info");
  var [h2h, setH2h] = useState(s.h2h);
  var [h2hList, setH2hList] = useState([]);
  var [h2hLoading, setH2hLoading] = useState(false);
  var [standings, setStandings] = useState(null); // { home:{form,rank,points}, away:{...} }
  var [stLoading, setStLoading] = useState(false);
  var [scorers, setScorers] = useState(null);
  var [scLoading, setScLoading] = useState(false);
  var [recent, setRecent] = useState(null);
  var [rcLoading, setRcLoading] = useState(false);
  var [detail, setDetail] = useState(null); // { lineups, stats }
  var [dtLoading, setDtLoading] = useState(false);
  var [weather, setWeather] = useState(null);

  // lazy: standings groups for the info tab
  useEffect(function(){
    if (tab !== "info" || standings || isF1 || !match.leagueId) return;
    setStLoading(true);
    fetch("/api/football?mode=standings&league=" + match.leagueId + "&season=" + (match.season || 2025))
      .then(function(r){ return r.json(); })
      .then(function(j){ setStandings((j.standings && j.standings.groups) ? j.standings.groups : []); })
      .catch(function(){ setStandings([]); })
      .finally(function(){ setStLoading(false); });
  }, [tab]);

  // lazy: H2H
  useEffect(function(){
    if (tab !== "h2h" || h2h.total > 0 || !match.homeId || !match.awayId) return;
    setH2hLoading(true);
    fetch("/api/football?mode=h2h&home=" + match.homeId + "&away=" + match.awayId)
      .then(function(r){ return r.json(); })
      .then(function(j){ if (j.h2h) setH2h(j.h2h); if (j.list) setH2hList(j.list); }).catch(function(){})
      .finally(function(){ setH2hLoading(false); });
  }, [tab]);

  // lazy: scorers
  useEffect(function(){
    if (tab !== "scorers" || scorers || !match.leagueId) return;
    setScLoading(true);
    fetch("/api/football?mode=scorers&league=" + match.leagueId + "&season=" + (match.season || 2025))
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

  // lazy: match detail (lineups + statistics) for squads/stats tabs
  useEffect(function(){
    if ((tab !== "squads" && tab !== "matchstats") || detail || isF1 || !match.id) return;
    setDtLoading(true);
    fetch("/api/football?mode=detail&match=" + match.id)
      .then(function(r){ return r.json(); })
      .then(function(j){ setDetail(j.detail || { lineups: null, stats: null, subs: [] }); })
      .catch(function(){ setDetail({ lineups: null, stats: null, subs: [] }); })
      .finally(function(){ setDtLoading(false); });
  }, [tab]);

  // lazy: weather for the venue city (info tab)
  useEffect(function(){
    if (tab !== "info" || weather !== null || isF1) return;
    var city = s.city;
    if (!city || city === "—") { setWeather({ none: true }); return; }
    fetch("/api/football?mode=weather&city=" + encodeURIComponent(city))
      .then(function(r){ return r.json(); })
      .then(function(j){ setWeather(j.weather || { none: true }); })
      .catch(function(){ setWeather({ none: true }); });
  }, [tab]);

  // groups (array) that contain either team; usually one shared group
  var stGroups = Array.isArray(standings) ? standings : [];
  var myGroups = stGroups.filter(function(gr){
    return gr.rows && gr.rows.some(function(rw){ return rw.teamId === match.homeId || rw.teamId === match.awayId; });
  });
  if (myGroups.length === 0 && stGroups.length === 1) myGroups = stGroups; // single-table leagues

  var tabs = [{ id: "info", label: t.info }];
  if (isF1 && s.homeSquad.length > 0) tabs.push({ id: "grid", label: t.grid });
  if (!isF1) tabs.push({ id: "squads", label: t.squads });
  if (!isF1) tabs.push({ id: "matchstats", label: t.matchStats });
  if (!isF1) tabs.push({ id: "h2h", label: t.h2hLabel });
  if (!isF1) tabs.push({ id: "scorers", label: t.scorers });
  if (s.channels.length > 0) tabs.push({ id: "tv", label: t.tv });
  tabs.push({ id: "comments", label: t.comments });

  return <div style={{ background: "transparent", padding: "14px 18px 18px",
    }}>
    <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto" }}>
      {tabs.map(function(tb){ var a = tab === tb.id;
        return <button key={tb.id} onClick={function(){ setTab(tb.id); }} style={{ flexShrink: 0, padding: "7px 14px",
          border: "none", borderRadius: 11, fontSize: 12, fontWeight: a ? 700 : 600, cursor: "pointer",
          background: a ? COLORS.accentDim : "transparent", color: a ? COLORS.accent : COLORS.textSecondary,
          transition: "all 0.2s", fontFamily: FONT }}>{tb.label}</button>; })}
    </div>

    {tab === "info" && <div>
      <CascadeItem index={0}><StatRow label={t.referee} value={s.referee} /></CascadeItem>
      <CascadeItem index={1}><StatRow label={t.stadium} value={s.stadium} /></CascadeItem>
      <CascadeItem index={2}><StatRow label={t.city} value={s.city} /></CascadeItem>
      {weather && !weather.none && weather.temp != null && <CascadeItem index={3}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid " + COLORS.border }}>
          <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{t.weather}</span>
          <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>
            {weather.temp}°C · {wxLabel(weather.code, t)}</span>
        </div>
      </CascadeItem>}
      {match.matchday && <CascadeItem index={4}><StatRow label={t.matchday} value={match.matchday + ". " + t.week} /></CascadeItem>}

      {!isF1 && <div style={{ marginTop: 16 }}>
        {stLoading && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "10px 0" }}>{t.loading}</div>}

        {myGroups.length > 0 && <CascadeItem index={4}><div style={{ marginBottom: 16 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10, fontWeight: 700 }}>{t.standing}</div>
          {myGroups.map(function(gr, gi){
            return <div key={gi} style={{ marginBottom: 12, background: COLORS.card, borderRadius: 12,
              border: "1px solid " + COLORS.border, overflow: "hidden" }}>
              {gr.name && <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: COLORS.textSecondary,
                background: COLORS.cardAlt, borderBottom: "1px solid " + COLORS.border }}>{gr.name}</div>}
              <div style={{ display: "flex", padding: "6px 12px", fontSize: 10, color: COLORS.textMuted, fontWeight: 700,
                borderBottom: "1px solid " + COLORS.border }}>
                <span style={{ width: 20 }}>#</span>
                <span style={{ flex: 1 }}>{t.team}</span>
                <span style={{ width: 24, textAlign: "center" }}>{t.played}</span>
                <span style={{ width: 28, textAlign: "center" }}>{t.gd}</span>
                <span style={{ width: 26, textAlign: "center" }}>{t.points}</span>
              </div>
              {gr.rows.map(function(rw, ri){
                var mine = rw.teamId === match.homeId || rw.teamId === match.awayId;
                return <div key={ri} style={{ display: "flex", alignItems: "center", padding: "7px 12px", fontSize: 12,
                  background: mine ? COLORS.accentDim : "transparent",
                  borderBottom: ri < gr.rows.length - 1 ? "1px solid " + COLORS.border : "none" }}>
                  <span style={{ width: 20, color: COLORS.textMuted, fontWeight: 700 }}>{ri + 1}</span>
                  <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    {rw.logo && <img src={rw.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
                    <span style={{ color: COLORS.textPrimary, fontWeight: mine ? 700 : 500,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rw.team}</span>
                  </span>
                  <span style={{ width: 24, textAlign: "center", color: COLORS.textSecondary }}>{rw.played != null ? rw.played : "-"}</span>
                  <span style={{ width: 28, textAlign: "center", color: COLORS.textSecondary }}>{rw.gd != null ? (rw.gd > 0 ? "+" + rw.gd : rw.gd) : "-"}</span>
                  <span style={{ width: 26, textAlign: "center", color: COLORS.textPrimary, fontWeight: 800 }}>{rw.points != null ? rw.points : "-"}</span>
                </div>; })}
            </div>; })}
        </div></CascadeItem>}

        {(rcLoading || (recent && (recent.home.length > 0 || recent.away.length > 0))) && <CascadeItem index={5}><div>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10, fontWeight: 700 }}>{t.last5}</div>
          {rcLoading && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "8px 0" }}>{t.loading}</div>}
          {recent && [{ team: match.home, list: recent.home }, { team: match.away, list: recent.away }].map(function(blk, bi){
            if (!blk.list || blk.list.length === 0) return null;
            return <div key={bi} style={{ marginBottom: 12 }}>
              <div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{blk.team}</div>
              {blk.list.map(function(m, i){
                var c = m.result === "W" ? COLORS.accent : (m.result === "L" ? COLORS.red : COLORS.yellow);
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px",
                  marginBottom: 5, borderRadius: 10, border: "1px solid " + c + "55",
                  background: "linear-gradient(90deg, " + c + "B3 0%, " + c + "55 40%, " + c + "12 100%)" }}>
                  <span style={{ color: "#ffffff", fontSize: 12, flex: 1, fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                    {t.vsLabel} {m.opp}</span>
                  <span style={{ color: "#ffffff", fontSize: 13, fontWeight: 800, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>{m.score}</span>
                </div>; })}
            </div>; })}
        </div></CascadeItem>}
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
        {h2hList && h2hList.length > 0 && <div style={{ marginTop: 18 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.pastMatches}</div>
          {h2hList.map(function(m, i){
            return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px",
              marginBottom: 5, background: COLORS.card, borderRadius: 10, border: "1px solid " + COLORS.border }}>
              <span style={{ color: COLORS.textMuted, fontSize: 10, width: 64, flexShrink: 0 }}>{m.date}</span>
              <span style={{ color: COLORS.textPrimary, fontSize: 12, flex: 1, textAlign: "right",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.home}</span>
              <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 800, padding: "2px 8px",
                background: COLORS.accentDim, borderRadius: 7, flexShrink: 0 }}>{m.score}</span>
              <span style={{ color: COLORS.textPrimary, fontSize: 12, flex: 1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.away}</span>
            </div>; })}
        </div>}
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

    {tab === "squads" && <div>
      {dtLoading ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.loading}</div>
       : (!detail || !detail.lineups || (detail.lineups.home.starting.length === 0 && detail.lineups.away.starting.length === 0))
         ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.lineupSoon}</div>
       : (function(){
          var subs = detail.subs || [];
          function outMap(teamId){ var m = {}; subs.forEach(function(s){ if (s.teamId === teamId && s.outId != null) m[s.outId] = true; }); return m; }
          function teamSubs(teamId){ return subs.filter(function(s){ return s.teamId === teamId; }); }
          var homeTeamId = detail.lineups.home.teamId;
          var awayTeamId = detail.lineups.away.teamId;
          // jersey colors: team color, default white if missing
          var cols = detail.colors || {};
          var homeJersey = cols.home || "#ffffff";
          var awayJersey = cols.away || "#ffffff";

          return <div>
            <CascadeItem index={0}><div className="mo-pitches" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "start" }}>
              <Pitch lineup={detail.lineups.home} subbedOut={outMap(homeTeamId)} flip={false} label={match.home} color={homeJersey} />
              <Pitch lineup={detail.lineups.away} subbedOut={outMap(awayTeamId)} flip={true} label={match.away} color={awayJersey} />
            </div></CascadeItem>

            {/* substitutions + bench */}
            <CascadeItem index={1}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
              {[{ name: match.home, lu: detail.lineups.home, sb: teamSubs(homeTeamId) },
                { name: match.away, lu: detail.lineups.away, sb: teamSubs(awayTeamId) }].map(function(blk, bi){
                return <div key={bi}>
                  {blk.sb.length > 0 && <div style={{ marginBottom: 12 }}>
                    <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>{t.substitutions}</div>
                    {blk.sb.map(function(s, i){
                      return <div key={i} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid " + COLORS.border }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ color: COLORS.accent, fontSize: 11 }}>↑</span>
                          <span style={{ color: COLORS.textPrimary, flex: 1 }}>{s.inName}</span>
                          {s.minute != null && <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{s.minute}'</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ color: COLORS.red, fontSize: 11 }}>↓</span>
                          <span style={{ color: COLORS.textSecondary, flex: 1 }}>{s.outName}</span>
                        </div>
                      </div>; })}
                  </div>}
                  {blk.lu.bench && blk.lu.bench.length > 0 && <div>
                    <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>{t.bench}</div>
                    {blk.lu.bench.map(function(p, i){
                      return <div key={i} style={{ color: COLORS.textSecondary, fontSize: 11, padding: "3px 0", display: "flex", gap: 7 }}>
                        <span style={{ color: COLORS.textMuted, fontSize: 10, width: 18, textAlign: "right" }}>{p.shirt != null ? p.shirt : ""}</span>
                        {p.name}</div>; })}
                  </div>}
                </div>; })}
            </div></CascadeItem>
          </div>;
        })()}
    </div>}

    {tab === "matchstats" && <div>
      {dtLoading ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.loading}</div>
       : (!detail || !detail.stats || (!detail.stats.home && !detail.stats.away))
         ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noMatchStats}</div>
       : (function(){
          var labels = [
            ["Ball Possession", t.possession],
            ["Total Shots", t.shots],
            ["Shots on Goal", t.shotsOn],
            ["Shots off Goal", t.shotsOff],
            ["Blocked Shots", t.blockedShots],
            ["Corner Kicks", t.corners],
            ["Fouls", t.fouls],
            ["Offsides", t.offsides],
            ["Goalkeeper Saves", t.saves],
            ["Total passes", t.totalPasses],
            ["Passes accurate", t.accuratePasses],
            ["Yellow Cards", t.yellowCards],
            ["Red Cards", t.redCards],
          ];
          var h = detail.stats.home || {};
          var a = detail.stats.away || {};
          // ── color resolution ──
          // white/missing -> site green; if both end up same/too close -> opponent becomes red
          var cc = detail.colors || {};
          function rgb(hex){ var x=(hex||"").replace("#",""); return [parseInt(x.substring(0,2),16), parseInt(x.substring(2,4),16), parseInt(x.substring(4,6),16)]; }
          function isWhitish(hex){ if(!hex) return true; var c=rgb(hex); if(isNaN(c[0])) return true; return (0.299*c[0]+0.587*c[1]+0.114*c[2]) > 225; }
          function dist(h1,h2){ var a1=rgb(h1), b1=rgb(h2); if(isNaN(a1[0])||isNaN(b1[0])) return 999; return Math.sqrt(Math.pow(a1[0]-b1[0],2)+Math.pow(a1[1]-b1[1],2)+Math.pow(a1[2]-b1[2],2)); }
          var leftColor = isWhitish(cc.home) ? COLORS.accent : cc.home;
          var rightColor = isWhitish(cc.away) ? COLORS.accent : cc.away;
          if (dist(leftColor, rightColor) < 60) {  // too similar (e.g. both green) -> opponent red
            rightColor = COLORS.red;
            if (dist(leftColor, rightColor) < 60) leftColor = COLORS.accent;
          }
          function num(v){ if (v == null) return 0; if (typeof v === "number") return v; var n = parseFloat(String(v).replace("%","")); return isNaN(n) ? 0 : n; }
          function disp(v){ return v == null ? "0" : String(v); }
          var rows = labels.filter(function(l){ return h[l[0]] != null || a[l[0]] != null; });
          if (rows.length === 0) return <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noMatchStats}</div>;
          return <div>
            {rows.map(function(l, i){
              var hv = num(h[l[0]]); var av = num(a[l[0]]);
              var tot = (hv + av) || 1;
              return <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{disp(h[l[0]])}</span>
                  <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>{l[1]}</span>
                  <span style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{disp(a[l[0]])}</span>
                </div>
                <StatBar leftPct={hv/tot*100} rightPct={av/tot*100} delay={i*60} leftColor={leftColor} rightColor={rightColor} />
              </div>; })}
          </div>;
        })()}
    </div>}

    {tab === "comments" && <CommentSection comments={s.comments} t={t} />}
  </div>;
}

function MatchCard({ match, isF1, onOpen, t }) {
  var isLive = match.status === "live";
  var showScore = match.score && (isLive || match.status === "finished");
  var [hover, setHover] = useState(false);

  var border = hover ? COLORS.accent + "44" : (isLive ? COLORS.accent + "55" : COLORS.border);
  var bg = hover ? "rgba(15,184,148,0.04)" : COLORS.card;

  return <div style={{ background: COLORS.card, borderRadius: 24, overflow: "hidden", marginBottom: 12,
    WebkitTransform: "translateZ(0)", transform: "translateZ(0)",
    border: "1px solid " + border, boxShadow: "0 2px 14px rgba(20,40,40,0.05)",
    transition: "border-color 0.4s ease, box-shadow 0.4s ease" }}>
    <div onClick={onOpen}
      onMouseEnter={function(){ setHover(true); }} onMouseLeave={function(){ setHover(false); }}
      style={{ padding: "20px 22px", cursor: "pointer", display: "flex",
      alignItems: "center", justifyContent: "space-between", WebkitTapHighlightColor: "transparent",
      background: bg, transition: "background 0.45s cubic-bezier(0.22,1,0.36,1)" }}>
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
      <div style={{ marginLeft: 14, color: hover ? COLORS.accent : COLORS.textMuted, fontSize: 18, fontWeight: 700,
        transition: "color 0.3s ease" }}>›</div>
    </div>
  </div>;
}

// Full-screen modal popup (in-page overlay, not a route). Smooth open/close.
function MatchModal({ match, isF1, t, onClose }) {
  var [visible, setVisible] = useState(false);

  useEffect(function(){
    // trigger enter transition on next frame
    var r = requestAnimationFrame(function(){ setVisible(true); });
    // lock background scroll
    var prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e){ if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    return function(){
      cancelAnimationFrame(r);
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 360); // wait for exit animation
  }

  var isLive = match.status === "live";
  var showScore = match.score && (isLive || match.status === "finished");

  return <div onClick={handleClose} style={{ position: "fixed", inset: 0, zIndex: 100,
    display: "flex", justifyContent: "center", alignItems: "flex-start",
    background: visible ? "rgba(20,35,35,0.45)" : "rgba(20,35,35,0)",
    backdropFilter: visible ? "blur(4px)" : "blur(0px)", WebkitBackdropFilter: visible ? "blur(4px)" : "blur(0px)",
    transition: "background 0.4s ease, backdrop-filter 0.4s ease, -webkit-backdrop-filter 0.4s ease",
    padding: "max(0px, env(safe-area-inset-top)) 0 0" }}>
    <div onClick={function(e){ e.stopPropagation(); }} className="mo-scroll" style={{
      width: "100%", maxWidth: 720, height: "100%", overflowY: "auto", overflowX: "hidden",
      WebkitOverflowScrolling: "touch",
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      // glassy translucent surface
      background: "linear-gradient(180deg, rgba(255,255,255,0.82), rgba(238,242,242,0.92))",
      backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
      border: "1px solid rgba(255,255,255,0.6)",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0) scale(1)" : "translateY(28px) scale(0.985)",
      transition: "opacity 0.4s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)",
      boxShadow: "0 -8px 40px rgba(20,40,40,0.18)" }}>

      {/* modal header: teams + score + close */}
      <div className="mo-sticky" style={{ zIndex: 5, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        background: "linear-gradient(180deg, rgba(15,184,148,0.16), rgba(15,184,148,0.06))",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)", borderBottom: "1px solid rgba(15,184,148,0.18)",
        padding: "max(16px, env(safe-area-inset-top)) 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary }}>
            {match.league}{isLive ? "" : (match.date ? "  ·  " + match.date : "")}
            {isLive && <span style={{ color: COLORS.red, marginLeft: 8 }}>● {t.live}{match.minute ? " " + match.minute + "'" : ""}</span>}
          </span>
          <button onClick={handleClose} aria-label="close" style={{ width: 36, height: 36, borderRadius: 12,
            border: "1px solid rgba(15,184,148,0.25)", background: "rgba(255,255,255,0.6)", cursor: "pointer", color: COLORS.textPrimary,
            fontSize: 18, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            WebkitTapHighlightColor: "transparent" }}>×</button>
        </div>
        {isF1 ? <div style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: 800 }}>{match.home}</div>
        : <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <TeamLogo src={match.homeLogo} name={match.home} size={42} />
              <span className="mo-team-name" style={{ color: COLORS.textPrimary, fontWeight: 800,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{match.home}</span></div>
            <div style={{ minWidth: 66, textAlign: "center", padding: "7px 12px", borderRadius: 14, flexShrink: 0,
              background: showScore ? COLORS.accentDim : COLORS.cardAlt }}>
              {showScore ? <span style={{ color: COLORS.accent, fontSize: 22, fontWeight: 800 }}>{match.score}</span>
               : <span style={{ color: COLORS.textSecondary, fontSize: 15, fontWeight: 700 }}>{match.time}</span>}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 11, justifyContent: "flex-end", minWidth: 0 }}>
              <span className="mo-team-name" style={{ color: COLORS.textPrimary, fontWeight: 800, textAlign: "right",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{match.away}</span>
              <TeamLogo src={match.awayLogo} name={match.away} size={42} /></div>
          </div>}
      </div>

      <div style={{ padding: "0 0 max(40px, env(safe-area-inset-bottom))" }}>
        <MatchDetail match={match} isF1={isF1} t={t} />
      </div>
    </div>
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
    {ok && <img src="/logo.png" alt="matchours" onError={function(){ setOk(false); }}
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
    <div style={{ maxWidth: 560, margin: "0 auto", width: "100%",
      paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <div className="mo-sticky" style={{ padding: "max(20px, env(safe-area-inset-top)) 20px 16px", zIndex: 10, background: COLORS.bg,
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
  var [selectedMatch, setSelectedMatch] = useState(null);
  var [query, setQuery] = useState("");
  var [searchFocus, setSearchFocus] = useState(false);
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
    <style>{"@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}" +
      "@keyframes rippleFill{0%{transform:scale(0);opacity:0.18}60%{opacity:0.12}100%{transform:scale(1);opacity:0}}" +
      "*{box-sizing:border-box}::-webkit-scrollbar{display:none}html,body{margin:0;-webkit-text-size-adjust:100%}" +
      // iOS safe areas (notch) + smooth momentum scroll
      ".mo-shell{padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}" +
      ".mo-scroll{-webkit-overflow-scrolling:touch}" +
      // sticky header needs a paint layer in Safari or it jitters
      ".mo-sticky{position:-webkit-sticky;position:sticky;top:0;-webkit-transform:translateZ(0);transform:translateZ(0)}" +
      // responsive container: phone 1 col, tablet wider, desktop 2-col grid
      ".mo-container{max-width:560px;margin:0 auto;width:100%}" +
      ".mo-team-name{font-size:15px}" +
      "@media(min-width:600px){.mo-team-name{font-size:19px}}" +
      ".mo-grid{display:block}" +
      ".mo-header-inner{max-width:560px;margin:0 auto;width:100%}" +
      "@media(min-width:900px){" +
        ".mo-container{max-width:1100px;padding-left:24px;padding-right:24px}" +
        ".mo-header-inner{max-width:1100px;padding-left:24px;padding-right:24px}" +
        ".mo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;align-items:start}" +
      "}" +
      "@media(min-width:1300px){" +
        ".mo-container{max-width:1280px}.mo-header-inner{max-width:1280px}" +
        ".mo-grid{grid-template-columns:repeat(3,1fr)}" +
      "}"}</style>

    <div className="mo-shell">
      <div className="mo-sticky" style={{ zIndex: 10, background: COLORS.bg, borderBottom: "1px solid " + COLORS.border,
        paddingTop: "max(20px, env(safe-area-inset-top))" }}>
        <div className="mo-header-inner" style={{ padding: "0 20px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Logo />
            <button onClick={function(){ setShowProfile(true); }} aria-label="profile" style={{ width: 38, height: 38, borderRadius: 13,
              background: COLORS.card, border: "1px solid " + COLORS.border, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke={COLORS.textPrimary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>
            </button>
            </div>
          {/* search bar */}
          <div style={{ position: "relative", marginBottom: 14,
            transform: searchFocus ? "scale(1.0)" : "scale(1.0)" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={searchFocus ? COLORS.accent : COLORS.textMuted}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.3s ease" }}>
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            </span>
            <input value={query} onChange={function(e){ setQuery(e.target.value); }}
              onFocus={function(){ setSearchFocus(true); }} onBlur={function(){ setSearchFocus(false); }}
              placeholder={t.searchPlaceholder}
              style={{ width: "100%", padding: "11px 14px 11px 40px", borderRadius: 14, fontSize: 14, outline: "none",
                fontFamily: FONT, color: COLORS.textPrimary, boxSizing: "border-box",
                background: searchFocus ? COLORS.card : COLORS.cardAlt,
                border: "1px solid " + (searchFocus ? COLORS.accent + "66" : COLORS.border),
                boxShadow: searchFocus ? "0 4px 16px rgba(15,184,148,0.10)" : "none",
                transition: "background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease" }} />
            {query && <button onClick={function(){ setQuery(""); }} aria-label="clear" style={{ position: "absolute", right: 10,
              top: "50%", transform: "translateY(-50%)", width: 24, height: 24, borderRadius: 8, border: "none",
              background: COLORS.cardAlt, color: COLORS.textSecondary, cursor: "pointer", fontSize: 14, lineHeight: 1,
              WebkitTapHighlightColor: "transparent" }}>×</button>}
          </div>
          <div className="mo-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {SPORT_TABS.map(function(sp){ var a = activeSport === sp.id;
              return <div key={sp.id} style={{ flexShrink: 0 }}>
                <SportButton active={a} onClick={function(){ setActiveSport(sp.id); }}>{t.sports[sp.id]}</SportButton></div>; })}
          </div>
        </div>
      </div>

      <div className="mo-container" style={{ padding: "16px 16px max(80px, env(safe-area-inset-bottom))" }}>
        {loading ? <div style={{ textAlign: "center", padding: "70px 20px", color: COLORS.textSecondary, fontSize: 14 }}>{t.loading}</div>
         : (function(){
            var q = query.trim().toLowerCase();
            var shown = q ? matches.filter(function(m){
              return (m.home && m.home.toLowerCase().indexOf(q) >= 0) ||
                     (m.away && m.away.toLowerCase().indexOf(q) >= 0) ||
                     (m.league && m.league.toLowerCase().indexOf(q) >= 0);
            }) : matches;
            if (shown.length === 0) return <div style={{ textAlign: "center", padding: "70px 20px", color: COLORS.textSecondary, fontSize: 14 }}>{q ? t.noResults : t.noMatches}</div>;
            return <><div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: "0.6px",
              textTransform: "uppercase", marginBottom: 12, paddingLeft: 2 }}>{shown.length} {t.matches}</div>
              <div className="mo-grid">
              {shown.map(function(m){ return <MatchCard key={m.id} match={m} isF1={activeSport === "motorsport"}
                t={t} onOpen={function(){ setSelectedMatch(m); }} />; })}
              </div>
             </>;
          })()}
      </div></div>

    {selectedMatch && <MatchModal match={selectedMatch} isF1={activeSport === "motorsport"} t={t}
      onClose={function(){ setSelectedMatch(null); }} />}
  </div>;
}