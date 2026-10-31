# Product road map: website, launcher and in-game updates

This is the working plan behind `/roadmap` on the site. It covers the three surfaces that are still thin — the
website, the launcher and the in-game update notices — in the order they should be built, with the reasoning and the
acceptance checks for each.

The visual version is `website/src/pages/roadmap.html` (rendered to `docs/shots/roadmap_poster.png`).

## 1. What already exists

| Surface | Today |
|---|---|
| **Website** (`website/`) | Cloudflare Worker; pages for home, world, classes, news, download, support, terms, privacy, EULA, 404; hashed assets, sitemap, OG/Twitter cards, CSP, English-only check, link check, e2e test. **Now also `/roadmap`.** |
| **Launcher** (`launcher/`) | Frameless 1.3.0 app: sign-in, patching with resume, verify/repair, self-update, Windows Defender/unblock helpers, news list read from `news.json`, server status, offline copy. |
| **Release notes** | `CHANGELOG.md` is the source. `website/build.mjs` turns it into the news seed for the site; `scripts/make-release.mjs` writes `release/news.json`, which the launcher fetches. There is **no changelog page** and **no in-game notice at all**. |
| **In game** | No patch notes, no "what's new", no version-visible changelog. The client knows its version only through the launcher hand-off. |

So the gap is: the site can publish news but not history; the launcher shows news but never says *what changed in this
update*; the game never mentions that an update happened.

## 2. What good versions of these look like

Points that survived checking against real products and a few written guides — [launcher news/changelog guidance](https://gamelauncher.gitbook.io/documentation/how-to-show-news-and-alerts/show-your-news-or-changelog),
[launcher announcement docs](https://gamelauncher.cloud/help/news-and-announcements/news),
[game-site launch checklist](https://dev.to/avry_mcgarvey_9c5eded0525/launch-your-game-website-this-weekend-a-developer-focused-hitbox-guide-428j):

1. **One primary action per surface.** A launcher exists to get you into the game; everything else is secondary. (This
   is the lesson already applied in launcher 1.3.0.)
2. **Notes are player-facing, not commit logs.** Group by what a player can now do, say nothing about refactors, and
   keep one version per entry with a date.
3. **The update is announced where the player already is.** Launcher news before launch, an in-game notice after
   launch; neither should require opening a browser.
4. **Show status, not just announcements.** Online/offline, players, latency, and *known issues* are what players hit
   when something feels wrong.
5. **One source of truth.** The same notes should feed the site changelog, the launcher card and the in-game window;
   otherwise they drift and one of them starts lying.
6. **A calm website, not a storefront.** Hero, download, news, support, and enough proof (screenshots, changelog) that
   a stranger can judge the game in a minute.
7. **Never hide the version or the build.** A version chip that opens the changelog costs nothing and answers most
   "is this fixed?" questions.

## 3. The plan, in order

### P0 — the site can tell its own history (this round)

- [x] **`/roadmap` page** — shipped / next, in the site's own ink-wash style. It is generated from
      `src/pages/roadmap.html`, appears in the nav and the sitemap, and passes the site e2e test at 1280 and 400 px.
- [ ] **`/changelog` page** — one section per version from `CHANGELOG.md`, newest first, player-facing bullets only
      (reuse the existing news-seed parser in `build.mjs`), anchored per version (`#v0-5-0`) so the launcher and the
      game can deep-link.
  - Acceptance: every version in `CHANGELOG.md` appears once, in descending order; the news seed and the changelog
    page are produced from the same parse; e2e passes at 1280 and 400 px.

### P1 — the update is announced where the player is

- [ ] **Launcher "what's new"** — after an update completes, show the release notes for the version just installed
      (a card in the existing news area plus a dismissible highlight), then never again for that version
      (`localStorage` or the install state file).
  - Acceptance: the notes for the installed version render after patching; dismissing them survives a restart; a
    second launch shows the normal news list.
- [ ] **Launcher changelog tab** — read the same feed, list older versions, link out to `/changelog`.
- [ ] **In-game "what's new" window** — on the first login after the version changes, a paper-scroll modal with the
      notes for that version and a "known issues" line; dismissed per version.
  - Acceptance: shown once per version (persisted client-side), never blocks input, respects reduced motion, closes
    with Escape, and can be re-opened from the version chip.
- [ ] **In-game patch-notes panel** — the same content behind a key (or from the Journal), so it is never more than
      one action away.
  - Acceptance: opens from the help screen and the version chip; renders the shipped notes; no network call needed.

### P2 — status and the people behind the game

- [ ] **Status page** (`/status`) — server online, players, latency, last deploy, and a short history strip. It reads
      the same `/health` endpoint the launcher uses.
- [ ] **Devlog** — short posts with an image each: how a zone, a boss or a sound is made. This is the cheapest way to
      make the site feel alive between updates.
- [ ] **Press kit** (`/press`) — logo, screenshots, fact sheet, one-paragraph description, contact.
- [ ] **FAQ and first hour** — account trouble, patching trouble, controls, "why is my frame rate low", "where do I go
      first"; link the support page.
- [ ] **Bug report** — a launcher button that writes a report with the launcher log and the last client errors, and a
      mailto/issue link on the site.
- [ ] **Download page details** — per-platform checksums, system requirements, and a note that the build is unsigned.

### P3 — content the roadmap promises
A second zone, a dungeon with repeatable modifiers, and more boss mechanics. These are game work, not surface work;
they are listed in `/roadmap` so the site does not over-promise what the version numbers imply.

## 4. One source of truth for release notes

```
CHANGELOG.md  ──parse──>  { version, title, date, bullets }[]
                             ├── website: /news seed + /changelog page
                             ├── launcher: release/news.json  (already)
                             └── game: releases.json bundled at client build time
```

Decisions:

- **Keep `CHANGELOG.md` as the source.** It is already written every release and already parsed by `build.mjs`; adding
  a second file would drift immediately.
- **Teach the parser dates.** The changelog headings carry no dates today (the news seed hardcodes two of them), so
  the changelog page would show undated versions. Add `(YYYY-MM-DD)` to each `##` heading as versions are cut.
- **Ship the notes into the client at build time** rather than fetching them at runtime: the in-game window must work
  offline and inside the Electron bundle, and a fetched notice would be a new network dependency and CSP surface.
- **One renderer, three surfaces.** Where practical, the release-notes renderer should be shared (the launcher already
  renders banners and body text; the game has a paper-scroll modal) so the same notes look related everywhere.

## 5. Non-goals

- No comments, forums or user accounts on the site beyond what the launcher already needs.
- No analytics, no tracking pixels (the footer already promises "no tracking cookies, no analytics").
- No public bug tracker; the report button writes a local file and opens a mail draft.
- No auto-posting to social networks.

## 6. How this gets verified

Every item above needs evidence before it is reported done: the site e2e (`node website/scripts/test.mjs`) and link
check (`node website/scripts/linkcheck.mjs`) for site pages; a headless screenshot for anything visual; the launcher
test suite for launcher changes; the server/client suites for game changes. A roadmap page is not evidence that a
feature shipped — only the feature's own test is.
