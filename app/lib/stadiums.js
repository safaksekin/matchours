// Stadium → coordinates table for the Football Passport map.
// Coordinates are approximate (2-4 dp) — plenty for a stylised, zoomed-out trophy map.
// `aliases` cover the sponsor/API name variants a logged `venue` string may arrive as.
// `wiki` is the English Wikipedia page title → the popup lazy-fetches its lead photo from the
// Wikimedia REST API (falls back to a stylised header if missing/404). `cap`/`team` power the popup.
// Only ATTENDED logs light a pin, so this map is a pure "being there" trophy layer.

export const STADIUMS = [
  // ── Türkiye ──
  { name: "Rams Park", city: "İstanbul", country: "Türkiye", flag: "🇹🇷", lat: 41.1036, lng: 28.9903, cap: 52223, team: "Galatasaray", wiki: "Rams Park", aliases: ["Türk Telekom", "Türk Telekom Arena", "Ali Sami Yen", "Galatasaray", "NEF Stadyumu"] },
  { name: "Ülker Stadyumu", city: "İstanbul", country: "Türkiye", flag: "🇹🇷", lat: 40.9877, lng: 29.0369, cap: 47834, team: "Fenerbahçe", wiki: "Şükrü Saracoğlu Stadium", wikiTr: "Şükrü Saracoğlu Stadyumu", aliases: ["Şükrü Saracoğlu", "Sukru Saracoglu", "Fenerbahçe", "Ülker Stadı"] },
  { name: "Tüpraş Stadyumu", city: "İstanbul", country: "Türkiye", flag: "🇹🇷", lat: 41.0392, lng: 29.0075, cap: 42590, team: "Beşiktaş", wiki: "Vodafone Park", aliases: ["Vodafone Park", "Vodafone Arena", "İnönü", "Beşiktaş", "Dolmabahçe"] },
  { name: "Atatürk Olimpiyat Stadyumu", city: "İstanbul", country: "Türkiye", flag: "🇹🇷", lat: 41.0745, lng: 28.7669, cap: 74753, team: "Milli Takım", wiki: "Atatürk Olympic Stadium", wikiTr: "Atatürk Olimpiyat Stadyumu", aliases: ["Atatürk Olympic"] },
  { name: "Papara Park", city: "Trabzon", country: "Türkiye", flag: "🇹🇷", lat: 41.0138, lng: 39.6969, cap: 40782, team: "Trabzonspor", wiki: "Papara Park", wikiTr: "Papara Park", aliases: ["Şenol Güneş", "Senol Gunes", "Medical Park", "Akyazı", "Trabzonspor"] },
  { name: "Timsah Arena", city: "Bursa", country: "Türkiye", flag: "🇹🇷", lat: 40.2298, lng: 29.0086, cap: 43877, team: "Bursaspor", wiki: "Timsah Arena", wikiTr: "Timsah Arena", aliases: ["Bursa Büyükşehir", "Bursaspor"] },
  { name: "Konya Büyükşehir Stadyumu", city: "Konya", country: "Türkiye", flag: "🇹🇷", lat: 37.9445, lng: 32.5478, cap: 42000, team: "Konyaspor", wiki: "Konya Metropolitan Municipality Stadium", wikiTr: "Konya Büyükşehir Stadyumu", aliases: ["Konya Metropolitan", "MKE", "Konyaspor"] },

  // ── England ──
  { name: "Anfield", city: "Liverpool", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 53.4308, lng: -2.9608, cap: 61276, team: "Liverpool", wiki: "Anfield", aliases: ["Liverpool FC"] },
  { name: "Old Trafford", city: "Manchester", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 53.4631, lng: -2.2913, cap: 74310, team: "Manchester United", wiki: "Old Trafford", aliases: ["Manchester United"] },
  { name: "Etihad Stadium", city: "Manchester", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 53.4831, lng: -2.2004, cap: 53400, team: "Manchester City", wiki: "City of Manchester Stadium", aliases: ["City of Manchester", "Manchester City"] },
  { name: "Emirates Stadium", city: "London", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 51.5549, lng: -0.1084, cap: 60704, team: "Arsenal", wiki: "Emirates Stadium", aliases: ["Arsenal"] },
  { name: "Stamford Bridge", city: "London", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 51.4817, lng: -0.1910, cap: 40343, team: "Chelsea", wiki: "Stamford Bridge (stadium)", aliases: ["Chelsea"] },
  { name: "Tottenham Hotspur Stadium", city: "London", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 51.6043, lng: -0.0665, cap: 62850, team: "Tottenham Hotspur", wiki: "Tottenham Hotspur Stadium", aliases: ["Spurs", "Tottenham"] },
  { name: "Wembley Stadium", city: "London", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", lat: 51.5560, lng: -0.2796, cap: 90000, team: "England", wiki: "Wembley Stadium", aliases: ["Wembley"] },

  // ── Spain ──
  { name: "Spotify Camp Nou", city: "Barcelona", country: "España", flag: "🇪🇸", lat: 41.3809, lng: 2.1228, cap: 99354, team: "Barcelona", wiki: "Camp Nou", aliases: ["Camp Nou", "Nou Camp", "Barcelona"] },
  { name: "Santiago Bernabéu", city: "Madrid", country: "España", flag: "🇪🇸", lat: 40.4531, lng: -3.6883, cap: 78297, team: "Real Madrid", wiki: "Santiago Bernabéu Stadium", aliases: ["Bernabeu", "Real Madrid"] },
  { name: "Riyadh Air Metropolitano", city: "Madrid", country: "España", flag: "🇪🇸", lat: 40.4362, lng: -3.5995, cap: 70460, team: "Atlético Madrid", wiki: "Metropolitano Stadium", aliases: ["Wanda Metropolitano", "Metropolitano", "Atlético", "Atletico"] },
  { name: "San Mamés", city: "Bilbao", country: "España", flag: "🇪🇸", lat: 43.2641, lng: -2.9497, cap: 53289, team: "Athletic Bilbao", wiki: "San Mamés Stadium", aliases: ["San Mames", "Athletic"] },
  { name: "Mestalla", city: "Valencia", country: "España", flag: "🇪🇸", lat: 39.4747, lng: -0.3583, cap: 49430, team: "Valencia", wiki: "Mestalla Stadium", aliases: ["Valencia CF"] },
  { name: "Ramón Sánchez-Pizjuán", city: "Sevilla", country: "España", flag: "🇪🇸", lat: 37.3841, lng: -5.9705, cap: 43883, team: "Sevilla", wiki: "Ramón Sánchez Pizjuán Stadium", aliases: ["Sanchez Pizjuan", "Sevilla"] },

  // ── Italy ──
  { name: "San Siro", city: "Milano", country: "Italia", flag: "🇮🇹", lat: 45.4781, lng: 9.1240, cap: 75923, team: "Milan / Inter", wiki: "San Siro", aliases: ["Giuseppe Meazza", "Meazza", "Milan", "Inter"] },
  { name: "Allianz Stadium", city: "Torino", country: "Italia", flag: "🇮🇹", lat: 45.1096, lng: 7.6413, cap: 41507, team: "Juventus", wiki: "Juventus Stadium", aliases: ["Juventus Stadium", "Juventus"] },
  { name: "Stadio Olimpico", city: "Roma", country: "Italia", flag: "🇮🇹", lat: 41.9339, lng: 12.4547, cap: 70634, team: "Roma / Lazio", wiki: "Stadio Olimpico", aliases: ["Olimpico", "Roma", "Lazio"] },
  { name: "Stadio Diego Armando Maradona", city: "Napoli", country: "Italia", flag: "🇮🇹", lat: 40.8279, lng: 14.1931, cap: 54726, team: "Napoli", wiki: "Stadio Diego Armando Maradona", aliases: ["San Paolo", "Maradona", "Napoli"] },

  // ── Germany ──
  { name: "Allianz Arena", city: "München", country: "Deutschland", flag: "🇩🇪", lat: 48.2188, lng: 11.6247, cap: 75024, team: "Bayern München", wiki: "Allianz Arena", aliases: ["Bayern", "Munich"] },
  { name: "Signal Iduna Park", city: "Dortmund", country: "Deutschland", flag: "🇩🇪", lat: 51.4926, lng: 7.4518, cap: 81365, team: "Borussia Dortmund", wiki: "Westfalenstadion", aliases: ["Westfalenstadion", "Dortmund", "BVB"] },
  { name: "Veltins-Arena", city: "Gelsenkirchen", country: "Deutschland", flag: "🇩🇪", lat: 51.5545, lng: 7.0676, cap: 62271, team: "Schalke 04", wiki: "Veltins-Arena", aliases: ["Arena AufSchalke", "Schalke"] },
  { name: "Olympiastadion Berlin", city: "Berlin", country: "Deutschland", flag: "🇩🇪", lat: 52.5147, lng: 13.2395, cap: 74475, team: "Hertha BSC", wiki: "Olympiastadion (Berlin)", aliases: ["Hertha", "Olympiastadion"] },

  // ── France / Portugal / Netherlands / Scotland ──
  { name: "Parc des Princes", city: "Paris", country: "France", flag: "🇫🇷", lat: 48.8414, lng: 2.2530, cap: 47929, team: "Paris Saint-Germain", wiki: "Parc des Princes", aliases: ["PSG", "Paris"] },
  { name: "Orange Vélodrome", city: "Marseille", country: "France", flag: "🇫🇷", lat: 43.2699, lng: 5.3959, cap: 67394, team: "Marseille", wiki: "Stade Vélodrome", aliases: ["Stade Vélodrome", "Velodrome", "Marseille"] },
  { name: "Estádio da Luz", city: "Lisboa", country: "Portugal", flag: "🇵🇹", lat: 38.7527, lng: -9.1847, cap: 64642, team: "Benfica", wiki: "Estádio da Luz", aliases: ["Da Luz", "Benfica", "Estadio da Luz"] },
  { name: "Estádio do Dragão", city: "Porto", country: "Portugal", flag: "🇵🇹", lat: 41.1617, lng: -8.5836, cap: 50033, team: "Porto", wiki: "Estádio do Dragão", aliases: ["Dragao", "Porto"] },
  { name: "Johan Cruyff Arena", city: "Amsterdam", country: "Nederland", flag: "🇳🇱", lat: 52.3143, lng: 4.9419, cap: 55865, team: "Ajax", wiki: "Johan Cruyff Arena", aliases: ["Amsterdam Arena", "Ajax"] },
  { name: "De Kuip", city: "Rotterdam", country: "Nederland", flag: "🇳🇱", lat: 51.8939, lng: 4.5231, cap: 47500, team: "Feyenoord", wiki: "De Kuip", aliases: ["Feyenoord", "Stadion Feijenoord"] },
  { name: "Celtic Park", city: "Glasgow", country: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", lat: 55.8497, lng: -4.2055, cap: 60411, team: "Celtic", wiki: "Celtic Park", aliases: ["Celtic"] },
  { name: "Ibrox Stadium", city: "Glasgow", country: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", lat: 55.8532, lng: -4.3092, cap: 50817, team: "Rangers", wiki: "Ibrox Stadium", aliases: ["Rangers", "Ibrox"] },

  // ── World icons ──
  { name: "Maracanã", city: "Rio de Janeiro", country: "Brasil", flag: "🇧🇷", lat: -22.9121, lng: -43.2302, cap: 78838, team: "Flamengo / Fluminense", wiki: "Maracanã Stadium", aliases: ["Maracana"] },
  { name: "La Bombonera", city: "Buenos Aires", country: "Argentina", flag: "🇦🇷", lat: -34.6356, lng: -58.3648, cap: 54000, team: "Boca Juniors", wiki: "La Bombonera", aliases: ["Boca Juniors", "Bombonera"] },
  { name: "Estadio Monumental", city: "Buenos Aires", country: "Argentina", flag: "🇦🇷", lat: -34.5453, lng: -58.4497, cap: 84567, team: "River Plate", wiki: "Estadio Monumental (Buenos Aires)", aliases: ["River Plate", "Monumental"] },
  { name: "Estadio Azteca", city: "Ciudad de México", country: "México", flag: "🇲🇽", lat: 19.3029, lng: -99.1505, cap: 87523, team: "Club América", wiki: "Estadio Azteca", aliases: ["Azteca"] },
  { name: "Lusail Stadium", city: "Lusail", country: "Qatar", flag: "🇶🇦", lat: 25.4211, lng: 51.4911, cap: 88966, team: "Milli Takım", wiki: "Lusail Stadium", aliases: ["Lusail Iconic"] },
  { name: "MetLife Stadium", city: "New York", country: "USA", flag: "🇺🇸", lat: 40.8135, lng: -74.0745, cap: 82500, team: "—", wiki: "MetLife Stadium", aliases: ["MetLife"] },
];

function norm(s) {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Match a logged venue string to a known stadium (by name or any alias). Null if unknown.
export function matchVenue(venue) {
  var v = norm(venue);
  if (!v || v.length < 3) return null;
  for (var i = 0; i < STADIUMS.length; i++) {
    var st = STADIUMS[i];
    var keys = [st.name].concat(st.aliases || []);
    for (var j = 0; j < keys.length; j++) {
      var nk = norm(keys[j]);
      if (!nk) continue;
      if (v === nk || v.indexOf(nk) !== -1 || (nk.length >= 6 && nk.indexOf(v) !== -1)) return st;
    }
  }
  return null;
}
