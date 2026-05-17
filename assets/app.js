/* McConnell Family Sports — single-page archive */
(function () {
  "use strict";

  // SHA-256 of the family password. Plaintext is never stored in source.
  // Generated with: printf 'McConnell' | sha256sum
  const PASSWORD_HASH = "9592955c5464e8aa0834c891b493c97ed0576d4faa79e703e367a3f511da66ae";
  const SESSION_KEY = "mfs_unlocked_v1";

  // Visitor counter via GoatCounter (no IP storage, no cookies, no
  // fingerprinting; raw IP is hashed with a 4h-rotating salt and never
  // persisted). See README "Visitor counter" for the 1-minute signup.
  // If the subdomain isn't registered yet, the counter just doesn't
  // display — the site loads normally either way.
  const VISITOR_COUNTER_BASE = "https://mcconnell-family-sports.goatcounter.com";

  const state = {
    athletes: null,
    content: null,
    gallery: null,
    galleryItems: [],
    galleryIndex: 0,
  };

  // ---------- Utilities ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function fmtDate(s) {
    if (!s) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }
  async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map(function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  // ---------- Gate ----------
  async function checkUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === PASSWORD_HASH;
  }
  async function tryUnlock(input) {
    const hex = await sha256Hex(input);
    if (hex === PASSWORD_HASH) {
      sessionStorage.setItem(SESSION_KEY, PASSWORD_HASH);
      return true;
    }
    return false;
  }
  function showGate() {
    $("#gate").hidden = false;
    $("#app").hidden = true;
  }
  function showApp() {
    $("#gate").hidden = true;
    $("#app").hidden = false;
  }
  function bindGate() {
    $("#gate-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const input = $("#gate-input").value.trim();
      const ok = await tryUnlock(input);
      if (ok) {
        $("#gate-error").hidden = true;
        $("#gate-input").value = "";
        await boot();
      } else {
        $("#gate-error").hidden = false;
        $("#gate-input").focus();
        $("#gate-input").select();
      }
    });
    $("#lock-btn").addEventListener("click", function () {
      sessionStorage.removeItem(SESSION_KEY);
      location.hash = "";
      showGate();
    });
  }

  // ---------- Data loading ----------
  async function loadJSON(path) {
    const res = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load " + path + " (" + res.status + ")");
    try {
      return await res.json();
    } catch (err) {
      throw new Error("Invalid JSON in " + path + ": " + err.message);
    }
  }
  async function loadData() {
    const [athletes, content, gallery] = await Promise.all([
      loadJSON("data/athletes.json"),
      loadJSON("data/content.json"),
      loadJSON("data/gallery.json").catch(function () { return { photos: [] }; }),
    ]);
    state.athletes = athletes;
    state.content = content;
    state.gallery = gallery;
  }

  // ---------- Lookups ----------
  function getAthlete(slug) {
    return (state.athletes.athletes || []).find(function (a) { return a.slug === slug; });
  }
  function getSport(slug) {
    return (state.athletes.sports || []).find(function (s) { return s.slug === slug; });
  }
  function scoresFor(aSlug, sSlug) {
    return (state.content.scores || []).filter(function (r) {
      return r.athlete === aSlug && r.sport === sSlug;
    }).sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  }
  function memoriesFor(aSlug, sSlug) {
    return (state.content.memories || []).filter(function (r) {
      return r.athlete === aSlug && r.sport === sSlug;
    }).sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  }
  function placesFor(aSlug, sSlug) {
    return (state.content.places || []).filter(function (r) {
      return r.athlete === aSlug && r.sport === sSlug;
    });
  }
  function photosFor(aSlug, sSlug) {
    return (state.gallery.photos || []).filter(function (p) {
      return p.athlete === aSlug && p.sport === sSlug;
    });
  }
  function eventsFor(aSlug, sSlug) {
    return (state.content.events || []).filter(function (ev) {
      if (ev.sport !== sSlug) return false;
      const list = ev.athletes || [];
      return list.indexOf(aSlug) !== -1;
    }).sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  }

  // ---------- Routing ----------
  function parseHash() {
    const h = (location.hash || "").replace(/^#\/?/, "");
    if (!h) return { route: "home" };
    const parts = h.split("/").filter(Boolean);
    if (parts.length === 1) return { route: "athlete", athlete: parts[0] };
    if (parts.length === 2) return { route: "sport", athlete: parts[0], sport: parts[1], tab: "scores" };
    if (parts.length === 3) return { route: "sport", athlete: parts[0], sport: parts[1], tab: parts[2] };
    return { route: "home" };
  }

  // ---------- Views ----------
  function renderCrumbs(route) {
    const c = $("#breadcrumbs");
    c.innerHTML = "";
    const parts = [];
    parts.push(el("a", { href: "#/" }, ["Home"]));
    if (route.athlete) {
      const a = getAthlete(route.athlete);
      if (a) parts.push(el("a", { href: "#/" + a.slug }, [a.name]));
    }
    if (route.sport) {
      const s = getSport(route.sport);
      if (s) parts.push(el("a", { href: "#/" + route.athlete + "/" + s.slug }, [s.name]));
    }
    parts.forEach(function (p, i) {
      if (i > 0) c.appendChild(el("span", { class: "sep" }, ["/"]));
      c.appendChild(p);
    });
  }

  function pickQuote(seed) {
    const list = (state.athletes && state.athletes.quotes) || [];
    if (!list.length) return null;
    const today = new Date();
    const day = today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate();
    const s = day + "|" + seed;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return list[Math.abs(h) % list.length];
  }
  function coverEl(headline, tagline, quoteSeed) {
    const kids = [
      el("h1", null, [headline]),
      el("div", { class: "rule" }),
    ];
    if (tagline) kids.push(el("p", { class: "cover__tagline" }, [tagline]));
    const q = pickQuote(quoteSeed);
    if (q) {
      kids.push(el("blockquote", { class: "cover__quote" }, [
        el("p", null, ["“" + q.text + "”"]),
        el("cite", null, ["— " + q.attribution]),
      ]));
    }
    return el("section", { class: "cover" }, kids);
  }

  function haxtunCrest() {
    return el("div", {
      class: "crest",
      html: '<svg class="haxtun-crest" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Haxtun Bulldogs"><defs><path id="topArc" d="M 38,110 A 72,72 0 0,1 182,110" fill="none"/><path id="botArc" d="M 38,110 A 72,72 0 0,0 182,110" fill="none"/></defs><circle cx="110" cy="110" r="104" fill="#ffffff" stroke="#c8102e" stroke-width="4"/><circle cx="110" cy="110" r="90" fill="none" stroke="#c8102e" stroke-width="1"/><text font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="700" font-size="15" letter-spacing="7" fill="#111"><textPath href="#topArc" startOffset="50%" text-anchor="middle">HAXTUN</textPath></text><text font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="700" font-size="15" letter-spacing="7" fill="#111"><textPath href="#botArc" startOffset="50%" text-anchor="middle">BULLDOGS</textPath></text><text x="110" y="110" text-anchor="middle" dy="0.35em" font-family="Cormorant Garamond, Iowan Old Style, Palatino Linotype, Georgia, serif" font-size="108" font-weight="600" fill="#c8102e">H</text></svg>',
    });
  }

  function viewHome() {
    const v = $("#view");
    v.innerHTML = "";
    const cover = coverEl(
      "McConnell Family Sports",
      "Scores, pictures, places, and memories — kept together.",
      "home"
    );
    cover.insertBefore(haxtunCrest(), cover.firstChild);
    v.appendChild(cover);
    const grid = el("div", { class: "tiles" });
    (state.athletes.athletes || []).forEach(function (a) {
      grid.appendChild(el("a", { class: "tile", href: "#/" + a.slug }, [
        el("h2", { class: "tile__name" }, [a.name]),
        el("p", { class: "tile__meta" }, [(a.tagline || "View archive")]),
      ]));
    });
    v.appendChild(grid);
  }

  function viewAthlete(slug) {
    const a = getAthlete(slug);
    const v = $("#view");
    v.innerHTML = "";
    if (!a) {
      v.appendChild(el("p", null, ["Unknown athlete."]));
      return;
    }
    v.appendChild(coverEl(a.name, a.tagline || "Choose a sport", "athlete:" + a.slug));
    const grid = el("div", { class: "tiles" });
    const sports = (state.athletes.sports || []).filter(function (s) {
      return !a.sports || a.sports.indexOf(s.slug) !== -1;
    });
    sports.forEach(function (s) {
      grid.appendChild(el("a", { class: "tile", href: "#/" + a.slug + "/" + s.slug }, [
        el("h2", { class: "tile__name" }, [s.name]),
        el("p", { class: "tile__meta" }, ["Scores · Pictures · Places · Memories"]),
      ]));
    });
    v.appendChild(grid);
  }

  function viewSport(route) {
    const a = getAthlete(route.athlete);
    const s = getSport(route.sport);
    const v = $("#view");
    v.innerHTML = "";
    if (!a || !s) {
      v.appendChild(el("p", null, ["Section not found."]));
      return;
    }
    v.appendChild(coverEl(a.name + " · " + s.name, null, "sport:" + a.slug + ":" + s.slug));

    const upcomingEvents = eventsFor(a.slug, s.slug);
    if (upcomingEvents.length) {
      v.appendChild(renderEventCard(upcomingEvents[0], a));
    }

    const tabs = ["scores", "pictures", "places", "memories"];
    const tabLabels = { scores: "Scores", pictures: "Pictures", places: "Places", memories: "Memories" };
    const active = tabs.indexOf(route.tab) !== -1 ? route.tab : "scores";

    const tabBar = el("div", { class: "tabs" });
    tabs.forEach(function (t) {
      tabBar.appendChild(el("a", {
        class: "tab" + (t === active ? " is-active" : ""),
        href: "#/" + a.slug + "/" + s.slug + "/" + t,
      }, [tabLabels[t]]));
    });
    v.appendChild(tabBar);

    const body = el("section", null);
    if (active === "scores") renderScores(body, a, s);
    else if (active === "pictures") renderPictures(body, a, s);
    else if (active === "places") renderPlaces(body, a, s);
    else if (active === "memories") renderMemories(body, a, s);
    v.appendChild(body);
  }

  function isToday(dateStr) {
    if (!dateStr) return false;
    const now = new Date();
    const today =
      String(now.getFullYear()) + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
    return dateStr === today;
  }
  function eventBadge(dateStr) {
    if (!dateStr) return "";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return "";
    const ev = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const diff = Math.round((ev - today) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff <= 14) return "In " + diff + " days";
    if (diff === -1) return "Yesterday";
    if (diff < -1) return "Past";
    return "Upcoming";
  }

  function renderEventCard(ev, athlete) {
    const mapsUrl = ev.address
      ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ev.address)
      : null;
    const badge = eventBadge(ev.date);
    const competingFor = (ev.competing && ev.competing[athlete.slug]) || null;

    const headBits = [el("h2", { class: "event-card__title" }, [ev.name || "Event"])];
    if (badge) {
      const badgeClass = "event-card__badge" + (isToday(ev.date) ? " is-today" : "");
      headBits.push(el("span", { class: badgeClass }, [badge]));
    }

    const meta = el("dl", { class: "event-card__meta" });
    function addRow(label, value) {
      if (!value) return;
      meta.appendChild(el("dt", null, [label]));
      meta.appendChild(el("dd", null, value instanceof Node ? [value] : [value]));
    }
    addRow("Date", fmtDate(ev.date));
    if (ev.venue || ev.address) {
      const lines = [];
      if (ev.venue) lines.push(ev.venue);
      if (ev.address) {
        if (mapsUrl) {
          lines.push(el("a", { href: mapsUrl, target: "_blank", rel: "noopener" }, [ev.address]));
        } else {
          lines.push(ev.address);
        }
      }
      const dd = el("dd");
      lines.forEach(function (line, i) {
        if (i > 0) dd.appendChild(el("br"));
        dd.appendChild(typeof line === "string" ? document.createTextNode(line) : line);
      });
      meta.appendChild(el("dt", null, ["Venue"]));
      meta.appendChild(dd);
    }
    if (ev.host) addRow("Host", ev.host);
    if (ev.phone) {
      addRow("Contact", el("a", { href: "tel:" + ev.phone.replace(/[^0-9+]/g, "") }, [ev.phone]));
    }
    if (competingFor) {
      addRow(athlete.name + " competing", competingFor);
    }
    if (ev.league) addRow("League", ev.league);
    if (ev.teams && ev.teams.length) {
      const ul = el("ul", { class: "event-card__teams" });
      ev.teams.forEach(function (t) { ul.appendChild(el("li", null, [t])); });
      meta.appendChild(el("dt", null, ["Teams (" + ev.teams.length + ")"]));
      meta.appendChild(el("dd", null, [ul]));
    }
    if (ev.competitors) addRow("Competitors", ev.competitors);

    const card = el("section", { class: "event-card" }, [
      el("div", { class: "event-card__head" }, headBits),
    ]);
    if (ev.photo) {
      const fig = el("figure", { class: "event-card__photo" }, [
        el("img", {
          src: ev.photo,
          alt: ev.photoCaption || (ev.venue || ev.name || "Venue"),
          loading: "lazy",
          onerror: function () { fig.remove(); },
        }),
      ]);
      if (ev.photoCaption) {
        fig.appendChild(el("figcaption", null, [ev.photoCaption]));
      }
      card.appendChild(fig);
    }
    card.appendChild(meta);
    if (ev.notes) {
      card.appendChild(el("p", { class: "event-card__note" }, [ev.notes]));
    }
    return card;
  }

  function emptyState(title, message) {
    return el("div", { class: "empty" }, [
      el("h3", null, [title]),
      el("p", { html: message }),
    ]);
  }

  function renderScores(parent, a, s) {
    const rows = scoresFor(a.slug, s.slug);
    if (!rows.length) {
      parent.appendChild(emptyState(
        "No scores yet for " + a.name + " in " + s.name,
        "Add a meet by editing <code>data/content.json</code> and pushing to GitHub."
      ));
      return;
    }
    rows.forEach(function (r) {
      const card = el("article", { class: "score-card" });
      const head = el("div", { class: "score-card__head" }, [
        el("h3", { class: "score-card__meet" }, [r.meet || "Meet"]),
        el("div", { class: "score-card__date" }, [fmtDate(r.date)]),
      ]);
      card.appendChild(head);

      const metaBits = [];
      if (r.location) metaBits.push(el("span", null, [r.location]));
      if (r.level) metaBits.push(el("span", null, [r.level]));
      if (metaBits.length) {
        const meta = el("p", { class: "score-card__meta" });
        metaBits.forEach(function (b) { meta.appendChild(b); });
        card.appendChild(meta);
      }

      const targets = (s.qualifying && r.level && s.qualifying[r.level]) || null;
      const qualifiedEvents = [];
      const shortfalls = [];
      function buildEvent(name, scoreVal, note, extraClass) {
        const hasScore = !(scoreVal === "" || scoreVal == null);
        const display = hasScore ? String(scoreVal) : "—";
        const target = targets ? targets[name] : null;
        const numeric = hasScore ? parseFloat(scoreVal) : NaN;
        const met = target != null && !isNaN(numeric) && numeric >= target;
        if (met) {
          qualifiedEvents.push(name);
        } else if (target != null && hasScore && !isNaN(numeric)) {
          shortfalls.push({ name: name, gap: target - numeric, score: numeric, target: target });
        }
        const children = [
          el("p", { class: "event__name" }, [name]),
          el("p", { class: "event__score" }, [display]),
        ];
        if (target != null) {
          children.push(el("p", {
            class: "event__target" + (met ? " event__target--met" : ""),
          }, [(met ? "✓ " : "") + "needs " + target]));
        }
        if (note) {
          children.push(el("p", { class: "event__note" }, [note]));
        }
        return el("div", { class: "event" + (extraClass ? " " + extraClass : "") + (met ? " event--met" : "") }, children);
      }

      const events = el("div", { class: "events" });
      (r.results || []).forEach(function (e) {
        events.appendChild(buildEvent(e.event, e.score, e.note, null));
      });
      if (r.allAround != null && r.allAround !== "") {
        events.appendChild(buildEvent("All-Around", r.allAround, null, "event--aa"));
      }
      card.appendChild(events);

      if (targets) {
        const panel = el("section", { class: "regionals-panel" + (qualifiedEvents.length ? " regionals-panel--booked" : "") });
        panel.appendChild(el("p", { class: "regionals-panel__label" }, ["Path to Regionals"]));
        if (qualifiedEvents.length) {
          const headline = el("p", { class: "regionals-panel__headline" });
          headline.appendChild(document.createTextNode("Regionals booked on "));
          headline.appendChild(el("strong", null, [qualifiedEvents.join(" and ")]));
          headline.appendChild(document.createTextNode("."));
          panel.appendChild(headline);
        } else {
          panel.appendChild(el("p", { class: "regionals-panel__headline" }, ["Keep climbing."]));
        }
        if (shortfalls.length) {
          const sorted = shortfalls.slice().sort(function (a, b) { return a.gap - b.gap; });
          const list = el("ul", { class: "regionals-panel__gaps" });
          sorted.forEach(function (sf) {
            const gapStr = (Math.round(sf.gap * 10) / 10).toFixed(1);
            list.appendChild(el("li", null, [
              el("span", { class: "regionals-panel__event" }, [sf.name]),
              el("span", { class: "regionals-panel__gap" }, ["+" + gapStr]),
              el("span", { class: "regionals-panel__detail" }, [sf.score + " → " + sf.target]),
            ]));
          });
          panel.appendChild(list);
        }
        card.appendChild(panel);
      }

      if (r.placement) {
        card.appendChild(el("span", { class: "placement" }, [r.placement]));
      }
      parent.appendChild(card);
    });
  }

  function renderMemories(parent, a, s) {
    const rows = memoriesFor(a.slug, s.slug);
    if (!rows.length) {
      parent.appendChild(emptyState(
        "No memories yet",
        "Write one in <code>data/content.json</code> under <code>memories</code>."
      ));
      return;
    }
    rows.forEach(function (m) {
      const card = el("article", { class: "memory" }, [
        el("h3", null, [m.title || "Untitled"]),
        el("p", { class: "memory__date" }, [fmtDate(m.date)]),
        el("p", null, [m.text || ""]),
      ]);
      if (m.photo) {
        const fig = el("figure", { class: "memory__photo" }, [
          el("img", {
            src: m.photo,
            alt: m.photoCaption || m.title || "",
            loading: "lazy",
            onerror: function () { fig.remove(); },
          }),
        ]);
        if (m.photoCaption) {
          fig.appendChild(el("figcaption", null, [m.photoCaption]));
        }
        card.appendChild(fig);
      }
      parent.appendChild(card);
    });
  }

  function renderPlaces(parent, a, s) {
    const rows = placesFor(a.slug, s.slug);
    if (!rows.length) {
      parent.appendChild(emptyState(
        "No places yet",
        "Add gyms, venues, or hotels in <code>data/content.json</code> under <code>places</code>."
      ));
      return;
    }
    const grid = el("div", { class: "places" });
    rows.forEach(function (p) {
      grid.appendChild(el("article", { class: "place" }, [
        el("h3", null, [p.name || "Place"]),
        el("p", { class: "place__city" }, [p.city || ""]),
        p.note ? el("p", { class: "place__note" }, [p.note]) : null,
      ]));
    });
    parent.appendChild(grid);
  }

  function renderPictures(parent, a, s) {
    const photos = photosFor(a.slug, s.slug);
    if (!photos.length) {
      parent.appendChild(emptyState(
        "No pictures yet",
        "Drag photos into <code>media/" + a.slug + "/" + s.slug + "/</code> on GitHub. They'll appear here in a few minutes."
      ));
      return;
    }
    state.galleryItems = photos;
    const grid = el("div", { class: "gallery" });
    photos.forEach(function (p, idx) {
      const btn = el("button", {
        type: "button",
        "aria-label": p.caption || "Photo",
        onclick: function () { openLightbox(idx); },
      }, [
        el("img", { src: p.src, alt: p.caption || "", loading: "lazy" }),
      ]);
      grid.appendChild(btn);
    });
    parent.appendChild(grid);
  }

  // ---------- Lightbox ----------
  function openLightbox(i) {
    state.galleryIndex = i;
    showLightbox();
  }
  function showLightbox() {
    const p = state.galleryItems[state.galleryIndex];
    if (!p) return;
    $("#lightbox-img").src = p.src;
    $("#lightbox-img").alt = p.caption || "";
    $("#lightbox-cap").textContent = p.caption || "";
    $("#lightbox").hidden = false;
  }
  function closeLightbox() { $("#lightbox").hidden = true; }
  function nextPhoto() {
    if (!state.galleryItems.length) return;
    state.galleryIndex = (state.galleryIndex + 1) % state.galleryItems.length;
    showLightbox();
  }
  function prevPhoto() {
    if (!state.galleryItems.length) return;
    state.galleryIndex = (state.galleryIndex - 1 + state.galleryItems.length) % state.galleryItems.length;
    showLightbox();
  }
  function bindLightbox() {
    const lb = $("#lightbox");
    lb.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
    lb.querySelector(".lightbox__next").addEventListener("click", nextPhoto);
    lb.querySelector(".lightbox__prev").addEventListener("click", prevPhoto);
    lb.addEventListener("click", function (e) {
      if (e.target === lb) closeLightbox();
    });
    document.addEventListener("keydown", function (e) {
      if ($("#lightbox").hidden) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") nextPhoto();
      else if (e.key === "ArrowLeft") prevPhoto();
    });
  }

  // ---------- Render dispatcher ----------
  function render() {
    const route = parseHash();
    renderCrumbs(route);
    if (route.route === "home") viewHome();
    else if (route.route === "athlete") viewAthlete(route.athlete);
    else if (route.route === "sport") viewSport(route);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  // ---------- Boot ----------
  async function boot() {
    showApp();
    refreshVisitCount();
    try {
      await loadData();
    } catch (err) {
      $("#view").innerHTML = "";
      $("#view").appendChild(el("div", { class: "empty" }, [
        el("h3", null, ["Couldn't load the archive"]),
        el("p", null, [String(err.message || err)]),
      ]));
      return;
    }
    render();
  }

  // ---------- Visitor counter ----------
  // Records a single aggregate page-view via GoatCounter (which doesn't
  // store raw IPs) and fetches the running total to display in the footer.
  // Both sides fail silent: if the counter is unreachable, the site loads
  // normally and the footer just omits the number. No personal data leaves
  // the page beyond what GoatCounter records site-wide.
  function refreshVisitCount() {
    if (!VISITOR_COUNTER_BASE) return;
    // Record the visit. Pixel-style request so CORS doesn't apply.
    try {
      const params = new URLSearchParams({ p: "/", t: "site", r: "" });
      new Image().src = VISITOR_COUNTER_BASE + "/count?" + params.toString();
    } catch (e) { /* ignore */ }
    // Fetch the aggregate count and display it.
    fetch(VISITOR_COUNTER_BASE + "/counter/TOTAL.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        const total = typeof data.count === "number" ? data.count : parseInt(data.count, 10);
        if (!total || isNaN(total)) return;
        const el = document.getElementById("visit-count");
        if (!el) return;
        el.textContent = total.toLocaleString() + " family visits";
        el.hidden = false;
      })
      .catch(function () { /* offline / not signed up yet / blocked — leave hidden */ });
  }

  async function init() {
    bindGate();
    bindLightbox();
    window.addEventListener("hashchange", function () {
      if (!$("#app").hidden) render();
    });
    if (await checkUnlocked()) {
      await boot();
    } else {
      showGate();
    }
  }

  init();
})();
