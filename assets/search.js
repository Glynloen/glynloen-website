/* Glynloen site search (2026-10-05). The button and styles are written into every page by
   tools/site_search.py; the index (assets/search-index.json) is built by the same tool.
   Runs entirely in the browser: no server, no outside service. */
(function () {
  "use strict";
  var btn = document.querySelector(".srch-btn");
  if (!btn || !window.fetch) return;

  // 404.html loads this script from /assets/ because it is served at any address; follow its lead.
  var tag = document.getElementById("search-js");
  var root = tag && tag.getAttribute("src").charAt(0) === "/" ? "/" : "";
  var TRY = ["bad faith", "appraisal", "business interruption", "receivership", "reinsurance", "case-mapping"];
  var STOP = { a: 1, an: 1, and: 1, the: 1, of: 1, in: 1, on: 1, to: 1, for: 1, or: 1, by: 1, with: 1, at: 1, is: 1, are: 1, be: 1 };
  var data = null, loading = null, dlg, input, body, foot, opener, active = -1, timer;
  var ALIAS = [];  // search-term list from the index (tools/site_search.py SYNONYMS), longest phrases first

  // Lower case, no accents or apostrophes. Short ampersand abbreviations become one word
  // ("E&O" -> "eando", "P&C" -> "pandc") so they never split into single letters.
  function norm(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[‘’']/g, "")
      .replace(/\b([a-z])\s*&\s*([a-z])\b/g, "$1and$2")
      .replace(/\b([a-z]{2,3})&([a-z]{2,3})\b/g, "$1and$2")
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function stem(w) { return w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w; }
  function sing(w) { return w.length > 3 && /s$/.test(w) ? w.replace(/(es|s)$/, "") : w; }
  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  // A typed word matches at the start of a word ("audit" finds "audits", "auditing");
  // three letters or fewer must match a whole word ("BI" no longer finds "billing").
  function hasTerm(text, t) {
    if (t.length > 3) return (" " + text).indexOf(" " + t) !== -1;
    var T = " " + text + " ";
    return T.indexOf(" " + t + " ") !== -1 || T.indexOf(" " + t + "s ") !== -1;
  }
  // A listed term or phrase matches whole words, plural allowed.
  function hasPhrase(text, p) {
    var T = " " + text + " ";
    return T.indexOf(" " + p + " ") !== -1 || T.indexOf(" " + p + "s ") !== -1 || T.indexOf(" " + p + "es ") !== -1;
  }

  function prepare(d) {
    d.pages.forEach(function (p) {
      p.nt = norm(p.t + " " + p.h1);
      p.nd = norm(p.d);
      p.s.forEach(function (s) {
        s.nh = norm(s.h);
        s.nb = s.b.map(norm);
      });
    });
    (d.syn || []).forEach(function (g) {
      var alts = g.a.concat(g.t || []), raw = alts.slice();
      var nalts = alts.map(norm).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      g.a.forEach(function (from) {
        var toks = norm(from).split(" ").filter(Boolean);
        if (toks.length) ALIAS.push({ toks: toks, alts: nalts, raw: raw });
      });
    });
    ALIAS.sort(function (x, y) { return y.toks.length - x.toks.length; });
    return d;
  }
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = fetch(root + "assets/search-index.json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { data = prepare(d); return data; })
        .catch(function (e) { loading = null; throw e; });
    }
    return loading;
  }

  // The query becomes a list of concepts. A concept is either one typed word, or a phrase from the
  // search-term list together with all its equivalents. Every concept must be found on a page.
  function parse(q) {
    var toks = norm(q).split(" ").filter(Boolean), out = [], i = 0;
    while (i < toks.length) {
      var hit = null;
      for (var k = 0; k < ALIAS.length && !hit; k++) {
        var a = ALIAS[k], n = a.toks.length;
        if (i + n > toks.length) continue;
        var ok = true;
        for (var j = 0; j < n && ok; j++) ok = sing(toks[i + j]) === sing(a.toks[j]);
        if (ok) hit = a;
      }
      if (hit) {
        out.push({ typed: toks.slice(i, i + hit.toks.length).join(" "), alts: hit.alts, raw: hit.raw });
        i += hit.toks.length;
      } else {
        var w = toks[i++];
        if (!STOP[w]) out.push({ term: stem(w) });
      }
    }
    return out;
  }
  // 1 = the words typed are on this text; .85 = only an equivalent is; 0 = neither.
  function factor(text, c) {
    if (!c.alts) return hasTerm(text, c.term) ? 1 : 0;
    if (hasPhrase(text, c.typed)) return 1;
    for (var i = 0; i < c.alts.length; i++) if (hasPhrase(text, c.alts[i])) return 0.85;
    return 0;
  }

  // Score: title or main heading 3, description or section heading 2, text 1 (the search-term audit's
  // weights), plus a little for each extra mention. Every concept must appear somewhere on the page.
  function search(q) {
    var cs = parse(q);
    if (!cs.length) return [];
    var phrase = norm(q), out = [];
    data.pages.forEach(function (p) {
      var score = 0, best = null, bestHits = -1;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i], w = 3 * factor(p.nt, c), n = 0;
        w = Math.max(w, 2 * factor(p.nd, c));
        p.s.forEach(function (s) {
          var f = factor(s.nh, c);
          if (f) { w = Math.max(w, 2 * f); n++; }
          s.nb.forEach(function (b) { var g = factor(b, c); if (g) { w = Math.max(w, g); n++; } });
        });
        if (!w) return;
        score += w + Math.min(n, 10) * 0.1;
      }
      if (cs.length > 1 && (hasTerm(p.nt, phrase) || hasTerm(p.nd, phrase))) score += 2;
      p.s.forEach(function (s) {
        s.nb.forEach(function (b, k) {
          var hits = 0;
          cs.forEach(function (c) { if (factor(b, c)) hits++; });
          if (cs.length > 1 && hasTerm(b, phrase)) hits += 1;
          if (hits > bestHits || (hits === bestHits && hits && s.b[k].length > 60 && best && best.text.length <= 60)) {
            bestHits = hits; best = { sec: s, text: s.b[k] };
          }
        });
      });
      out.push({ p: p, score: score, best: bestHits > 0 ? best : null });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 12);
  }

  // One pattern that finds, in the original page text, every word a result matched on.
  function marker(cs) {
    var parts = [];
    function rx(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s*&\s*/g, "\\s*&\\s*").replace(/[\s-]+/g, "[\\s\\-]+");
    }
    cs.forEach(function (c) {
      if (!c.alts) parts.push(rx(c.term) + (c.term.length > 3 ? "[\\w’'-]*" : "(?:e?s)?\\b"));
      else c.raw.forEach(function (r) { parts.push(rx(r) + "(?:e?s)?\\b"); });
    });
    return parts.length ? new RegExp("\\b(?:" + parts.join("|") + ")", "gi") : null;
  }
  function snippet(text, cs) {
    var re = marker(cs), at = -1, m;
    if (re) { m = re.exec(text); if (m) at = m.index; re.lastIndex = 0; }
    var from = 0, s = text;
    if (text.length > 190) {
      from = Math.max(0, at - 70);
      if (from > 0) from = text.indexOf(" ", from) + 1;
      s = text.slice(from, from + 180).replace(/\s\S*$/, "");
    }
    var html = "", last = 0;
    if (re) while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue; }
      html += esc(s.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
    html += esc(s.slice(last));
    return (from > 0 ? "…" : "") + html + (text.length > 190 && from + 180 < text.length ? "…" : "");
  }

  function render() {
    var q = input.value.trim();
    active = -1;
    if (!q) {
      body.innerHTML = '<p class="srch-note">Search every page of the site. Try:</p><ul class="srch-try">' +
        TRY.map(function (t) { return '<li><button type="button">' + esc(t) + "</button></li>"; }).join("") + "</ul>";
      foot.textContent = "";
      return;
    }
    var res = search(q), cs = parse(q);
    if (!res.length) {
      body.innerHTML = '<p class="srch-note" role="status">No pages match “' + esc(q) + '”. Try a broader word, or ' +
        '<a href="' + root + 'index.html#contact">get in touch</a> and ask us directly.</p>';
      foot.textContent = "";
      return;
    }
    body.innerHTML = '<p class="srch-note" role="status" style="margin-bottom:6px">' + res.length + (res.length === 1 ? " page" : " pages") + "</p>" +
      '<ul class="srch-res">' + res.map(function (r) {
        var href = root + (r.p.u || "index.html") + (r.best && r.best.sec.id ? "#" + r.best.sec.id : "");
        var h = r.best && r.best.sec.h && r.best.sec.h !== r.p.h1 ? '<span class="h">' + esc(r.best.sec.h) + "</span>" : "";
        var s = r.best ? snippet(r.best.text, cs) : esc(r.p.d);
        return '<li><a href="' + esc(href) + '"><span class="t">' + esc(r.p.t) + "</span>" + h + '<span class="s">' + s + "</span></a></li>";
      }).join("") + "</ul>";
    foot.textContent = "Use the arrow keys to move, Enter to open, Esc to close.";
  }

  function links() { return body.querySelectorAll(".srch-res a"); }
  function move(d) {
    var a = links();
    if (!a.length) return;
    if (active >= 0 && a[active]) a[active].classList.remove("on");
    active = (active + d + a.length) % a.length;
    a[active].classList.add("on");
    a[active].scrollIntoView({ block: "nearest" });
  }

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "srch";
    dlg.setAttribute("aria-label", "Search the site");
    dlg.innerHTML =
      '<div class="srch-top" role="search">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>' +
      '<input type="search" aria-label="Search the site" placeholder="Search the site" autocomplete="off" spellcheck="false" enterkeyhint="search">' +
      '<button type="button" class="srch-x" aria-label="Close search">Esc</button></div>' +
      '<div class="srch-body" aria-live="polite"></div><div class="srch-foot"></div>';
    document.body.appendChild(dlg);
    input = dlg.querySelector("input");
    body = dlg.querySelector(".srch-body");
    foot = dlg.querySelector(".srch-foot");
    dlg.querySelector(".srch-x").addEventListener("click", close);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) close();  // a click on the dimmed backdrop
      var t = e.target.closest(".srch-try button");
      if (t) { input.value = t.textContent; input.focus(); go(); }
      if (e.target.closest(".srch-res a")) close(true);
    });
    dlg.addEventListener("close", function () {
      document.documentElement.style.overflow = "";
      if (opener) opener.focus();
    });
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(go, 90); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var a = links();
        if (a.length) { close(true); location.href = a[active >= 0 ? active : 0].href; }
      }
    });
  }
  function go() {
    if (data) return render();
    body.innerHTML = '<p class="srch-note">Loading…</p>';
    load().then(render, function () {
      body.innerHTML = '<p class="srch-note" role="status">Search could not load. Please reload the page and try again.</p>';
    });
  }
  function open() {
    if (!dlg) build();
    if (dlg.open) return;
    opener = document.activeElement;
    document.documentElement.style.overflow = "hidden";
    dlg.showModal();
    input.focus();
    input.select();
    go();
  }
  function close(leaving) {
    if (leaving === true) opener = null;  // following a result: do not pull focus back to the header
    if (dlg && dlg.open) dlg.close();
  }

  btn.addEventListener("click", open);

  // Phones (601px and down): the bar has no room, so the open menu starts with a search row.
  var nav = document.getElementById("navlinks");
  if (nav) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "srch-menu";
    row.innerHTML = btn.innerHTML + "<span>Search the site</span>";
    nav.insertBefore(row, nav.firstChild);
    row.addEventListener("click", function () {
      var mb = document.getElementById("mb");
      nav.classList.remove("open");
      if (mb) { mb.setAttribute("aria-expanded", "false"); mb.focus(); }  // the search returns focus here when it closes
      open();
    });
  }
  document.addEventListener("keydown", function (e) {
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); }
    else if (e.key === "/" && !typing && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); open(); }
  });
  // Warm the index when the visitor shows intent, so results appear on the first keystroke.
  btn.addEventListener("pointerenter", function () { load().catch(function () {}); }, { once: true });
  btn.addEventListener("focus", function () { load().catch(function () {}); }, { once: true });
})();
