import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (compatible; DermatestNotifierBot/1.0; +https://github.com/interactivexperience/dermatest-notifier)";

const url = "https://dermatest.com/de/studien/augen-pads-fuer-trockene-und-sensible-haut-mit-augenringen-und-augenschatten-ab-18-jahren-mit-augenaerztlicher-kontrolle/";

const res = await fetch(url, { headers: { "User-Agent": UA } });
const html = await res.text();
const $ = cheerio.load(html);

const labels = ["Zeitaufwand:", "Besonderheiten:", "Startdatum:", "Standort:"];

for (const label of labels) {
  console.log("\n=== Label:", label, "===");
  $("*").each((_, el) => {
    const $el = $(el);
    const ownText = $el
      .contents()
      .filter((_, n) => n.type === "text")
      .text()
      .trim();
    if (ownText === label) {
      console.log("--- Label-Element outerHTML ---");
      console.log($.html(el));
      console.log("--- Parent outerHTML (gekürzt auf 1500 Zeichen) ---");
      console.log($.html($el.parent()).slice(0, 1500));
      // Nächstes Element mit sichtbarem Text nach dem Label-Container suchen
      let $container = $el.closest(".elementor-widget, div");
      let $next = $container.next();
      let hops = 0;
      while ($next.length && $next.text().trim() === "" && hops < 5) {
        $next = $next.next();
        hops++;
      }
      console.log("--- Nächstes Geschwister-Element mit Text (outerHTML, gekürzt) ---");
      console.log($.html($next).slice(0, 1500));
      return false; // nur erstes Vorkommen
    }
  });
}
