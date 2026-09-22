import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const STUDIES_URL = "https://dermatest.com/de/studien/";
const USER_AGENT =
  "Mozilla/5.0 (compatible; DermatestNotifierBot/1.0; +https://github.com/interactivexperience/dermatest-notifier)";

// Begriffe, die auf einen begleiteten Vor-Ort-Termin (ärztliche/fachliche
// Kontrolle im Testzentrum) hindeuten - wird gegen Titel, "Zeitaufwand"- und
// "Besonderheiten"-Text geprüft. Bewusst nicht "Zentrum"/"Standort", da jede
// Studie (auch reine Selbstanwendung zuhause) ein Probandenzentrum als
// Anlaufstelle listet, ohne dass das einen Vor-Ort-Termin bedeutet.
const ON_SITE_SUPERVISION_PATTERN = /kontrolle|ärztlich|begleitet|vor[\s-]?ort|termin/i;

const TOPICS_PATH = fileURLToPath(new URL("../topics.json", import.meta.url));
const SEEN_PATH = fileURLToPath(new URL("../data/seen.json", import.meta.url));

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function normalize(text) {
  return text.toLowerCase();
}

async function fetchStudies() {
  const res = await fetch(STUDIES_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Abruf der Studienseite fehlgeschlagen: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  // Root: die äußere JetEngine-Listing-Grid mit den Studien-Karten. Bewusst
  // nicht global ".jet-listing-grid__item" selektiert, weil eine verschachtelte
  // Sub-Listing-Grid (Standort-Widget, id 7227) dieselben Klassen wiederverwendet.
  const items = $(".jet-listing-grid--893.jet-listing-grid__items > .jet-listing-grid__item[data-post-id]");

  const studies = [];
  items.each((_, el) => {
    const $item = $(el);
    const id = $item.attr("data-post-id");
    const title = $item.find("p.elementor-heading-title.elementor-size-default").first().text().trim();
    const link =
      $item.find(".jet-engine-listing-overlay-wrap").first().attr("data-url") ||
      $item.find("a.jet-engine-listing-overlay-link").attr("href") ||
      $item.find("a.elementor-button-link").attr("href") ||
      "";

    // Reihenfolge auf der Karte: erstes dynamisches Feld = Status (leer = offen),
    // zweites = Startdatum. Nicht eindeutig ausgezeichnet, daher positionsbasiert.
    const dynamicFields = $item.find(".jet-listing-dynamic-field__content");
    const statusText = $(dynamicFields.get(0)).text().trim();
    const dateText = $(dynamicFields.get(1)).text().trim();

    const location = $item
      .find(".jet-listing-grid--7227 .elementor-widget-text-editor .elementor-widget-container")
      .first()
      .text()
      .trim();

    if (!id || !title) return;
    studies.push({
      id,
      title,
      link,
      status: statusText || "offen",
      date: dateText,
      location,
    });
  });

  // Sanity-Check gegen JetEngine's eigene Ergebniszahl. Falls Dermatest die
  // Seitenstruktur oder Pagination ändert, fällt das hier auf statt still
  // Studien zu verlieren.
  const foundPostsMatch = html.match(/"found_posts":(\d+)/);
  if (foundPostsMatch) {
    const foundPosts = parseInt(foundPostsMatch[1], 10);
    if (foundPosts !== studies.length) {
      console.warn(
        `Warnung: JetEngine meldet ${foundPosts} Studien, aber ${studies.length} wurden extrahiert. ` +
          "Vermutlich hat sich die Seitenstruktur geändert oder es gibt jetzt mehrere Seiten - Scraper-Selektoren prüfen."
      );
    }
  }

  return studies;
}

// Lädt die Detailseite einer Studie und extrahiert die Felder, die zeigen, ob
// ein begleiteter Vor-Ort-Termin nötig ist. Elementor rendert Label ("Zeitaufwand:")
// und Wert als getrennte, aufeinanderfolgende "Blatt"-Elemente ohne gemeinsame
// eindeutige Klasse - daher positionsbasiert wie schon auf der Archivseite.
async function fetchDetailInfo(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const leaves = [];
  $("body *").each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 0) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text) leaves.push(text);
  });
  const zeitaufwandIdx = leaves.indexOf("Zeitaufwand:");
  const zeitaufwand = zeitaufwandIdx !== -1 ? leaves[zeitaufwandIdx + 1] : "";

  // "Besonderheiten:" ist im DOM nicht zuverlässig positionsbasiert zu greifen
  // (Study-Nurse-Widget dazwischen variiert), daher als Text-Ausschnitt zwischen
  // dem Label und dem nächsten bekannten Seiten-Baustein.
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const besonderheitenMatch = bodyText.match(/Besonderheiten:\s*(.*?)\s*Eingeloggt bleiben/);
  const besonderheiten = besonderheitenMatch ? besonderheitenMatch[1] : "";

  return { zeitaufwand, besonderheiten };
}

function requiresOnSiteSupervision(study, detail) {
  const haystack = [study.title, detail.zeitaufwand, detail.besonderheiten].join(" ");
  return ON_SITE_SUPERVISION_PATTERN.test(haystack);
}

function matchedTopicsFor(study, topics) {
  const haystack = normalize(study.title);
  return topics.filter((topic) => haystack.includes(normalize(topic)));
}

async function createDigestIssue({ owner, repo, token, studies }) {
  const title =
    studies.length === 1 ? `Neue Dermatest-Studie: ${studies[0].title}` : `${studies.length} neue Dermatest-Studien`;

  const sections = studies.map((s) => {
    const lines = [
      `### ${s.title}`,
      `**Themen-Treffer:** ${s.matchedTopics.join(", ")}`,
      `**Datum:** ${s.date || "-"}`,
      `**Ort:** ${s.location || "-"}`,
      s.zeitaufwand ? `**Zeitaufwand:** ${s.zeitaufwand}` : null,
      `**Link:** ${s.link}`,
    ].filter((line) => line !== null);
    return lines.join("\n");
  });

  const body = [...sections, `cc @${owner}`].join("\n\n---\n\n");

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, assignees: [owner] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Issue-Erstellung fehlgeschlagen (${res.status}): ${text}`);
  }
}

async function main() {
  const topics = loadJson(TOPICS_PATH, []);
  if (topics.length === 0) {
    console.log("Keine Themen in topics.json eingetragen - nichts zu tun.");
    return;
  }
  console.log(`Beobachtete Themen: ${topics.join(", ")}`);

  const seen = loadJson(SEEN_PATH, []);
  const seenIds = new Set(seen);

  const studies = await fetchStudies();
  console.log(`${studies.length} Studien auf der Seite gefunden.`);

  const topicMatches = studies
    .filter((s) => !seenIds.has(s.id))
    .map((s) => ({ ...s, matchedTopics: matchedTopicsFor(s, topics) }))
    .filter((s) => s.matchedTopics.length > 0);

  if (topicMatches.length === 0) {
    console.log("Keine neuen Themen-Treffer.");
    return;
  }

  const openMatches = topicMatches.filter((s) => s.status === "offen");
  const bookedMatches = topicMatches.filter((s) => s.status !== "offen");
  if (bookedMatches.length > 0) {
    console.log(
      `${bookedMatches.length} Treffer übersprungen (bereits ausgebucht): ${bookedMatches.map((s) => s.title).join(", ")}`
    );
  }

  const included = [];
  const excludedOnSite = [];
  const newlySeenIds = [];

  for (const study of openMatches) {
    let detail;
    try {
      detail = await fetchDetailInfo(study.link);
    } catch (err) {
      console.warn(`Detailseite für "${study.title}" nicht prüfbar (${err.message}) - wird nächstes Mal erneut versucht.`);
      continue; // absichtlich NICHT als seen markieren
    }
    newlySeenIds.push(study.id);
    if (requiresOnSiteSupervision(study, detail)) {
      excludedOnSite.push(study);
    } else {
      included.push({ ...study, zeitaufwand: detail.zeitaufwand });
    }
  }

  if (newlySeenIds.length > 0) {
    const updatedSeen = Array.from(new Set([...seen, ...newlySeenIds]));
    writeFileSync(SEEN_PATH, JSON.stringify(updatedSeen, null, 2) + "\n");
    console.log(`seen.json aktualisiert (${updatedSeen.length} bekannte Studien-IDs).`);
  }

  if (excludedOnSite.length > 0) {
    console.log(
      `${excludedOnSite.length} Treffer übersprungen (Vor-Ort-Kontrolltermin nötig): ${excludedOnSite
        .map((s) => s.title)
        .join(", ")}`
    );
  }

  if (included.length === 0) {
    console.log("Keine neuen Treffer, die alle Kriterien erfüllen (offen + reine Selbstanwendung zuhause).");
    return;
  }

  console.log(`${included.length} neue passende Treffer - lege Sammel-Issue an:`);
  for (const s of included) {
    console.log(` - ${s.title} (Themen: ${s.matchedTopics.join(", ")})`);
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY; // "owner/repo"
  if (!token || !repository) {
    throw new Error("GITHUB_TOKEN / GITHUB_REPOSITORY fehlen - kann kein Issue anlegen.");
  }
  const [owner, repo] = repository.split("/");

  await createDigestIssue({ owner, repo, token, studies: included });
  console.log("Sammel-Issue angelegt.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
