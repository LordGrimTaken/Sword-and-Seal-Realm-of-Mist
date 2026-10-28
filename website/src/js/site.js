/* Sword & Seal: shared behaviour. No dependencies. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  var cfg = window.SITE_CONFIG || {};
  root.classList.add("js");

  /* mobile nav */
  var toggle = doc.querySelector(".nav-toggle"), nav = doc.getElementById("site-nav");
  function setNav(open) { if (!toggle || !nav) return; toggle.setAttribute("aria-expanded", String(open)); nav.classList.toggle("open", open); }
  if (toggle && nav) {
    toggle.addEventListener("click", function () { setNav(toggle.getAttribute("aria-expanded") !== "true"); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { setNav(false); toggle.focus(); } });
    nav.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a")) setNav(false); });
  }

  /* hero parallax (scroll + pointer), skipped for reduced motion */
  var hero = doc.querySelector(".hero");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (hero && !(reduce && reduce.matches)) {
    var ticking = false, px = 0;
    var apply = function () {
      ticking = false;
      var y = Math.max(0, Math.min(window.scrollY, hero.offsetHeight));
      hero.style.setProperty("--py", String(y));
      hero.style.setProperty("--px", px.toFixed(3));
    };
    var req = function () { if (!ticking) { ticking = true; window.requestAnimationFrame(apply); } };
    window.addEventListener("scroll", req, { passive: true });
    hero.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      var r = hero.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; req();
    }, { passive: true });
    apply();
  }

  /* live server status badge: GET <healthUrl> -> {ok, players, version}; fail-soft */
  var badges = doc.querySelectorAll("[data-status]");
  function paint(state, text, title) {
    for (var i = 0; i < badges.length; i++) {
      badges[i].setAttribute("data-state", state);
      var t = badges[i].querySelector("[data-status-text]"); if (t) t.textContent = text;
      if (title) badges[i].setAttribute("title", title); else badges[i].removeAttribute("title");
    }
  }
  function poll() {
    if (!badges.length || !cfg.healthUrl || !window.fetch) { paint("offline", "Servers offline"); return; }
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    fetch(cfg.healthUrl, { cache: "no-store", mode: "cors", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        if (!j || j.ok !== true) throw new Error("not ok");
        var n = typeof j.players === "number" ? j.players : null;
        paint("online", n === null ? "Servers online" : "Servers online: " + n + (n === 1 ? " player" : " players"), j.version ? "Server version " + j.version : "");
      })
      .catch(function () { clearTimeout(timer); paint("offline", "Servers offline", "Could not reach the game server right now."); });
  }
  poll();
  setInterval(function () { if (!doc.hidden) poll(); }, 60000);
})();
