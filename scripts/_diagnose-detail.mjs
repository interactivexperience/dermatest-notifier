import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (compatible; DermatestNotifierBot/1.0; +https://github.com/interactivexperience/dermatest-notifier)";

const urls = [
  "https://dermatest.com/de/studien/intimfeuchttuecher-fuer-frauen-ab-18-jahren/",
  "https://dermatest.com/de/studien/damenbinden18-mit-neurodermitis-asthma-oder-allergien/",
  "https://dermatest.com/de/studien/augen-pads-fuer-trockene-und-sensible-haut-mit-augenringen-und-augenschatten-ab-18-jahren-mit-augenaerztlicher-kontrolle/",
];

for (const url of urls) {
  console.log("\n===================================================");
  console.log("URL:", url);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  console.log("HTTP status:", res.status);
  const html = await res.text();
  console.log("Byte length:", html.length);
  const $ = cheerio.load(html);

  // Kompletter sichtbarer Fließtext des Hauptinhalts, Whitespace normalisiert -
  // erstmal grob (body), um die Struktur kennenzulernen, bevor wir gezielt selektieren.
  $("script, style, noscript").remove();
  const bodyText = $("body").text().replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  console.log("----- BODY TEXT (erste 6000 Zeichen) -----");
  console.log(bodyText.slice(0, 6000));

  // Etwaige strukturierte Felder (JetEngine Meta-Felder werden oft als
  // "Label: Wert" Paare gerendert) grob heuristisch herausfiltern
  console.log("----- Zeilen mit 'zuhause'/'Termin'/'Kontrolle'/'Ablauf'/'Zentrum' -----");
  const matches = bodyText
    .split("\n")
    .filter((line) => /zuhause|termin|kontrolle|ablauf|zentrum|selbstst|eigenst/i.test(line));
  console.log(matches.join("\n"));
}
