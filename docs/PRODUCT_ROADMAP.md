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
- [x] **`/changelog` page** — one section per version from `CHANGELOG.md`, newest first, player-facing bullets only,
      anchored per version (`#v0-5-0`) so the launcher and the game can deep-link. Shipped with a shared parser
      (`scripts/release-notes.mjs`) that also feeds the news seed and the game's bundled notes.
  - Acceptance: every version in `CHANGELOG.md` appears once, in descending order; the news seed and the changelog
    page are produced from the same parse; e2e passes at 1280 and 400 px. **Met:** 5 versions, 15 groups, 12 pages,
    e2e green, link check 0 problems.

### P1 — the update is announced where the player is

- [x] **Launcher "what's new"** — after an update completes, show the release notes for the version just installed
      (a card in the existing news area plus a dismissible highlight), then never again for that version
      (`localStorage["launcher.whatsNew.dismissedVersion"]`). Shows after a first install too, and can be reopened from
      the "WHAT'S NEW" button in the news header.
  - Acceptance: the notes for the installed version render after patching; dismissing them survives a restart; a
    second launch shows the normal news list. **Met:** 12/12 headless checks, launcher tests green, screenshot
    `docs/shots/launcher_whats_new.png`.
- [x] **Launcher changelog entry point** — the "WHAT'S NEW" header button plus a "READ THE FULL CHANGELOG →" link to
      `{website}/changelog#v<0-5-0 style>` (deep link; the full older-version list lives on the site).
- [x] **In-game "what's new" window** — on the first login after the version changes, a paper-scroll modal with the
      notes for that version and a "known issues" line; dismissed per version (`localStorage["jz.seenVersion"]`).
      Debug/scripted sessions skip the automatic popup so test suites are never blocked.
  - Acceptance: shown once per version (persisted client-side), never blocks input, respects reduced motion, closes
    with Escape, and can be re-opened from the version chip. **Met:** 22/22 functional checks + 6/6 debug-path checks,
    screenshot `docs/shots/ui_whats_new.png`.
- [x] **In-game patch-notes panel** — the same content behind the version chip (click) and the F1 help screen, with a
      "Read the full notes" history of every shipped version, rendered from the bundled `client/src/data/releases.json`
      (no network call).
  - Acceptance: opens from the help screen and the version chip; renders the shipped notes; no network call needed.

### P2 — status and the people behind the game

- [x] **Status page** (`/status`) — server online, players, round trip, server version, last checked, and a strip of
      every check made while the page is open. It polls the same `/health` endpoint the launcher and the site badge use
      (`website/src/js/status.js`), every 15 s, and fails soft. The header badge now links here.
- [x] **Devlog** (`/devlog`) — three notes from the workshop, each with an in-game capture: painting the valley from seeded noise,
      designing a boss around its telegraph, and synthesising every sound at runtime. Linked from the footer and the
      roadmap page.
- [x] **Press kit** (`/press`) — fact sheet, short and long description, six real in-game screenshots free to reuse,
      seal/wordmark notes, contact and usage rules.
- [x] **FAQ and first hour** — the FAQ already covered accounts, the launcher, networks, controls and bug reports; this
      pass adds **"Your first hour"** to `/support#first-hour`: a six-step route from sign-in to the Stone Guardian.
- [ ] **Bug report** — a launcher button that writes a report with the launcher log and the last client errors
      (in progress: the launcher builds a diagnostic bundle into `<userData>/report-<timestamp>.txt`).
- [x] **Download page details** — already present before this pass: per-platform checksums with copy instructions,
      system requirements, the unsigned-build (SmartScreen/Gatekeeper) notes and a portable build link.

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
