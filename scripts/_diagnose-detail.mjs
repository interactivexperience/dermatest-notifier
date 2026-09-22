import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (compatible; DermatestNotifierBot/1.0; +https://github.com/interactivexperience/dermatest-notifier)";

const urls = [
  "https://dermatest.com/de/studien/intimfeuchttuecher-fuer-frauen-ab-18-jahren/",
  "https://dermatest.com/de/studien/augen-pads-fuer-trockene-und-sensible-haut-mit-augenringen-und-augenschatten-ab-18-jahren-mit-augenaerztlicher-kontrolle/",
];

function leafTextNodes($) {
  const out = [];
  $("body *").each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 0) return; // nur "Blatt"-Elemente ohne Kind-Elemente
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text) out.push({ tag: el.tagName, class: $el.attr("class") || "", text });
  });
  return out;
}

for (const url of urls) {
  console.log("\n===================================================");
  console.log("URL:", url);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const leaves = leafTextNodes($);

  const labels = ["Startdatum:", "Aufwandsentschädigung:", "Produkt:", "Zielgruppe:", "Zeitaufwand:", "Standort:", "zuständige Study Nurse:", "Besonderheiten:"];
  for (const label of labels) {
    const idx = leaves.findIndex((l) => l.text === label);
    if (idx === -1) {
      console.log(`${label} -> NICHT GEFUNDEN`);
      continue;
    }
    const value = leaves[idx + 1];
    console.log(`${label} -> [idx ${idx}, next tag=${value?.tag}.${value?.class}] "${value?.text}"`);
  }
}
