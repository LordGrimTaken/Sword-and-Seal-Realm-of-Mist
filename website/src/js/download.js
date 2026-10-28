/* Download page: OS detection, release metadata (latest.json) with graceful fallback. */
(function () {
  "use strict";
  var cfg = window.SITE_CONFIG || {};
  var dl = cfg.downloads || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* 1. detect OS */
  function detect() {
    var ua = navigator.userAgent || "";
    var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var s = (plat + " " + ua).toLowerCase();
    if (/android|iphone|ipad|ipod|cros/.test(s)) return "mobile";
    if (/win/.test(plat.toLowerCase()) || /windows/.test(s)) return "win";
    if (/mac/.test(plat.toLowerCase()) || /macintosh|mac os/.test(s)) return "mac";
    if (/linux|x11|ubuntu|fedora|debian/.test(s)) return "linux";
    return "unknown";
  }
  var os = detect();
  var names = { win: "Windows", mac: "macOS", linux: "Linux" };
  var banner = $("#os-detected");
  if (names[os]) {
    var card = $('[data-os="' + os + '"]');
    if (card) card.classList.add("is-match");
    if (banner) banner.textContent = "We think you are on " + names[os] + ". Your download is highlighted below.";
    var order = $("#dl-grid");
    if (card && order && window.matchMedia && window.matchMedia("(max-width: 859px)").matches) order.insertBefore(card, order.firstChild);
    var t = $('[data-os-tab="' + os + '"]'); if (t) t.click();
  } else if (banner) {
    banner.textContent = os === "mobile" ? "The launcher is for desktop computers. Open this page on Windows, macOS or Linux to download it." : "Pick the download for your system below.";
  }

  /* 2. release metadata */
  var root = $("#release");
  function human(n) { if (!n) return ""; var u = ["B", "KB", "MB", "GB"], i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + " " + u[i]; }
  function setText(sel, v) { var el = $(sel); if (el) el.textContent = v; }
  function soon(reason) {
    if (root) root.setAttribute("data-release-state", "soon");
    document.querySelectorAll("[data-dl]").forEach(function (a) {
      a.setAttribute("aria-disabled", "true"); a.removeAttribute("href"); a.setAttribute("role", "link");
      a.addEventListener("click", function (e) { e.preventDefault(); });
      var l = a.querySelector("[data-dl-label]"); if (l) l.textContent = "Coming soon";
    });
    ["win", "mac", "linux"].forEach(function (k) { setText('[data-meta="' + k + '-size"]', "Not yet published"); setText('[data-meta="' + k + '-sha"]', "Not yet published"); });
    setText("#release-version", "First public build coming soon");
    setText("#release-date", "");
    if (reason && window.console && console.info) console.info("[release] " + reason);
  }
  function ready(j) {
    if (root) root.setAttribute("data-release-state", "ready");
    setText("#release-version", "Launcher " + j.version);
    if (j.releasedAt) { var d = new Date(j.releasedAt); if (!isNaN(d)) setText("#release-date", "Released " + d.toISOString().slice(0, 10)); }
    ["win", "mac", "linux"].forEach(function (k) {
      var f = j.files && j.files[k];
      var a = $('[data-dl="' + k + '"]');
      if (!f) { if (a) { a.setAttribute("aria-disabled", "true"); a.removeAttribute("href"); var l = a.querySelector("[data-dl-label]"); if (l) l.textContent = "Not in this release"; } return; }
      if (f.url && a && /^https:\/\//.test(f.url)) a.setAttribute("href", f.url);
      setText('[data-meta="' + k + '-size"]', human(f.size) || "Unknown");
      setText('[data-meta="' + k + '-sha"]', f.sha256 || "Unknown"); var hs = $('[data-meta="' + k + '-sha"]'); if (hs && f.sha256) hs.classList.add("is-hex");
      var f2 = $('[data-sha-file="' + k + '"]'); if (f2 && f.url) f2.textContent = f.url.split("/").pop();
      var sh = $('[data-sha-value="' + k + '"]'); if (sh && f.sha256) sh.textContent = f.sha256;
    });
    ["mac_arm64", "mac_x64"].forEach(function (k) {
      var f = j.files && j.files[k]; var el = $('[data-extra="' + k + '"]');
      if (f && f.url && /^https:\/\//.test(f.url) && el) { el.setAttribute("href", f.url); el.hidden = false; var n = $("[data-extra-note]"); if (n) n.hidden = false; }
    });
  }
  if (!window.fetch || !dl.latestJson) { soon("fetch unavailable"); return; }
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
  fetch(dl.latestJson, { cache: "no-cache", mode: "cors", credentials: "omit", signal: ctl ? ctl.signal : undefined })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (j) { clearTimeout(timer); if (!j || !j.version || !j.files) throw new Error("unexpected shape"); ready(j); })
    .catch(function (e) { clearTimeout(timer); soon(String(e && e.message || e)); });

  /* 3. checksum tabs */
  var tabs = document.querySelectorAll("[data-os-tab]");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { var on = t === tab; t.setAttribute("aria-selected", String(on)); t.setAttribute("tabindex", on ? "0" : "-1"); });
      document.querySelectorAll("[data-os-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-os-panel") !== tab.getAttribute("data-os-tab"); });
    });
    tab.addEventListener("keydown", function (e) {
      var list = Array.prototype.slice.call(tabs), i = list.indexOf(tab), n = null;
      if (e.key === "ArrowRight") n = list[(i + 1) % list.length]; else if (e.key === "ArrowLeft") n = list[(i - 1 + list.length) % list.length];
      if (n) { e.preventDefault(); n.focus(); n.click(); }
    });
  });
})();
