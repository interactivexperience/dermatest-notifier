# Dermatest-Notifier

Prüft regelmäßig [dermatest.com/de/studien/](https://dermatest.com/de/studien/) auf neue Studien
und benachrichtigt per E-Mail (über GitHub-Issue-Notifications), wenn eine neue Studie zu einem
deiner Themen auftaucht.

## Wie es funktioniert

- **Scraper** (`scripts/check-studies.mjs`): lädt die Studienseite, extrahiert Titel, Status
  (offen / ausgebucht), Datum, Ort und Link pro Studie.
- **Themen** (`topics.json`): Liste von Stichwörtern. Dermatest hat auf der Studienseite keine
  echte Kategorie-/Themen-Taxonomie (nur einen Standort-Filter) — "Thema" bedeutet hier deshalb:
  case-insensitive Teilstring-Suche im Studientitel. Stichwörter wie `Gesichtscreme`, `Windel`,
  `Haarausfall` funktionieren gut.
- **Filter auf offene Studien**: bereits ausgebuchte Treffer werden ignoriert (kein Eintrag in
  `seen.json`, damit sie nicht dauerhaft blockiert bleiben, falls sich der Status doch mal ändert).
- **Filter auf reine Selbstanwendung zuhause**: für jeden verbleibenden Treffer wird zusätzlich die
  Studien-Detailseite geladen und die Felder "Zeitaufwand" sowie "Besonderheiten" (plus der Titel)
  auf Hinweise auf einen begleiteten Vor-Ort-Termin durchsucht (Wörter wie "Kontrolle", "ärztlich",
  "begleitet", "Termin"). Treffer mit einem solchen Hinweis werden nicht gemeldet, aber als
  "geprüft" in `seen.json` vermerkt, damit sie nicht jede Woche erneut geladen werden. Das ist ein
  Text-Heuristik, keine strukturierte Angabe von Dermatest — bei ungewöhnlichen Formulierungen kann
  das im Einzelfall daneben liegen.
- **Deduplizierung** (`data/seen.json`): IDs bereits geprüfter/benachrichtigter Studien, damit du
  nicht bei jedem Lauf erneut benachrichtigt wirst.
- **Benachrichtigung**: alle neuen Treffer eines Laufs werden in **einem einzigen** GitHub-Issue
  gesammelt (zugewiesen an dich) → GitHub verschickt dafür automatisch eine E-Mail an deine
  GitHub-Notification-Adresse. Kein Treffer → keine Mail.
- **Cron**: `.github/workflows/check-studies.yml` läuft jeden Montag um 08:00 Uhr UTC automatisch,
  plus manuell auslösbar über den "Run workflow"-Button im Actions-Tab.

## Einmaliges Setup

### 1. GitHub Pages aktivieren (für die Themen-Verwaltungsseite)

Repo-Settings → **Pages** → Source: "Deploy from a branch" → Branch `main`, Ordner `/ (root)`.
Danach ist die Verwaltungsseite unter `https://interactivexperience.github.io/dermatest-notifier/`
erreichbar.

### 2. Personal Access Token für die Themen-Seite erstellen

Die Verwaltungsseite (`index.html`) schreibt `topics.json` direkt über die GitHub-API — dafür
brauchst du einmalig einen Token, den **nur dein Browser** lokal speichert (localStorage), er wird
nirgendwohin sonst geschickt.

1. [Fine-grained Token erstellen](https://github.com/settings/personal-access-tokens/new)
2. Repository access: nur `dermatest-notifier` auswählen
3. Permissions: **Contents: Read and write**
4. Token kopieren, auf der Themen-Seite einfügen und "Token speichern" klicken

### 3. E-Mail-Benachrichtigung sicherstellen

Die Benachrichtigung geht an die primäre E-Mail-Adresse deines GitHub-Accounts (Settings →
**Emails**). Damit sie dort auch wirklich ankommt statt nur als Web-Benachrichtigung zu erscheinen:

GitHub → Settings → **Notifications** → im Abschnitt "Participating" sicherstellen, dass
**Email** aktiviert ist (nicht nur die Standard-Web-Benachrichtigung).

Willst du stattdessen eine andere Adresse verwenden: unter Settings → Emails hinzufügen und
verifizieren (manche Wegwerf-/Alias-Mail-Domains lässt GitHub dabei nicht zu), dann unter
Settings → Notifications als "Default notification email" auswählen.

### 4. Themen eintragen

Verwaltungsseite öffnen (siehe Schritt 1), Token eintragen, Themen hinzufügen. Fertig — der
nächste Cron-Lauf (spätestens alle 3 Stunden) prüft automatisch dagegen.

## Manuell testen

Im Actions-Tab → "Check for new Dermatest studies" → "Run workflow". Läuft der Workflow durch,
siehst du im Log, wie viele Studien gefunden wurden und ob es neue Treffer gab.

## Wenn der Scraper irgendwann nichts mehr findet

Dermatest kann die Seitenstruktur ändern. Zwei Signale dafür:

- Der Workflow-Log warnt, wenn die von JetEngine gemeldete Studienzahl (`found_posts`) nicht mit
  der Anzahl extrahierter Studien übereinstimmt.
- `.github/workflows/diagnose.yml` (manuell auslösbar) lädt die Archiv-Seite roh und gibt das
  komplette HTML im Log aus — damit lässt sich die aktuelle Struktur wieder inspizieren, falls die
  CSS-Selektoren in `scripts/check-studies.mjs` angepasst werden müssen.
- `.github/workflows/diagnose-detail.yml` (manuell auslösbar, mit URL-Eingabefeld) macht dasselbe
  für eine einzelne Studien-Detailseite und zeigt zusätzlich, was die positionsbasierte
  Feld-Extraktion (Zeitaufwand, Besonderheiten, ...) aktuell daraus liest.

## Hinweis zu Themen-Änderungen

Wird ein Thema erst nachträglich hinzugefügt, matcht es auch gegen zu diesem Zeitpunkt bereits
länger gelistete (aber noch nicht als "seen" markierte) Studien — du bekommst also rückwirkend
eine Benachrichtigung für bestehende Treffer. Wird ein Thema entfernt und später wieder
hinzugefügt, bereits benachrichtigte Studien lösen keine zweite Benachrichtigung aus.
