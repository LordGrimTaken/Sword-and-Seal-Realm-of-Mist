/* Server status page: polls the same health endpoint the launcher and the badge use. No dependencies. */
(function () {
  "use strict";
  var cfg = window.SITE_CONFIG || {};
  var card = document.getElementById("status-card");
  if (!card) return;

  var label = document.getElementById("status-label");
  var detail = document.getElementById("status-detail");
  var players = document.getElementById("status-players");
  var latency = document.getElementById("status-latency");
  var version = document.getElementById("status-version");
  var checked = document.getElementById("status-checked");
  var bars = document.getElementById("status-bars");
  var note = document.getElementById("status-history-note");

  var MAX_SAMPLES = 40;
  var POLL_MS = 15000;
  var history = [];
  var started = 0;

  function clockText(date) {
    try {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) {
      return date.toISOString().slice(11, 19);
    }
  }

  function paint(state, heading, sub) {
    card.setAttribute("data-state", state);
    label.textContent = heading;
    detail.textContent = sub;
  }

  function barHeight(sample) {
    if (!sample.ok) return 100;
    return Math.max(10, Math.min(95, Math.round(sample.ms / 4) + 10));
  }

  function renderBars() {
    bars.textContent = "";
    for (var i = 0; i < history.length; i++) {
      var s = history[i];
      var bar = document.createElement("span");
      bar.className = "status-bar" + (s.ok ? "" : " bad");
      bar.style.height = barHeight(s) + "%";
      bar.title = (s.ok ? s.ms + " ms, " + s.playersText : "no answer") + " at " + s.at;
      bars.appendChild(bar);
    }
    var okCount = 0;
    for (var j = 0; j < history.length; j++) if (history[j].ok) okCount++;
    note.textContent = history.length === 0
      ? "No checks yet."
      : history.length + (history.length === 1 ? " check" : " checks") + " since this page opened: " +
        okCount + " answered, " + (history.length - okCount) + " did not. The bar on the right is the newest.";
  }

  function record(sample) {
    sample.at = clockText(new Date());
    history.push(sample);
    if (history.length > MAX_SAMPLES) history.shift();
    renderBars();
  }

  function check() {
    if (document.hidden) return;
    if (!cfg.healthUrl || !window.fetch) {
      paint("offline", "Cannot check from here", "This browser cannot make the request, so the status is unknown.");
      return;
    }
    var startedAt = window.performance && performance.now ? performance.now() : Date.now();
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 6000);
    fetch(cfg.healthUrl, { cache: "no-store", mode: "cors", credentials: "omit", signal: controller ? controller.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (j) {
        clearTimeout(timer);
        if (!j || j.ok !== true) throw new Error("not ok");
        var now = window.performance && performance.now ? performance.now() : Date.now();
        var ms = Math.max(1, Math.round(now - startedAt));
        var n = typeof j.players === "number" ? j.players : null;
        var playersText = n === null ? "players unknown" : n + (n === 1 ? " player" : " players");
        paint("online", "The server is online", playersText.charAt(0).toUpperCase() + playersText.slice(1) + ", answering in " + ms + " ms.");
        players.textContent = n === null ? "\u2014" : String(n);
        latency.textContent = ms + " ms";
        version.textContent = j.version ? String(j.version) : "\u2014";
        checked.textContent = clockText(new Date());
        record({ ok: true, ms: ms, playersText: playersText });
      })
      .catch(function () {
        clearTimeout(timer);
        paint("offline", "The server did not answer", "That is either maintenance, a restart, or your network. It retries automatically.");
        players.textContent = "\u2014";
        latency.textContent = "\u2014";
        version.textContent = "\u2014";
        checked.textContent = clockText(new Date());
        record({ ok: false, ms: null, playersText: "no answer" });
      });
  }

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce && reduce.matches) card.classList.add("no-motion");

  check();
  started = setInterval(function () { check(); }, POLL_MS);
  window.addEventListener("pagehide", function () { clearInterval(started); });
})();
