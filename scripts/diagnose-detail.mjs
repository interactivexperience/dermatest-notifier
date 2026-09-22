import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (compatible; DermatestNotifierBot/1.0; +https://github.com/interactivexperience/dermatest-notifier)";

const url = process.argv[2];
if (!url) {
  console.error("Nutzung: node scripts/_diagnose-detail.mjs <studien-detail-url>");
  process.exit(1);
}

const res = await fetch(url, { headers: { "User-Agent": UA } });
console.log("HTTP status:", res.status);
const html = await res.text();
const $ = cheerio.load(html);

const leaves = [];
$("body *").each((_, el) => {
  const $el = $(el);
  if ($el.children().length > 0) return;
  const text = $el.text().replace(/\s+/g, " ").trim();
  if (text) leaves.push(text);
});

const labels = ["Startdatum:", "Aufwandsentschädigung:", "Produkt:", "Zielgruppe:", "Zeitaufwand:", "Standort:"];
console.log("\n----- Positionsbasierte Feld-Extraktion -----");
for (const label of labels) {
  const idx = leaves.indexOf(label);
  console.log(`${label} -> ${idx !== -1 ? leaves[idx + 1] : "NICHT GEFUNDEN"}`);
}

const bodyText = $("body").text().replace(/\s+/g, " ").trim();
const besonderheitenMatch = bodyText.match(/Besonderheiten:\s*(.*?)\s*Eingeloggt bleiben/);
console.log(`Besonderheiten: -> ${besonderheitenMatch ? besonderheitenMatch[1] : "NICHT GEFUNDEN"}`);
