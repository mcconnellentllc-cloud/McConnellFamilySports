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
      // Keep the plaintext in memory only (never persisted) so the uploader
      // can decrypt the shared upload token without prompting again.
      state.familyPassword = input;
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
      state.familyPassword = null;
      state.uploadToken = null;
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
      function buildEvent(name, scoreVal, note, extraClass, placement) {
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
        if (placement) {
          children.push(el("p", { class: "event__place" }, [placement]));
        }
        if (note) {
          children.push(el("p", { class: "event__note" }, [note]));
        }
        return el("div", { class: "event" + (extraClass ? " " + extraClass : "") + (met ? " event--met" : "") }, children);
      }

      // All-Around: use the manual value if entered, otherwise auto-sum the
      // four event scores once they're all filled in. Shows a small hint
      // when the figure was computed rather than typed.
      let aaVal = r.allAround;
      let aaAuto = false;
      const aaManual = aaVal != null && aaVal !== "";
      if (!aaManual) {
        const nums = (r.results || []).map(function (e) { return parseFloat(e.score); });
        if (nums.length && nums.every(function (n) { return !isNaN(n); })) {
          aaVal = (Math.round(nums.reduce(function (a, b) { return a + b; }, 0) * 1000) / 1000).toString();
          aaAuto = true;
        }
      }

      const events = el("div", { class: "events" });
      (r.results || []).forEach(function (e) {
        events.appendChild(buildEvent(e.event, e.score, e.note, null, e.placement));
      });
      if (aaVal != null && aaVal !== "") {
        events.appendChild(buildEvent(
          "All-Around", aaVal, aaAuto ? "auto-summed" : null,
          "event--aa", r.allAroundPlacement
        ));
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
      if (r.notes) {
        card.appendChild(el("p", { class: "score-card__notes" }, [r.notes]));
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
    parent.appendChild(renderUploader(a, s));
    const photos = photosFor(a.slug, s.slug);
    if (!photos.length) {
      parent.appendChild(emptyState(
        "No pictures yet",
        "Use <strong>Add photos or videos</strong> above to upload straight from here, or drop files into <code>media/" + a.slug + "/" + s.slug + "/</code> on GitHub. They'll appear in a few minutes."
      ));
      return;
    }
    state.galleryItems = photos;
    const grid = el("div", { class: "gallery" });
    photos.forEach(function (p, idx) {
      if (p.type === "video") {
        const vid = el("video", {
          src: p.src,
          muted: "",
          playsinline: "",
          preload: "metadata",
          tabindex: "-1",
        });
        vid.muted = true;
        const btn = el("button", {
          type: "button",
          class: "gallery__video",
          "aria-label": p.caption || "Video",
          onclick: function () { openLightbox(idx); },
        }, [
          vid,
          el("span", { class: "gallery__play", "aria-hidden": "true" }, ["▶"]),
        ]);
        grid.appendChild(btn);
      } else {
        const btn = el("button", {
          type: "button",
          "aria-label": p.caption || "Photo",
          onclick: function () { openLightbox(idx); },
        }, [
          el("img", { src: p.src, alt: p.caption || "", loading: "lazy" }),
        ]);
        grid.appendChild(btn);
      }
    });
    parent.appendChild(grid);
  }

  // ---------- Direct upload (password-only, no backend) ----------
  // Anyone with the family password can add photos/videos straight from the
  // site. There's no server: the browser calls api.github.com directly,
  // authorized by ONE shared fine-grained, single-repo, Contents-only token.
  // That token is never stored in plaintext anywhere public — it's encrypted
  // with the family password (AES-GCM, key derived from the password via
  // PBKDF2) and kept in data/upload-key.json. Only someone who knows the
  // password can decrypt and use it. An admin pastes the raw token once to
  // set this up (see SETUP-GITHUB-TOKEN.md); after that, password-holders
  // just pick files and upload.
  const GH_OWNER = "mcconnellentllc-cloud";
  const GH_REPO = "McConnellFamilySports";
  const GH_BRANCH = "main";
  const UPLOAD_KEY_PATH = "data/upload-key.json";
  const PBKDF2_ITERS = 200000;
  const TOKEN_DOC_URL =
    "https://github.com/mcconnellentllc-cloud/McConnellFamilySports/blob/main/SETUP-GITHUB-TOKEN.md";
  // Files larger than this are steered to YouTube/Drive (see the meet-day
  // guide) — keeps the Contents API reliable and the repo lean.
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  // The plaintext password (kept only in memory for this page's lifetime, to
  // decrypt the upload token) and the decrypted token (cached per session).
  state.familyPassword = null;
  state.uploadToken = null;
  state.uploadKeyBlob = undefined; // undefined = unfetched, null = not set up

  // ---- base64 <-> bytes ----
  function bytesToB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---- WebCrypto: derive a key from the password and encrypt/decrypt ----
  async function deriveKey(password, saltBytes) {
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function encryptToken(token, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(token)
    );
    return { v: 1, alg: "AES-GCM", kdf: "PBKDF2", iters: PBKDF2_ITERS,
             salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
  }
  async function decryptToken(blob, password) {
    const key = await deriveKey(password, b64ToBytes(blob.salt));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct)
    );
    return new TextDecoder().decode(pt);
  }

  // ---- GitHub Contents API (token passed explicitly) ----
  function ghContentsUrl(path) {
    const enc = path.split("/").map(encodeURIComponent).join("/");
    return "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + enc;
  }
  function tokenError(status) {
    const e = new Error(status === 403
      ? "GitHub returned 403 — the upload token's scope or repo access is wrong. See SETUP-GITHUB-TOKEN.md."
      : "The upload token needs renewing — an admin can redo setup. See SETUP-GITHUB-TOKEN.md.");
    e.isTokenError = true;
    return e;
  }
  async function ghHead(path, token) {
    const r = await fetch(ghContentsUrl(path) + "?ref=" + GH_BRANCH, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw tokenError(r.status);
    if (!r.ok) throw new Error("GitHub GET " + path + " → " + r.status);
    return r.json();
  }
  async function ghPutFile(path, contentB64, message, token, sha) {
    const body = { message: message, content: contentB64, branch: GH_BRANCH };
    if (sha) body.sha = sha;
    const r = await fetch(ghContentsUrl(path), {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (r.status === 401 || r.status === 403) throw tokenError(r.status);
    if (!r.ok) throw new Error("GitHub PUT " + path + " → " + r.status);
    return r.json();
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onloadend = function () {
        resolve(String(reader.result).split(",", 2)[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function sanitizeFilename(name) {
    const dot = name.lastIndexOf(".");
    let stem = dot > 0 ? name.slice(0, dot) : name;
    let ext = dot > 0 ? name.slice(dot + 1) : "";
    stem = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "photo";
    ext = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    return stem + "." + ext;
  }
  function setUploadStatus(node, text, kind) {
    node.textContent = text;
    node.className = "uploader__status" + (kind ? " is-" + kind : "");
    node.hidden = false;
  }

  // Fetch the encrypted token blob from the site (same-origin, no auth).
  // Returns the parsed blob, or null if uploads aren't set up yet.
  async function fetchUploadKeyBlob() {
    if (state.uploadKeyBlob !== undefined) return state.uploadKeyBlob;
    try {
      const r = await fetch(UPLOAD_KEY_PATH + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) { state.uploadKeyBlob = null; return null; }
      const data = await r.json();
      state.uploadKeyBlob = (data && data.ct) ? data : null;
    } catch (e) {
      state.uploadKeyBlob = null;
    }
    return state.uploadKeyBlob;
  }
  // Decrypt (once per session) and return the shared upload token.
  async function ensureUploadToken() {
    if (state.uploadToken) return state.uploadToken;
    const blob = await fetchUploadKeyBlob();
    if (!blob) { const e = new Error("Uploads aren't set up yet."); e.needsSetup = true; throw e; }
    if (!state.familyPassword) { const e = new Error("Enter the family password to upload."); e.needsPassword = true; throw e; }
    try {
      state.uploadToken = await decryptToken(blob, state.familyPassword);
    } catch (e) {
      const err = new Error("Couldn't unlock uploads — the token may have been set up under a different password. An admin can redo setup.");
      err.isTokenError = true;
      throw err;
    }
    return state.uploadToken;
  }

  // ---- Uploader UI ----
  function renderUploader(a, s) {
    const panel = el("section", { class: "uploader" });
    panel.appendChild(el("h3", { class: "uploader__title" }, ["Add photos or videos"]));
    const body = el("div", { class: "uploader__body" }, ["Loading…"]);
    panel.appendChild(body);
    refreshUploaderState(body, a, s);
    return panel;
  }

  async function refreshUploaderState(body, a, s) {
    body.innerHTML = "";
    const blob = await fetchUploadKeyBlob();

    // Need the plaintext password in memory to decrypt (or to set up).
    if (!state.uploadToken && !state.familyPassword) {
      body.appendChild(passwordConfirmForm(body, a, s));
      return;
    }
    if (blob === null) {
      body.appendChild(adminSetupForm(body, a, s));
      return;
    }
    body.appendChild(filePickerForm(a, s));
  }

  function passwordConfirmForm(body, a, s) {
    const wrap = el("div");
    wrap.appendChild(el("p", { class: "uploader__hint" }, [
      "Re-enter the family password to turn on uploading for this visit.",
    ]));
    const err = el("p", { class: "uploader__error", hidden: "hidden" });
    const input = el("input", { type: "password", placeholder: "Family password", autocomplete: "off", "aria-label": "Family password" });
    const form = el("form", { class: "uploader__token" }, [
      input, el("button", { type: "submit" }, ["Continue"]),
    ]);
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const val = input.value.trim();
      if ((await sha256Hex(val)) !== PASSWORD_HASH) {
        err.textContent = "That password didn't match.";
        err.hidden = false;
        return;
      }
      state.familyPassword = val;
      refreshUploaderState(body, a, s);
    });
    wrap.appendChild(form);
    wrap.appendChild(err);
    return wrap;
  }

  function adminSetupForm(body, a, s) {
    const wrap = el("div");
    const hint = el("p", { class: "uploader__hint" });
    hint.appendChild(document.createTextNode("Uploads aren't switched on yet. One-time setup: paste a GitHub access token and it'll be encrypted with the family password so everyone who knows the password can upload — no token needed again. See "));
    hint.appendChild(el("a", { href: TOKEN_DOC_URL, target: "_blank", rel: "noopener" }, ["how to make the token"]));
    hint.appendChild(document.createTextNode("."));
    wrap.appendChild(hint);

    const status = el("p", { class: "uploader__status", "aria-live": "polite", hidden: "hidden" });
    const input = el("input", { type: "password", placeholder: "github_pat_…", autocomplete: "off", "aria-label": "GitHub access token" });
    const btn = el("button", { type: "submit" }, ["Turn on uploads"]);
    const form = el("form", { class: "uploader__token" }, [input, btn]);
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const raw = input.value.trim();
      if (!/^github_pat_/.test(raw) && !/^ghp_/.test(raw)) {
        setUploadStatus(status, "That doesn't look like a token (it should start with github_pat_).", "error");
        return;
      }
      btn.disabled = true;
      setUploadStatus(status, "Encrypting and saving…");
      try {
        const blob = await encryptToken(raw, state.familyPassword);
        const existing = await ghHead(UPLOAD_KEY_PATH, raw);
        await ghPutFile(
          UPLOAD_KEY_PATH,
          bytesToB64(new TextEncoder().encode(JSON.stringify(blob, null, 2) + "\n")),
          "chore: configure encrypted upload token",
          raw,
          existing ? existing.sha : undefined
        );
        state.uploadKeyBlob = blob;
        state.uploadToken = raw;
        setUploadStatus(status, "Uploads are on. Anyone with the password can now add photos and videos.", "ok");
        refreshUploaderState(body, a, s);
      } catch (err) {
        setUploadStatus(status, err && err.message ? err.message : String(err), "error");
        btn.disabled = false;
      }
    });
    wrap.appendChild(form);
    wrap.appendChild(status);
    return wrap;
  }

  function filePickerForm(a, s) {
    const wrap = el("div");
    const dest = "media/" + a.slug + "/" + s.slug + "/";
    const hint = el("p", { class: "uploader__hint" });
    hint.appendChild(document.createTextNode("Pick photos or videos — they go straight to "));
    hint.appendChild(el("code", null, [dest]));
    hint.appendChild(document.createTextNode(" and appear here a couple of minutes after the site rebuilds. Up to 25 MB each; post bigger videos to YouTube or Drive (see the meet-day guide)."));
    wrap.appendChild(hint);

    const input = el("input", {
      type: "file",
      multiple: "multiple",
      accept: "image/*,video/*,.heic,.heif,.mov,.m4v,.mp4,.webm",
      "aria-label": "Choose photos or videos",
    });
    const status = el("p", { class: "uploader__status", "aria-live": "polite", hidden: "hidden" });
    const btn = el("button", { type: "button", class: "uploader__btn" }, ["Upload"]);
    btn.addEventListener("click", function () { handleUpload(a, s, input, status, btn); });
    wrap.appendChild(el("div", { class: "uploader__row" }, [input, btn]));
    wrap.appendChild(status);
    return wrap;
  }

  async function handleUpload(a, s, input, status, btn) {
    const files = input.files ? Array.prototype.slice.call(input.files) : [];
    if (!files.length) { setUploadStatus(status, "Pick at least one file first.", "error"); return; }
    const tooBig = files.filter(function (f) { return f.size > MAX_UPLOAD_BYTES; });
    if (tooBig.length) {
      setUploadStatus(status,
        tooBig.map(function (f) { return f.name; }).join(", ") +
        " is over 25 MB. Trim long videos, or post big ones to YouTube/Drive (see the meet-day guide).",
        "error");
      return;
    }
    btn.disabled = true;
    let done = 0;
    try {
      const token = await ensureUploadToken();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus(status, "Uploading " + file.name + " (" + (i + 1) + " of " + files.length + ")…");
        const b64 = await fileToBase64(file);
        let name = sanitizeFilename(file.name);
        // Avoid clobbering an existing file with the same name.
        if (await ghHead("media/" + a.slug + "/" + s.slug + "/" + name, token)) {
          const dot = name.lastIndexOf(".");
          name = name.slice(0, dot) + "-" + Date.now().toString(36) + name.slice(dot);
        }
        const path = "media/" + a.slug + "/" + s.slug + "/" + name;
        await ghPutFile(path, b64, "upload: " + name + " → " + a.slug + "/" + s.slug, token);
        done++;
      }
      setUploadStatus(status,
        done + " file" + (done === 1 ? "" : "s") + " uploaded. They'll appear here a couple of minutes after the site rebuilds.",
        "ok");
      input.value = "";
    } catch (e) {
      btn.disabled = false;
      if (e && e.needsPassword) {
        state.uploadToken = null;
        render();
      } else if (e && e.isTokenError) {
        state.uploadToken = null;
        setUploadStatus(status, e.message, "error");
      } else {
        setUploadStatus(status,
          "Upload stopped after " + done + " file(s): " + (e && e.message ? e.message : String(e)),
          "error");
      }
      return;
    }
    btn.disabled = false;
  }

  // ---------- Lightbox ----------
  function openLightbox(i) {
    state.galleryIndex = i;
    showLightbox();
  }
  function showLightbox() {
    const p = state.galleryItems[state.galleryIndex];
    if (!p) return;
    const img = $("#lightbox-img");
    const video = $("#lightbox-video");
    if (p.type === "video") {
      img.hidden = true;
      img.removeAttribute("src");
      video.src = p.src;
      video.hidden = false;
      video.load();
    } else {
      video.pause();
      video.removeAttribute("src");
      video.hidden = true;
      img.src = p.src;
      img.alt = p.caption || "";
      img.hidden = false;
    }
    $("#lightbox-cap").textContent = p.caption || "";
    $("#lightbox").hidden = false;
  }
  function closeLightbox() {
    const video = $("#lightbox-video");
    if (video) video.pause();
    $("#lightbox").hidden = true;
  }
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
