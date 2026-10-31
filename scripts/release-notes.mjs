// Parses CHANGELOG.md into structured, player-facing release notes.
// Used by website/build.mjs (news seed + /changelog page) and scripts/make-releases.mjs (client/src/data/releases.json),
// so the site, the launcher and the game can never disagree about what a version contained.
//
// Shape: [{ version, title, date, intro, groups: [{ heading, bullets: string[] }] }]

/** Bullets that only make sense to a developer; they are filtered out of player-facing notes. */
const DEV_ONLY = /npm |sqlite|workflow|electron-builder|\.cjs|\.mjs|\.ts\b|ui-test|TEST_MODE|bots\.ts|grader|protocol|sandbox|headless|deterministic|assert/i;

/** Strip inline markdown emphasis/code so both JSON and HTML consumers get clean text. */
export function plain(text) {
  return String(text)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The anchor id the site and the launcher use to deep-link one version. */
export function versionAnchor(version) {
  return "v" + String(version).replace(/\./g, "-");
}

/**
 * Parse the changelog.
 * @param {string} md - CHANGELOG.md contents.
 * @param {{ filterDev?: boolean, maxBulletsPerGroup?: number }} [options]
 * @returns {Array<{ version: string, title: string, date: string | null, intro: string, groups: Array<{ heading: string, bullets: string[] }> }>}
 */
export function parseChangelog(md, options = {}) {
  const { filterDev = false, maxBulletsPerGroup = 0 } = options;
  const versions = [];
  for (const block of String(md).split(/^## /m).slice(1)) {
    const lines = block.split(/\r?\n/);
    const heading = lines[0].trim();
    const match = heading.match(/^v?(\d+\.\d+\.\d+)\s*[—–-]?\s*(.*)$/);
    if (!match) continue;
    const version = match[1];
    let title = match[2].trim();
    let date = null;
    const dateMatch = title.match(/\((\d{4}-\d{2}-\d{2})\)\s*$/);
    if (dateMatch) {
      date = dateMatch[1];
      title = title.slice(0, dateMatch.index).trim();
    }
    title = title.replace(/^[—–-]\s*/, "").trim();
    const wrapped = title.match(/^\((.*)\)$/);
    if (wrapped) title = wrapped[1].trim();
    if (!title || /^build\s+\d+$/i.test(title)) title = "";
    if (!title) title = `Release ${version}`;
    title = title.replace(/^./, (c) => c.toUpperCase());

    let intro = "";
    const groups = [];
    let current = null;
    const addGroup = (groupHeading) => {
      current = { heading: groupHeading, bullets: [] };
      groups.push(current);
    };
    for (const raw of lines.slice(1)) {
      const line = raw.trim();
      if (!line) continue;
      const h3 = line.match(/^###\s+(.*)$/);
      if (h3) {
        const text = h3[1].replace(/^v?\d+\.\d+\.\d+\s*[—–-]?\s*/, "").trim();
        addGroup(text || "Changes");
        continue;
      }
      const bold = line.match(/^\*\*(.+?)\*\*\s*$/);
      if (bold) {
        addGroup(plain(bold[1]) || "Changes");
        continue;
      }
      const bullet = line.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        const text = plain(bullet[1]);
        if (!text) continue;
        if (filterDev && DEV_ONLY.test(text)) continue;
        if (!current) addGroup("Changes");
        current.bullets.push(text);
        continue;
      }
      if (!current && !intro) {
        const text = plain(line);
        if (filterDev && DEV_ONLY.test(text)) continue;
        intro = text;
      }
    }
    const cleaned = groups
      .map((g) => ({ heading: g.heading, bullets: maxBulletsPerGroup ? g.bullets.slice(0, maxBulletsPerGroup) : g.bullets }))
      .filter((g) => g.bullets.length > 0);
    if (!cleaned.length && !intro) continue;
    versions.push({ version, title, date, intro, groups: cleaned });
  }
  return versions;
}
