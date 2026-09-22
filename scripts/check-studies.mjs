import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const STUDIES_URL = "https://dermatest.com/de/studien/";
const USER_AGENT =
  "Mozilla/5.0 (compatible; DermatestNotifierBot/1.0; +https://github.com/interactivexperience/dermatest-notifier)";

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
  const res = await fetch(STUDIES_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
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
    // zweites = Startdatum. Nicht eindeutig ausgezeichnet, daher positionsbasiert
    // (siehe README für die Begründung und den Sanity-Check unten).
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

function matchedTopicsFor(study, topics) {
  const haystack = normalize(study.title);
  return topics.filter((topic) => haystack.includes(normalize(topic)));
}

async function createIssue({ owner, repo, token, study }) {
  const title = `Neue Dermatest-Studie: ${study.title}`;
  const bodyLines = [
    `**Themen-Treffer:** ${study.matchedTopics.join(", ")}`,
    `**Status:** ${study.status}`,
    study.date ? `**Datum:** ${study.date}` : null,
    study.location ? `**Ort:** ${study.location}` : null,
    study.link ? `**Link:** ${study.link}` : null,
    "",
    `cc @${owner}`,
  ].filter((line) => line !== null);

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title,
      body: bodyLines.join("\n"),
      assignees: [owner],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Issue-Erstellung für Studie ${study.id} fehlgeschlagen (${res.status}): ${text}`);
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

  const newMatches = [];
  for (const study of studies) {
    if (seenIds.has(study.id)) continue;
    const matchedTopics = matchedTopicsFor(study, topics);
    if (matchedTopics.length > 0) {
      newMatches.push({ ...study, matchedTopics });
    }
  }

  if (newMatches.length === 0) {
    console.log("Keine neuen Treffer.");
    return;
  }

  console.log(`${newMatches.length} neue Treffer gefunden:`);
  for (const match of newMatches) {
    console.log(` - ${match.title} (Themen: ${match.matchedTopics.join(", ")})`);
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY; // "owner/repo"
  if (!token || !repository) {
    throw new Error("GITHUB_TOKEN / GITHUB_REPOSITORY fehlen - kann keine Issues anlegen.");
  }
  const [owner, repo] = repository.split("/");

  for (const study of newMatches) {
    await createIssue({ owner, repo, token, study });
  }

  const updatedSeen = Array.from(new Set([...seen, ...newMatches.map((s) => s.id)]));
  writeFileSync(SEEN_PATH, JSON.stringify(updatedSeen, null, 2) + "\n");
  console.log(`seen.json aktualisiert (${updatedSeen.length} bekannte Studien-IDs).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
