export const STYLES = `
:root {
  --ink: #16181d;
  --muted: #5f636b;
  --faint: #8b9098;
  --rule: #d7d9dd;
  --paper: #ffffff;
  --wash: #f6f7f8;
  --warn: #a1400b;
  --warn-wash: #fdf3ec;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 400 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
a { color: inherit; }
h1, h2, h3 { font-weight: 600; margin: 0; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }

.page-head { border-bottom: 1px solid var(--rule); padding: 26px 0 16px; }
.page-head h1 { font-size: 23px; letter-spacing: -0.01em; }
.page-head .sub { color: var(--muted); font-size: 14px; margin-top: 4px; }
.stamp { color: var(--faint); font-size: 12.5px; margin-top: 10px; }
.privacy {
  margin-top: 12px; padding: 9px 12px; border: 1px solid var(--rule);
  background: var(--wash); color: var(--muted); font-size: 12.5px; border-radius: 3px;
}

.tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--rule); padding: 0; margin: 0; list-style: none; }
.tabs a {
  display: block; padding: 11px 2px; font-size: 14px; color: var(--muted);
  text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tabs a.is-current { color: var(--ink); font-weight: 600; border-bottom-color: var(--ink); }

.screen { padding: 22px 0 60px; }
html[data-js="on"] .screen { display: none; }
html[data-js="on"] .screen.is-active { display: block; }

.cols { display: flex; gap: 34px; align-items: flex-start; }
.rail { flex: 0 0 200px; position: sticky; top: 16px; }
.rail h3 {
  font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--faint); margin: 0 0 8px;
}
.rail section + section { margin-top: 22px; }
.tally { list-style: none; margin: 0; padding: 0; font-size: 13.5px; }
.tally li { display: flex; justify-content: space-between; padding: 3px 0; color: var(--muted); }
.tally li b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font: inherit; font-size: 13px; line-height: 1.3; cursor: pointer;
  border: 1px solid var(--rule); background: var(--paper); color: var(--muted);
  border-radius: 3px; padding: 4px 9px; text-align: left;
}
.chip[aria-pressed="true"] { border-color: var(--ink); background: var(--ink); color: var(--paper); }
.content { flex: 1 1 auto; min-width: 0; }

.bucket + .bucket { margin-top: 30px; }
.bucket-head {
  display: flex; align-items: baseline; gap: 10px;
  border-bottom: 1px solid var(--ink); padding-bottom: 5px; margin-bottom: 2px;
}
.bucket-head h2 { font-size: 15px; }
.bucket-head .count { color: var(--faint); font-size: 12.5px; }
.bucket-note { color: var(--muted); font-size: 12.5px; margin: 8px 0 0; }

.card { display: flex; gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--rule); }
.card-main { flex: 1 1 auto; min-width: 0; }
.card-title { font-size: 15.5px; font-weight: 600; text-decoration: none; }
.card-title:hover { text-decoration: underline; }
.card-where { color: var(--muted); font-size: 13.5px; margin-top: 2px; }
.card-facts { color: var(--muted); font-size: 13.5px; margin-top: 4px; }
.card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 7px; font-size: 12.5px; }
.card-side { flex: 0 0 160px; text-align: right; }
.price { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.expenses { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.fit { display: inline-block; margin-top: 7px; font-size: 12.5px; font-weight: 600; border: 1px solid var(--ink); border-radius: 3px; padding: 2px 8px; }
.fit[data-fit-rank="3"] { background: var(--ink); color: var(--paper); }
.detail-link { display: block; margin-top: 6px; font-size: 12.5px; color: var(--muted); }

.tag { color: var(--muted); }
.badge {
  border: 1px solid var(--rule); border-radius: 3px; padding: 1px 7px;
  color: var(--faint); cursor: help;
}
.badge.has-warning { border-color: var(--warn); color: var(--warn); background: var(--warn-wash); }
.out { color: var(--muted); text-decoration: none; }
.out:hover { text-decoration: underline; }

.archived-head { margin-top: 40px; border-top: 1px solid var(--rule); padding-top: 16px; }
.archived { opacity: .58; }
.archived-row {
  display: flex; gap: 14px; justify-content: space-between;
  padding: 6px 0; border-bottom: 1px solid var(--rule); font-size: 13.5px;
}
.archived-row .nb { color: var(--muted); flex: 0 0 auto; }
.archived-row .p { font-variant-numeric: tabular-nums; flex: 0 0 auto; }

.back { display: inline-block; font-size: 13.5px; color: var(--muted); margin-bottom: 16px; }
.detail + .detail { margin-top: 56px; border-top: 3px double var(--rule); padding-top: 34px; }
.detail-head { display: flex; gap: 24px; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--rule); padding-bottom: 14px; }
.detail-head h2 { font-size: 20px; letter-spacing: -0.01em; }
.detail-cols { display: flex; gap: 34px; align-items: flex-start; margin-top: 20px; }
.detail-main { flex: 1 1 auto; min-width: 0; }
.detail-side { flex: 0 0 300px; }
.block { margin-bottom: 26px; }
.block h3 {
  font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--faint); border-bottom: 1px solid var(--rule); padding-bottom: 5px; margin-bottom: 10px;
}
.block ul { list-style: none; margin: 0; padding: 0; }
.block li { padding: 4px 0; font-size: 14px; }
.block li .mark { color: var(--faint); display: inline-block; width: 18px; }
.check { border-left: 2px solid var(--warn); background: var(--warn-wash); padding: 9px 12px; margin-bottom: 8px; }
.check b { display: block; font-size: 14px; }
.check span { display: block; color: var(--muted); font-size: 13.5px; margin-top: 2px; }
.quote { font-size: 14px; padding: 4px 0 4px 12px; border-left: 2px solid var(--rule); margin-bottom: 6px; }
.disclaimer { color: var(--faint); font-size: 12.5px; margin-top: 10px; }
.crit { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 13.5px; border-bottom: 1px solid var(--rule); }
.crit .o { flex: 0 0 auto; color: var(--muted); }
.crit .o[data-outcome="pass"] { color: var(--ink); font-weight: 600; }
.crit .o[data-outcome="unknown"] { font-style: italic; color: var(--faint); }
.hist { font-size: 13.5px; padding: 5px 0; border-bottom: 1px solid var(--rule); }
.hist .when { color: var(--faint); font-size: 12.5px; }
.readonly-note { color: var(--faint); font-size: 12.5px; margin-top: 22px; }

.legend { display: flex; flex-wrap: wrap; gap: 18px; margin: 16px 0 20px; font-size: 12.5px; color: var(--muted); }
.legend span.key { display: inline-block; vertical-align: middle; margin-right: 6px; }
.key-bar { width: 22px; height: 6px; border: 1px solid var(--ink); background: var(--wash); }
.key-dot { width: 10px; height: 10px; border: 1px solid var(--ink); border-radius: 50%; }
.key-dot.filled { background: var(--ink); }
.key-line { width: 2px; height: 13px; background: var(--warn); }

.chart { position: relative; border-top: 1px solid var(--rule); }
.chart-row { display: flex; align-items: stretch; border-bottom: 1px solid var(--rule); }
.chart-label { flex: 0 0 150px; padding: 8px 12px 8px 0; }
.chart-label b { display: block; font-size: 13.5px; font-weight: 600; }
.chart-label span { color: var(--faint); font-size: 12px; }
.chart-plot { position: relative; flex: 1 1 auto; height: 52px; min-width: 0; }
.chart-bar {
  box-sizing: border-box; position: absolute; top: 23px; height: 6px;
  border: 1px solid var(--ink); background: var(--wash);
}
.dot {
  box-sizing: border-box; position: absolute; width: 11px; height: 11px;
  margin-left: -5.5px; border: 1px solid var(--ink); border-radius: 50%;
  background: var(--paper); cursor: help;
}
.dot.great { top: 6px; background: var(--ink); }
.dot.other { top: 35px; }
.chart-range { flex: 0 0 130px; text-align: right; padding: 8px 0; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.ceiling {
  box-sizing: border-box; position: absolute; top: 0; bottom: 22px; width: 0;
  border-left: 2px dashed var(--warn); margin-left: -1px; pointer-events: none;
}
.ceiling b {
  position: absolute; top: -17px; left: 4px; white-space: nowrap;
  font-size: 11.5px; font-weight: 600; color: var(--warn);
}
.axis { display: flex; }
.axis .spacer { flex: 0 0 150px; }
.axis .ticks { flex: 1 1 auto; display: flex; justify-content: space-between; padding-top: 5px; color: var(--faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.axis .tail { flex: 0 0 130px; }
.chart-scroll { overflow-x: auto; }
.chart-inner { min-width: 620px; position: relative; padding-top: 20px; }

.readouts { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 28px; }
.readout { flex: 1 1 240px; border: 1px solid var(--rule); border-radius: 3px; padding: 12px 14px; }
.readout b { display: block; font-size: 14.5px; margin-bottom: 4px; }
.readout span { color: var(--muted); font-size: 13.5px; }
.excluded { margin-top: 20px; padding: 10px 12px; border: 1px solid var(--rule); background: var(--wash); color: var(--muted); font-size: 13px; border-radius: 3px; }
.empty { color: var(--faint); font-style: italic; padding: 14px 0; }

@media (max-width: 860px) {
  .cols, .detail-cols { display: block; }
  .rail, .detail-side { position: static; margin-bottom: 26px; }
  .card { display: block; }
  .card-side { text-align: left; margin-top: 8px; }
}

@media print {
  .rail, .tabs, .detail-link, .back { display: none !important; }
  html[data-js="on"] .screen, .screen { display: block !important; page-break-before: always; }
  html[data-js="on"] .screen:first-of-type, .screen:first-of-type { page-break-before: avoid; }
  #screen-detail { display: none !important; }
  body { font-size: 11pt; }
  .cols { display: block; }
  .chart-scroll { overflow: visible; }
  .card, .chart-row, .readout { page-break-inside: avoid; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; color: #5f636b; word-break: break-all; }
  .badge { cursor: auto; }
}
`;

export const CLIENT_SCRIPT = [
  '"use strict";',
  '(function () {',
  '  var root = document.documentElement;',
  '  root.setAttribute("data-js", "on");',
  '',
  '  var MODEL = {};',
  '  try { MODEL = JSON.parse(document.getElementById("tracker-view").textContent); } catch (e) { MODEL = {}; }',
  '  var LISTINGS = MODEL.listings || [];',
  '',
  '  var SORTS = ["fit", "price", "space", "updated"];',
  '  var STATUSES = ["all", "watching", "great"];',
  '  var state = { route: "list", place: null, sort: "fit", status: "all", nb: "all" };',
  '',
  '  function readHash() {',
  '    var raw = (location.hash || "").replace(/^#/, "");',
  '    var parts = raw.split("?");',
  '    var path = parts[0] || "list";',
  '    var query = parts[1] || "";',
  '    if (path.indexOf("place/") === 0) { state.route = "place"; state.place = decodeURIComponent(path.slice(6)); }',
  '    else if (path === "budget") { state.route = "budget"; state.place = null; }',
  '    else { state.route = "list"; state.place = null; }',
  '    var next = { sort: "fit", status: "all", nb: "all" };',
  '    query.split("&").forEach(function (pair) {',
  '      if (!pair) return;',
  '      var bits = pair.split("=");',
  '      var key = decodeURIComponent(bits[0]);',
  '      var value = decodeURIComponent((bits[1] || "").replace(/\\+/g, " "));',
  '      if (key === "sort" && SORTS.indexOf(value) >= 0) next.sort = value;',
  '      if (key === "status" && STATUSES.indexOf(value) >= 0) next.status = value;',
  '      if (key === "nb" && value) next.nb = value;',
  '    });',
  '    state.sort = next.sort; state.status = next.status; state.nb = next.nb;',
  '  }',
  '',
  '  function writeHash() {',
  '    var path = state.route === "place" ? "place/" + encodeURIComponent(state.place) : state.route;',
  '    var query = [];',
  '    if (state.sort !== "fit") query.push("sort=" + encodeURIComponent(state.sort));',
  '    if (state.status !== "all") query.push("status=" + encodeURIComponent(state.status));',
  '    if (state.nb !== "all") query.push("nb=" + encodeURIComponent(state.nb));',
  '    var hash = "#" + path + (query.length ? "?" + query.join("&") : "");',
  '    if (location.hash !== hash) { history.replaceState(null, "", hash); }',
  '  }',
  '',
  '  function num(node, key) {',
  '    var raw = node.getAttribute(key);',
  '    return raw === null || raw === "" ? null : Number(raw);',
  '  }',
  '',
  '  function comparator(mode) {',
  '    return function (a, b) {',
  '      var result = 0;',
  '      if (mode === "price") {',
  '        result = nullLast(num(a, "data-price"), num(b, "data-price"), 1);',
  '      } else if (mode === "space") {',
  '        result = nullLast(num(a, "data-area"), num(b, "data-area"), -1);',
  '      } else if (mode === "updated") {',
  '        var au = a.getAttribute("data-updated") || "";',
  '        var bu = b.getAttribute("data-updated") || "";',
  '        result = bu < au ? -1 : bu > au ? 1 : 0;',
  '      } else {',
  '        result = (num(b, "data-score") || 0) - (num(a, "data-score") || 0);',
  '        if (result === 0) result = nullLast(num(a, "data-price"), num(b, "data-price"), 1);',
  '      }',
  '      if (result !== 0) return result;',
  '      var ai = a.getAttribute("data-id"), bi = b.getAttribute("data-id");',
  '      return ai < bi ? -1 : ai > bi ? 1 : 0;',
  '    };',
  '  }',
  '',
  '  function nullLast(a, b, direction) {',
  '    if (a === null && b === null) return 0;',
  '    if (a === null) return 1;',
  '    if (b === null) return -1;',
  '    return (a - b) * direction;',
  '  }',
  '',
  '  function visible(node) {',
  '    if (state.nb !== "all" && node.getAttribute("data-nb") !== state.nb) return false;',
  '    if (state.status === "watching" && node.getAttribute("data-state") !== "watching") return false;',
  '    if (state.status === "great" && node.getAttribute("data-fit-rank") !== "3") return false;',
  '    return true;',
  '  }',
  '',
  '  function applyList() {',
  '    var tally = { 3: 0, 2: 0, 1: 0, 0: 0 };',
  '    var buckets = document.querySelectorAll("#screen-list .bucket");',
  '    Array.prototype.forEach.call(buckets, function (bucket) {',
  '      var unranked = bucket.hasAttribute("data-foreign");',
  '      var body = bucket.querySelector(".bucket-body");',
  '      var cards = Array.prototype.slice.call(body.querySelectorAll(".card"));',
  '      var shown = 0;',
  '      cards.forEach(function (card) {',
  '        var ok = visible(card);',
  '        card.hidden = !ok;',
  '        if (ok) {',
  '          shown += 1;',
  '          // The foreign-currency group is unranked, so it never feeds the fit counts.',
  '          var rank = card.getAttribute("data-fit-rank");',
  '          if (!unranked && Object.prototype.hasOwnProperty.call(tally, rank)) tally[rank] += 1;',
  '        }',
  '      });',
  '      cards.sort(comparator(state.sort)).forEach(function (card) { body.appendChild(card); });',
  '      bucket.hidden = shown === 0;',
  '      var count = bucket.querySelector(".count");',
  '      if (count) count.textContent = shown === 1 ? "1 place" : shown + " places";',
  '    });',
  '    Array.prototype.forEach.call(document.querySelectorAll("[data-tally]"), function (node) {',
  '      var rank = node.getAttribute("data-tally");',
  '      node.textContent = String(tally[rank] || 0);',
  '    });',
  '    var none = document.getElementById("list-empty");',
  '    if (none) none.hidden = tally[3] + tally[2] + tally[1] + tally[0] > 0 || hasVisibleForeign();',
  '  }',
  '',
  '  function hasVisibleForeign() {',
  '    var foreign = document.querySelectorAll("#screen-list .bucket[data-foreign] .card");',
  '    for (var i = 0; i < foreign.length; i += 1) { if (!foreign[i].hidden) return true; }',
  '    return false;',
  '  }',
  '',
  '  function applyChips() {',
  '    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (chip) {',
  '      var group = chip.getAttribute("data-group");',
  '      chip.setAttribute("aria-pressed", state[group] === chip.getAttribute("data-value") ? "true" : "false");',
  '    });',
  '  }',
  '',
  '  function applyRoute() {',
  '    var target = state.route === "place" ? "screen-detail" : state.route === "budget" ? "screen-budget" : "screen-list";',
  '    Array.prototype.forEach.call(document.querySelectorAll(".screen"), function (screen) {',
  '      screen.classList.toggle("is-active", screen.id === target);',
  '    });',
  '    Array.prototype.forEach.call(document.querySelectorAll(".tabs a"), function (link) {',
  '      link.classList.toggle("is-current", link.getAttribute("data-route") === (state.route === "place" ? "list" : state.route));',
  '    });',
  '    if (state.route === "place") {',
  '      var found = false;',
  '      Array.prototype.forEach.call(document.querySelectorAll(".detail"), function (node) {',
  '        var match = node.getAttribute("data-id") === state.place;',
  '        node.hidden = !match;',
  '        if (match) found = true;',
  '      });',
  '      if (!found) { state.route = "list"; return applyRoute(); }',
  '    }',
  '    window.scrollTo(0, 0);',
  '  }',
  '',
  '  function render() { applyChips(); applyList(); applyRoute(); }',
  '',
  '  document.addEventListener("click", function (event) {',
  '    var chip = event.target.closest ? event.target.closest(".chip") : null;',
  '    if (!chip) return;',
  '    event.preventDefault();',
  '    state[chip.getAttribute("data-group")] = chip.getAttribute("data-value");',
  '    writeHash();',
  '    render();',
  '  });',
  '',
  '  window.addEventListener("hashchange", function () { readHash(); render(); });',
  '',
  '  readHash();',
  '  render();',
  '  if (LISTINGS.length === 0) { root.setAttribute("data-empty", "true"); }',
  '}());'
].join("\n");
