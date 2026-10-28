/* News page: render <newsUrl> (array of {id,title,date,body}) with a cached fallback; the static seed from CHANGELOG.md stays if both fail. */
(function () {
  "use strict";
  var cfg = window.SITE_CONFIG || {};
  var list = document.getElementById("news-list"), state = document.getElementById("news-state");
  if (!list || !cfg.newsUrl || !window.fetch) return;
  var KEY = "ss_news_v1";
  function store(get, val) { try { return get ? JSON.parse(localStorage.getItem(KEY) || "null") : localStorage.setItem(KEY, JSON.stringify(val)); } catch (e) { return null; } }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function body(text) {
    var wrap = el("div", "post-body"), ul = null;
    String(text || "").split(/\n/).forEach(function (line) {
      var t = line.replace(/\s+$/, "");
      if (/^\s*-\s+/.test(t)) { if (!ul) { ul = el("ul"); wrap.appendChild(ul); } ul.appendChild(el("li", null, t.replace(/^\s*-\s+/, ""))); }
      else if (t.trim()) { ul = null; wrap.appendChild(el("p", null, t.trim())); }
      else ul = null;
    });
    return wrap;
  }
  function render(items) {
    var sorted = items.filter(function (n) { return n && n.title; }).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    if (!sorted.length) return false;
    list.textContent = "";
    sorted.forEach(function (n) {
      var art = el("article", "post"); if (n.id) art.id = "p-" + String(n.id).replace(/[^\w-]/g, "-");
      var p = el("p", "eyebrow", n.date ? "" : "Notice"); if (n.date) { var tm = el("time", null, String(n.date).slice(0, 10)); tm.setAttribute("dateTime", String(n.date).slice(0, 10)); p.appendChild(tm); }
      art.appendChild(p); art.appendChild(el("h2", null, String(n.title))); art.appendChild(body(n.body)); list.appendChild(art);
    });
    return true;
  }
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
  fetch(cfg.newsUrl, { cache: "no-cache", mode: "cors", credentials: "omit", signal: ctl ? ctl.signal : undefined })
    .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
    .then(function (j) {
      clearTimeout(timer);
      if (!Array.isArray(j) || !render(j)) throw new Error("empty");
      store(false, j); if (state) state.textContent = "Live from the notice board.";
    })
    .catch(function () {
      clearTimeout(timer);
      var cached = store(true);
      if (Array.isArray(cached) && render(cached)) { if (state) state.textContent = "The notice board is unreachable. Showing the last news this browser saved."; }
      else if (state) state.textContent = "The notice board is unreachable. Showing release notes bundled with this site.";
    });
})();
