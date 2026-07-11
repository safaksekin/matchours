// Popularity + Turkish-alias layer for search. The API-Sports team/player search ranks by internal
// order (so "mil" surfaces Millwall before AC Milan) and only knows English names ("arjantin" → 0)
// and needs ≥3 chars ("ju" → 0). This list lets us (a) expand a query to the English/canonical term,
// (b) support 2-char + Turkish queries, and (c) re-rank API results so famous clubs/players win.
// `en` = the term we search the API with (matches API naming); `a` = aliases incl. Turkish; `pop` 0-100.

export const POP_TEAMS = [
  // ── Elite clubs ──
  { en: "Real Madrid", pop: 100, a: ["real madrid", "real"] },
  { en: "Barcelona", pop: 100, a: ["barcelona", "barca", "barsa", "fc barcelona"] },
  { en: "Manchester United", pop: 99, a: ["manchester united", "man united", "man utd", "manu", "united"] },
  { en: "Manchester City", pop: 99, a: ["manchester city", "man city", "city"] },
  { en: "Liverpool", pop: 98, a: ["liverpool"] },
  { en: "Bayern München", pop: 98, a: ["bayern", "bayern munih", "bayern munchen", "munih", "münih"] },
  { en: "Paris Saint Germain", pop: 98, a: ["psg", "paris", "paris saint germain"] },
  { en: "Juventus", pop: 97, a: ["juventus", "juve"] },
  { en: "AC Milan", pop: 97, a: ["milan", "ac milan", "acmilan"] },
  { en: "Inter", pop: 96, a: ["inter", "internazionale", "inter milan"] },
  { en: "Arsenal", pop: 97, a: ["arsenal"] },
  { en: "Chelsea", pop: 97, a: ["chelsea"] },
  { en: "Tottenham", pop: 92, a: ["tottenham", "spurs", "hotspur"] },
  { en: "Borussia Dortmund", pop: 94, a: ["dortmund", "borussia dortmund", "bvb"] },
  { en: "Atletico Madrid", pop: 93, a: ["atletico", "atletico madrid", "atleti"] },
  { en: "Napoli", pop: 90, a: ["napoli"] },
  { en: "Newcastle", pop: 85, a: ["newcastle", "newcastle united"] },
  { en: "Roma", pop: 87, a: ["roma", "as roma"] },
  { en: "Lazio", pop: 82, a: ["lazio"] },

  // ── Türkiye ──
  { en: "Galatasaray", pop: 96, a: ["galatasaray", "gala", "gs", "cimbom"] },
  { en: "Fenerbahce", pop: 96, a: ["fenerbahce", "fener", "fb"] },
  { en: "Besiktas", pop: 93, a: ["besiktas", "bjk", "kartal"] },
  { en: "Trabzonspor", pop: 88, a: ["trabzonspor", "trabzon", "ts"] },
  { en: "Basaksehir", pop: 72, a: ["basaksehir", "istanbul basaksehir"] },
  { en: "Adana Demirspor", pop: 66, a: ["adana demirspor", "adana"] },
  { en: "Samsunspor", pop: 63, a: ["samsunspor", "samsun"] },

  // ── Other big clubs ──
  { en: "Ajax", pop: 85, a: ["ajax"] },
  { en: "PSV Eindhoven", pop: 78, a: ["psv", "psv eindhoven"] },
  { en: "Feyenoord", pop: 76, a: ["feyenoord"] },
  { en: "Benfica", pop: 84, a: ["benfica"] },
  { en: "FC Porto", pop: 84, a: ["porto", "fc porto"] },
  { en: "Sporting CP", pop: 82, a: ["sporting", "sporting cp", "sporting lisbon"] },
  { en: "Celtic", pop: 78, a: ["celtic"] },
  { en: "Rangers", pop: 76, a: ["rangers", "glasgow rangers"] },
  { en: "Marseille", pop: 80, a: ["marseille", "om"] },
  { en: "Olympique Lyonnais", pop: 78, a: ["lyon", "olympique lyonnais", "ol"] },
  { en: "Monaco", pop: 76, a: ["monaco", "as monaco"] },
  { en: "Sevilla", pop: 82, a: ["sevilla"] },
  { en: "Villarreal", pop: 78, a: ["villarreal"] },
  { en: "Valencia", pop: 80, a: ["valencia"] },
  { en: "Real Betis", pop: 78, a: ["betis", "real betis"] },
  { en: "Real Sociedad", pop: 78, a: ["real sociedad", "sociedad"] },
  { en: "Athletic Club", pop: 78, a: ["athletic", "athletic bilbao", "athletic club"] },
  { en: "Bayer Leverkusen", pop: 86, a: ["leverkusen", "bayer leverkusen", "bayer"] },
  { en: "RB Leipzig", pop: 82, a: ["leipzig", "rb leipzig"] },
  { en: "Aston Villa", pop: 82, a: ["aston villa", "villa"] },
  { en: "West Ham", pop: 78, a: ["west ham", "west ham united"] },
  { en: "Everton", pop: 76, a: ["everton"] },
  { en: "Al Nassr", pop: 90, a: ["al nassr", "alnassr", "al-nassr"] },
  { en: "Al Hilal", pop: 84, a: ["al hilal", "alhilal", "al-hilal"] },
  { en: "Inter Miami", pop: 86, a: ["inter miami", "miami"] },
  { en: "Boca Juniors", pop: 84, a: ["boca", "boca juniors"] },
  { en: "River Plate", pop: 84, a: ["river", "river plate"] },
  { en: "Flamengo", pop: 82, a: ["flamengo"] },
  { en: "Palmeiras", pop: 78, a: ["palmeiras"] },

  // ── National teams (Türkçe adlar) ──
  { en: "Turkey", pop: 92, a: ["turkiye", "turkey", "milli takim", "ay yildizlilar"], nat: true },
  { en: "Argentina", pop: 96, a: ["arjantin", "argentina"], nat: true },
  { en: "Brazil", pop: 96, a: ["brezilya", "brazil", "brasil"], nat: true },
  { en: "France", pop: 95, a: ["fransa", "france"], nat: true },
  { en: "Germany", pop: 95, a: ["almanya", "germany"], nat: true },
  { en: "Spain", pop: 95, a: ["ispanya", "spain", "espana"], nat: true },
  { en: "England", pop: 95, a: ["ingiltere", "england"], nat: true },
  { en: "Portugal", pop: 94, a: ["portekiz", "portugal"], nat: true },
  { en: "Netherlands", pop: 92, a: ["hollanda", "netherlands", "holland"], nat: true },
  { en: "Italy", pop: 93, a: ["italya", "italy", "italia"], nat: true },
  { en: "Belgium", pop: 86, a: ["belcika", "belgium"], nat: true },
  { en: "Croatia", pop: 85, a: ["hirvatistan", "croatia"], nat: true },
  { en: "Uruguay", pop: 84, a: ["uruguay"], nat: true },
  { en: "Morocco", pop: 84, a: ["fas", "morocco"], nat: true },
  { en: "USA", pop: 78, a: ["abd", "amerika", "usa", "united states"], nat: true },
  { en: "Mexico", pop: 80, a: ["meksika", "mexico"], nat: true },
  { en: "Japan", pop: 78, a: ["japonya", "japan"], nat: true },
  { en: "South Korea", pop: 76, a: ["guney kore", "south korea", "kore"], nat: true },
  { en: "Poland", pop: 78, a: ["polonya", "poland"], nat: true },
  { en: "Denmark", pop: 76, a: ["danimarka", "denmark"], nat: true },
  { en: "Sweden", pop: 74, a: ["isvec", "sweden"], nat: true },
  { en: "Switzerland", pop: 74, a: ["isvicre", "switzerland"], nat: true },
  { en: "Austria", pop: 72, a: ["avusturya", "austria"], nat: true },
  { en: "Serbia", pop: 76, a: ["sirbistan", "serbia"], nat: true },
  { en: "Greece", pop: 72, a: ["yunanistan", "greece"], nat: true },
  { en: "Senegal", pop: 76, a: ["senegal"], nat: true },
  { en: "Nigeria", pop: 76, a: ["nijerya", "nigeria"], nat: true },
  { en: "Egypt", pop: 76, a: ["misir", "egypt"], nat: true },
  { en: "Scotland", pop: 72, a: ["iskocya", "scotland"], nat: true },
  { en: "Wales", pop: 70, a: ["galler", "wales"], nat: true },
  { en: "Colombia", pop: 76, a: ["kolombiya", "colombia"], nat: true },
];

export const POP_PLAYERS = [
  { en: "Messi", pop: 100, a: ["messi", "lionel messi", "leo messi"] },
  { en: "Ronaldo", pop: 100, a: ["ronaldo", "cristiano", "cristiano ronaldo", "cr7"] },
  { en: "Haaland", pop: 97, a: ["haaland", "erling haaland"] },
  { en: "Mbappe", pop: 98, a: ["mbappe", "kylian mbappe", "kylian"] },
  { en: "Neymar", pop: 94, a: ["neymar"] },
  { en: "Yamal", pop: 93, a: ["yamal", "lamine", "lamine yamal"] },
  { en: "Bellingham", pop: 92, a: ["bellingham", "jude", "jude bellingham"] },
  { en: "Vinicius", pop: 92, a: ["vinicius", "vini", "vini jr", "vinicius junior"] },
  { en: "Salah", pop: 91, a: ["salah", "mohamed salah", "mo salah"] },
  { en: "Kane", pop: 90, a: ["kane", "harry kane"] },
  { en: "De Bruyne", pop: 89, a: ["de bruyne", "kevin de bruyne", "kdb"] },
  { en: "Musiala", pop: 87, a: ["musiala", "jamal musiala"] },
  { en: "Bruno Fernandes", pop: 84, a: ["bruno fernandes", "bruno"] },
  { en: "Saka", pop: 85, a: ["saka", "bukayo saka"] },
  { en: "Foden", pop: 85, a: ["foden", "phil foden"] },
  { en: "Rodri", pop: 85, a: ["rodri"] },
  { en: "Odegaard", pop: 82, a: ["odegaard", "martin odegaard"] },
  { en: "Lewandowski", pop: 88, a: ["lewandowski", "lewa", "robert lewandowski"] },
  { en: "Modric", pop: 86, a: ["modric", "luka modric"] },
  { en: "Kroos", pop: 82, a: ["kroos", "toni kroos"] },
  { en: "Griezmann", pop: 84, a: ["griezmann", "antoine griezmann"] },
  { en: "Rashford", pop: 82, a: ["rashford", "marcus rashford"] },
  { en: "Osimhen", pop: 82, a: ["osimhen", "victor osimhen"] },
  { en: "Kvaratskhelia", pop: 82, a: ["kvaratskhelia", "kvara", "khvicha"] },
  { en: "Leao", pop: 83, a: ["leao", "rafael leao"] },
  { en: "Lautaro", pop: 83, a: ["lautaro", "lautaro martinez"] },
  { en: "Barella", pop: 78, a: ["barella", "nicolo barella"] },
  { en: "Alvarez", pop: 82, a: ["alvarez", "julian alvarez", "julian"] },
  { en: "Wirtz", pop: 84, a: ["wirtz", "florian wirtz"] },
  { en: "Palmer", pop: 85, a: ["palmer", "cole palmer"] },
  { en: "Enzo Fernandez", pop: 80, a: ["enzo", "enzo fernandez"] },
  { en: "Mac Allister", pop: 80, a: ["mac allister", "alexis mac allister"] },
  { en: "Dembele", pop: 84, a: ["dembele", "ousmane dembele"] },
  { en: "Vlahovic", pop: 80, a: ["vlahovic", "dusan vlahovic"] },
  { en: "Gyokeres", pop: 84, a: ["gyokeres", "viktor gyokeres"] },
  { en: "Nkunku", pop: 76, a: ["nkunku"] },
  { en: "Son", pop: 84, a: ["son", "son heung min", "heung min son"] },
  { en: "Kobbie Mainoo", pop: 74, a: ["mainoo", "kobbie mainoo"] },
  { en: "Valverde", pop: 82, a: ["valverde", "federico valverde", "fede"] },
  { en: "Rodrygo", pop: 84, a: ["rodrygo"] },
  { en: "Camavinga", pop: 80, a: ["camavinga", "eduardo camavinga"] },
  { en: "Tchouameni", pop: 80, a: ["tchouameni", "aurelien tchouameni"] },

  // ── Türk oyuncular ──
  { en: "Guler", pop: 88, a: ["guler", "arda guler", "arda"] },
  { en: "Yildiz", pop: 84, a: ["yildiz", "kenan yildiz", "kenan"] },
  { en: "Calhanoglu", pop: 85, a: ["calhanoglu", "hakan calhanoglu", "hakan"] },
  { en: "Akturkoglu", pop: 74, a: ["akturkoglu", "kerem akturkoglu"] },
  { en: "Kokcu", pop: 74, a: ["kokcu", "orkun kokcu", "orkun"] },
  { en: "Guendogan", pop: 80, a: ["gundogan", "guendogan", "ilkay gundogan", "ilkay"] },
  { en: "Demiral", pop: 72, a: ["demiral", "merih demiral", "merih"] },
  { en: "Muldur", pop: 66, a: ["muldur", "zeki celik", "zeki muldur"] },
  { en: "Under", pop: 70, a: ["under", "cengiz under", "cengiz"] },
];

function norm(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Rank popular entities against a query (match quality, then popularity). Returns [{ e, m }].
export function popRank(list, q) {
  const nq = norm(q);
  if (!nq) return [];
  const out = [];
  for (const e of list) {
    const keys = [e.en].concat(e.a || []).map(norm).filter(Boolean);
    let m = 0;
    for (const k of keys) {
      if (k === nq) m = Math.max(m, 4);
      else if (k.startsWith(nq)) m = Math.max(m, 3);
      else if (nq.length >= 3 && k.indexOf(nq) !== -1) m = Math.max(m, 2);
    }
    if (m > 0) out.push({ e: e, m: m });
  }
  out.sort((a, b) => (b.m !== a.m ? b.m - a.m : (b.e.pop || 0) - (a.e.pop || 0)));
  return out;
}

// Popularity of a RESULT by its name — matched against the canonical `en` only (NOT the broad
// aliases, so a club literally named "Real" doesn't inherit Real Madrid's fame). Exact-name match
// first, then a whole-word match so a player's surname boosts ("Lamine Yamal" → en "Yamal"). 0 if unknown.
export function popOf(list, name, wordMatch) {
  const nn = norm(name);
  if (!nn) return 0;
  for (const e of list) { if (nn === norm(e.en)) return e.pop || 0; }
  // wordMatch: only for PLAYERS (surname), never teams — else "Arsenal Sarandi" inherits Arsenal's fame.
  if (wordMatch) {
    const words = nn.split(" ");
    for (const e of list) { const en = norm(e.en); if (en && words.indexOf(en) !== -1) return e.pop || 0; }
  }
  return 0;
}
