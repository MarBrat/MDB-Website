// "Try it now" on the product page of MDB B2B Check. The browser calls the app directly
// (POST https://b2b.mdb-group.info/api/v1/check_vat_id); nothing goes through this website.
// The result is built with DOM nodes and textContent only, never from HTML in the answer.
(function () {
  var API = "https://b2b.mdb-group.info/api/v1/check_vat_id";
  // Fixed words for the result (concept stage 2, "Design und Mockups"); always a word, never only a colour.
  var WORDS = {
    valid: ["Valid", "Gültig"],
    invalid: ["Not valid", "Ungültig"],
    unavailable: ["Could not be checked", "Nicht prüfbar"],
    format_error: ["Format error", "Formatfehler"],
    unsupported: ["Not supported", "Nicht unterstützt"]
  };
  var TEXT = {
    empty: ["Enter a VAT ID or Swiss UID.", "Geben Sie eine USt-IdNr. oder Schweizer UID ein."],
    unavailableNote: ["This says nothing about the number. Try again later.", "Das sagt nichts über die Nummer. Bitte später nochmals versuchen."],
    unreachable: ["The check service could not be reached. Please try again.", "Der Prüfdienst ist nicht erreichbar. Bitte nochmals versuchen."],
    limit: ["Too many checks from your connection. Please wait 10 minutes.", "Zu viele Prüfungen von Ihrer Verbindung. Bitte 10 Minuten warten."],
    origin: ["The check service does not accept requests from this page. Use the web check at b2b.mdb-group.info.", "Der Prüfdienst nimmt von dieser Seite keine Anfragen an. Bitte die Web-Prüfung unter b2b.mdb-group.info nutzen."],
    cached: [" (from cache)", " (aus dem Zwischenspeicher)"],
    badInput: ["This input cannot be checked. Please enter one VAT ID or Swiss UID.", "Diese Eingabe lässt sich nicht prüfen. Bitte eine USt-IdNr. oder Schweizer UID eingeben."],
    source: ["Source", "Quelle"],
    checkYourself: ["Check it yourself", "Selbst nachprüfen"],
    steps: ["How it was checked", "So wurde geprüft"],
    appText: ["", "Texte der App auf Englisch."]
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  // Both languages; the stylesheet shows the one chosen with the EN/DE switch.
  function both(pair, tag) {
    var f = document.createDocumentFragment();
    var en = el(tag || "span", null, pair[0]);
    en.setAttribute("lang", "en");
    var de = el(tag || "span", null, pair[1]);
    de.setAttribute("lang", "de");
    if (pair[0]) f.appendChild(en);
    if (pair[1]) f.appendChild(de);
    return f;
  }
  function time(iso) {
    return String(iso || "").replace("T", " ").replace(/\.\d+Z$|Z$/, "") + " UTC";
  }

  function render(out, data) {
    out.textContent = "";
    var head = el("div", "res-head");
    var num = el("span", "res-num", (data.display || data.input || "") + (data.country_name ? " · " + data.country_name : ""));
    var mark = el("span", "mark " + (WORDS[data.status] ? data.status : "unavailable"));
    mark.appendChild(both(WORDS[data.status] || WORDS.unavailable));
    head.appendChild(num);
    head.appendChild(mark);
    out.appendChild(head);
    if (data.name) out.appendChild(el("p", "res-name", data.name));
    if (data.address) out.appendChild(el("p", "res-addr", data.address));
    if (data.status === "unavailable") {
      var u = el("p", "res-note");
      u.appendChild(both(TEXT.unavailableNote));
      out.appendChild(u);
    }
    var notes = [];
    if (data.message && data.status !== "valid" && data.status !== "invalid") notes.push(data.message);
    if (data.details_note) notes.push(data.details_note);
    if (notes.length) out.appendChild(el("p", "res-note", notes.join(" ")));
    if (data.source) {
      var s = el("p", "res-src");
      s.appendChild(both(TEXT.source));
      s.appendChild(document.createTextNode(": " + data.source.name + " · " + time(data.source.checked_at)));
      // From the app's 24-hour cache: the time stays that of the original lookup, as on the app's own page.
      if (data.cached) s.appendChild(both(TEXT.cached));
      out.appendChild(s);
    }
    var how = data.how_checked || {};
    (how.check_yourself || []).forEach(function (c) {
      if (!/^https:\/\//.test(c.url || "")) return;
      var p = el("p", "res-src");
      p.appendChild(both(TEXT.checkYourself));
      p.appendChild(document.createTextNode(": "));
      var a = el("a", null, c.source || c.url);
      a.href = c.url;
      a.target = "_blank";
      a.rel = "noopener";
      p.appendChild(a);
      if (c.how) p.appendChild(document.createTextNode(" – " + c.how));
      out.appendChild(p);
    });
    if (how.steps && how.steps.length) {
      var d = el("details", "res-steps");
      var sum = el("summary");
      sum.appendChild(both(TEXT.steps));
      d.appendChild(sum);
      var ol = el("ol");
      how.steps.forEach(function (x) { ol.appendChild(el("li", null, x)); });
      d.appendChild(ol);
      out.appendChild(d);
    }
    var lang = el("p", "res-src");
    lang.appendChild(both(TEXT.appText));
    if (lang.textContent) out.appendChild(lang);
  }

  function fail(out, pair, extra) {
    out.textContent = "";
    var p = el("p", "res-err");
    if (pair) p.appendChild(both(pair));
    if (extra) p.appendChild(document.createTextNode((pair ? " " : "") + extra));
    out.appendChild(p);
  }

  function bind(form) {
    var input = form.querySelector("input");
    var button = form.querySelector("button");
    var out = form.parentNode.querySelector(".out");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = (input.value || "").trim();
      if (!v) { fail(out, TEXT.empty); input.focus(); return; }
      button.disabled = true;
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vat_id: v.slice(0, 60) }),
        signal: ctrl ? ctrl.signal : undefined,
        credentials: "omit",
        referrerPolicy: "strict-origin"
      })
        .then(function (res) {
          return res.json().then(function (body) { return { status: res.status, body: body }; }, function () { return { status: res.status, body: null }; });
        })
        .then(function (r) {
          // 200 with a JSON result; 429 visitor limit; 403 origin not allowed (e.g. page opened locally);
          // 400: a fixed sentence (the app's message is technical); anything else (5xx, a Cloudflare error page, no JSON): not reachable.
          if (r.status === 200 && r.body && typeof r.body.status === "string") render(out, r.body);
          else if (r.status === 429) fail(out, TEXT.limit);
          else if (r.status === 403) fail(out, TEXT.origin);
          else if (r.status === 400) fail(out, TEXT.badInput);
          else fail(out, TEXT.unreachable);
        })
        .catch(function () { fail(out, TEXT.unreachable); })
        .then(function () { if (timer) clearTimeout(timer); button.disabled = false; });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var forms = document.querySelectorAll("form.try-form");
    for (var i = 0; i < forms.length; i++) bind(forms[i]);
  });
})();
