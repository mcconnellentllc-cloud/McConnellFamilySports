/*
 * Review tray — sort pending items into the right girl/sport folders.
 *
 * Reads data/pending.json + data/athletes.json from this site origin (no
 * auth needed — it's our own static files). When the user confirms an item,
 * the tray calls the GitHub Contents API directly with a fine-grained PAT
 * the user supplied once and that lives in this browser's localStorage:
 *   - PUT  /repos/.../contents/<dest-path>    (copy with new path)
 *   - DELETE /repos/.../contents/<pending-path>
 *   - PUT  /repos/.../contents/data/content.json   (append memory if any)
 *   - PUT  /repos/.../contents/data/pending.json   (remove cleared entry)
 *
 * Token handling:
 *   - Stored under localStorage key "mfs.reviewPat".
 *   - Never logged. Never sent anywhere except api.github.com.
 *   - On 401: shows the SETUP-GITHUB-TOKEN.md message and offers replace.
 */
(function () {
  "use strict";

  // Must match the hash in assets/app.js so this page uses the same family password.
  const PASSWORD_HASH =
    "9592955c5464e8aa0834c891b493c97ed0576d4faa79e703e367a3f511da66ae";
  const SESSION_KEY = "mfs.unlocked";
  const TOKEN_KEY = "mfs.reviewPat";

  const REPO_OWNER = "mcconnellentllc-cloud";
  const REPO_NAME = "McConnellFamilySports";
  const BRANCH = "main";

  const $ = (sel) => document.querySelector(sel);

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

  // ---------- Gate (same logic as assets/app.js) ----------
  async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function isUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === PASSWORD_HASH;
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
      const v = $("#gate-input").value.trim();
      const hex = await sha256Hex(v);
      if (hex === PASSWORD_HASH) {
        sessionStorage.setItem(SESSION_KEY, PASSWORD_HASH);
        $("#gate-error").hidden = true;
        $("#gate-input").value = "";
        boot();
      } else {
        $("#gate-error").hidden = false;
        $("#gate-input").focus();
        $("#gate-input").select();
      }
    });
  }

  // ---------- Token ----------
  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function saveToken(t) {
    localStorage.setItem(TOKEN_KEY, t.trim());
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function bindTokenForm() {
    $("#token-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const raw = $("#token-input").value.trim();
      if (!raw) return;
      if (!/^github_pat_/.test(raw) && !/^ghp_/.test(raw)) {
        $("#token-error").textContent =
          "That doesn't look like a fine-grained PAT (should start with github_pat_). Double-check and try again.";
        $("#token-error").hidden = false;
        return;
      }
      saveToken(raw);
      $("#token-input").value = "";
      $("#token-error").hidden = true;
      boot();
    });
    $("#replace-token").addEventListener("click", function () {
      clearToken();
      boot();
    });
  }

  // ---------- GitHub Contents API helpers ----------
  function apiUrl(path) {
    return (
      "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path
    );
  }

  async function ghGet(path) {
    const r = await fetch(apiUrl(path) + "?ref=" + BRANCH, {
      headers: {
        Authorization: "Bearer " + getToken(),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (r.status === 404) return null;
    if (r.status === 401) throw new TokenError();
    if (r.status === 403) throw new TokenError("permission");
    if (!r.ok) throw new Error("GitHub GET " + path + " -> " + r.status);
    return r.json();
  }

  async function ghPut(path, contentB64, message, sha) {
    const body = {
      message: message,
      content: contentB64,
      branch: BRANCH,
    };
    if (sha) body.sha = sha;
    const r = await fetch(apiUrl(path), {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + getToken(),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (r.status === 401) throw new TokenError();
    if (r.status === 403) throw new TokenError("permission");
    if (!r.ok) throw new Error("GitHub PUT " + path + " -> " + r.status);
    return r.json();
  }

  async function ghDelete(path, sha, message) {
    const r = await fetch(apiUrl(path), {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + getToken(),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: message, sha: sha, branch: BRANCH }),
    });
    if (r.status === 401) throw new TokenError();
    if (r.status === 403) throw new TokenError("permission");
    if (!r.ok && r.status !== 422) throw new Error("GitHub DELETE " + path + " -> " + r.status);
    return null;
  }

  class TokenError extends Error {
    constructor(kind) {
      super(
        kind === "permission"
          ? "GitHub returned 403. The token's scope or repository access is wrong — see SETUP-GITHUB-TOKEN.md."
          : "The access token needs renewing — see SETUP-GITHUB-TOKEN.md."
      );
      this.isTokenError = true;
    }
  }

  function b64FromString(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function decodeB64(str) {
    return decodeURIComponent(escape(atob(str)));
  }

  // ---------- Load tray data ----------
  async function loadJsonFromSite(path) {
    const r = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("Failed to load " + path);
    return r.json();
  }

  let athletes = null;
  let pending = null;

  // ---------- Render ----------
  function renderTray() {
    const root = $("#tray");
    root.innerHTML = "";
    const items = (pending && pending.items) || [];
    $("#tray-count").textContent =
      items.length === 0
        ? "No pending items."
        : items.length + " pending item" + (items.length === 1 ? "" : "s") + " to sort.";
    $("#tray-empty").hidden = items.length !== 0;
    items.forEach(function (item, idx) {
      root.appendChild(renderItem(item, idx));
    });
  }

  function girlSelectControl(preselected, scores) {
    const wrap = el("div", { class: "ctrl ctrl--girls" });
    wrap.appendChild(el("label", null, ["Girls"]));
    const girls = (athletes && athletes.athletes) || [];
    girls.forEach(function (g) {
      const score = scores && scores[g.slug];
      const checked = (preselected || []).indexOf(g.slug) !== -1 ||
        (!preselected.length && score && score >= 0.6);
      const id = "girl-" + g.slug + "-" + Math.random().toString(36).slice(2, 8);
      const row = el("label", { class: "checkbox" }, [
        el("input", {
          type: "checkbox",
          value: g.slug,
          id: id,
          checked: checked ? "checked" : null,
        }),
        el("span", null, [g.name + (score != null ? " (" + Math.round(score * 100) + "% face match)" : "")]),
      ]);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function sportSelectControl(preselected) {
    const wrap = el("div", { class: "ctrl" });
    wrap.appendChild(el("label", { for: "sport-select" }, ["Sport"]));
    const sel = el("select", { id: "sport-select" });
    sel.appendChild(el("option", { value: "" }, ["— pick one —"]));
    const sports = (athletes && athletes.sports) || [];
    sports.forEach(function (s) {
      const opt = el("option", { value: s.slug }, [s.name]);
      if (s.slug === preselected) opt.selected = true;
      sel.appendChild(opt);
    });
    wrap.appendChild(sel);
    return wrap;
  }

  function venueControl(preselected) {
    const wrap = el("div", { class: "ctrl" });
    wrap.appendChild(el("label", { for: "venue-input" }, ["Venue (optional)"]));
    wrap.appendChild(el("input", {
      type: "text",
      id: "venue-input",
      value: preselected || "",
    }));
    return wrap;
  }

  function renderItem(item, idx) {
    const card = el("article", { class: "pending-item" });
    card.dataset.idx = String(idx);

    const head = el("div", { class: "pending-item__head" }, [
      el("h3", null, [item.kind === "memory" ? "Memory" : "Photo"]),
      el("span", { class: "pending-item__date" }, [item.date || ""]),
    ]);
    card.appendChild(head);

    if (item.kind === "photo") {
      const img = el("img", {
        class: "pending-item__img",
        src: "media/_pending/" + item.filename,
        alt: item.originalName || "Pending photo",
        loading: "lazy",
      });
      card.appendChild(img);
    }
    if (item.messageText) {
      card.appendChild(el("p", { class: "pending-item__quote" }, [item.messageText]));
    }
    if (item.venue) {
      card.appendChild(el("p", { class: "pending-item__meta" }, ["Resolved venue: " + item.venue]));
    }

    const girlCtrl = girlSelectControl(item.girlGuesses || [], item.faceScores || null);
    card.appendChild(girlCtrl);
    card.appendChild(sportSelectControl(item.sportGuess || ""));
    if (item.kind === "photo") {
      card.appendChild(venueControl(item.venue || ""));
    }

    const actions = el("div", { class: "pending-item__actions" }, [
      el("button", {
        type: "button",
        class: "btn btn--confirm",
        onclick: function () { confirmItem(card, item); },
      }, ["Confirm"]),
      el("button", {
        type: "button",
        class: "btn btn--discard",
        onclick: function () { discardItem(card, item); },
      }, ["Discard"]),
    ]);
    card.appendChild(actions);

    card.appendChild(el("p", { class: "pending-item__status", hidden: "hidden" }));
    return card;
  }

  function collectSelections(card) {
    const checks = card.querySelectorAll(".ctrl--girls input[type=checkbox]:checked");
    const girls = Array.from(checks).map(function (c) { return c.value; });
    const sport = card.querySelector("#sport-select, select").value;
    const venueInput = card.querySelector("#venue-input");
    return { girls: girls, sport: sport, venue: venueInput ? venueInput.value.trim() : "" };
  }

  function status(card, text, kind) {
    const p = card.querySelector(".pending-item__status");
    p.textContent = text;
    p.className = "pending-item__status" + (kind ? " is-" + kind : "");
    p.hidden = false;
  }

  // ---------- Confirm / discard ----------
  async function confirmItem(card, item) {
    const sel = collectSelections(card);
    if (item.kind === "photo") {
      if (!sel.girls.length) return status(card, "Pick at least one girl.", "error");
      if (!sel.sport) return status(card, "Pick a sport.", "error");
    } else {
      if (!sel.girls.length) return status(card, "Pick at least one girl.", "error");
      if (!sel.sport) return status(card, "Pick a sport.", "error");
    }
    status(card, "Saving…");
    try {
      if (item.kind === "photo") {
        await confirmPhoto(item, sel);
      } else {
        await confirmMemory(item, sel);
      }
      await removeFromPending(item);
      status(card, "Saved. Site will refresh on the next deploy.", "ok");
      // Reload pending to reflect the change.
      await refreshPending();
      renderTray();
    } catch (e) {
      handleApiError(card, e);
    }
  }

  async function discardItem(card, item) {
    if (!confirm("Discard this item permanently?")) return;
    status(card, "Discarding…");
    try {
      if (item.kind === "photo" && item.filename) {
        const existing = await ghGet("media/_pending/" + item.filename);
        if (existing && existing.sha) {
          await ghDelete(
            "media/_pending/" + item.filename,
            existing.sha,
            "review: discard " + item.filename
          );
        }
      }
      await removeFromPending(item);
      status(card, "Discarded.", "ok");
      await refreshPending();
      renderTray();
    } catch (e) {
      handleApiError(card, e);
    }
  }

  async function confirmPhoto(item, sel) {
    // 1. Fetch the pending photo's blob from this site (no auth needed —
    //    it's served by Pages, same origin).
    const blobResp = await fetch("media/_pending/" + item.filename + "?t=" + Date.now(), { cache: "no-store" });
    if (!blobResp.ok) throw new Error("Couldn't read pending file.");
    const blob = await blobResp.blob();
    const b64 = await blobToBase64(blob);

    // 2. Copy into each girl's folder.
    for (const girl of sel.girls) {
      const dest = "media/" + girl + "/" + sel.sport + "/" + item.filename;
      const existing = await ghGet(dest); // might exist if confirmed twice; reuse sha
      await ghPut(
        dest,
        b64,
        "review: file " + item.filename + " → " + girl + "/" + sel.sport,
        existing ? existing.sha : undefined
      );
    }

    // 3. Delete the pending copy.
    const pendingFile = await ghGet("media/_pending/" + item.filename);
    if (pendingFile && pendingFile.sha) {
      await ghDelete(
        "media/_pending/" + item.filename,
        pendingFile.sha,
        "review: clear pending " + item.filename
      );
    }
  }

  async function confirmMemory(item, sel) {
    // Append a memory entry per selected girl into data/content.json.
    const contentFile = await ghGet("data/content.json");
    if (!contentFile) throw new Error("data/content.json missing.");
    const current = JSON.parse(decodeB64(contentFile.content));
    current.memories = current.memories || [];
    sel.girls.forEach(function (g) {
      current.memories.push({
        athlete: g,
        sport: sel.sport,
        date: item.date,
        title: "From the family channel",
        text: item.messageText || "",
      });
    });
    const newContent = JSON.stringify(current, null, 2) + "\n";
    await ghPut(
      "data/content.json",
      b64FromString(newContent),
      "review: add memory from msg " + (item.messageId || "").slice(0, 8),
      contentFile.sha
    );
  }

  async function removeFromPending(item) {
    const pendingFile = await ghGet("data/pending.json");
    if (!pendingFile) return;
    const current = JSON.parse(decodeB64(pendingFile.content));
    const before = (current.items || []).length;
    current.items = (current.items || []).filter(function (it) {
      if (item.kind === "photo") return it.contentHash !== item.contentHash;
      return it.messageId !== item.messageId;
    });
    if (current.items.length === before) return; // nothing changed
    await ghPut(
      "data/pending.json",
      b64FromString(JSON.stringify(current, null, 2) + "\n"),
      "review: clear pending entry",
      pendingFile.sha
    );
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onloadend = function () {
        const dataUrl = reader.result;
        const base64 = String(dataUrl).split(",", 2)[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---------- Errors ----------
  function handleApiError(card, e) {
    if (e && e.isTokenError) {
      status(card, e.message, "error");
      // Prompt for re-paste.
      clearToken();
      $("#tray").hidden = true;
      $("#tray-controls").hidden = true;
      $("#token-prompt").hidden = false;
      $("#token-error").textContent = e.message;
      $("#token-error").hidden = false;
    } else {
      status(card, "Error: " + (e && e.message ? e.message : String(e)), "error");
    }
  }

  async function refreshPending() {
    pending = await loadJsonFromSite("data/pending.json");
  }

  // ---------- Boot ----------
  async function boot() {
    if (!isUnlocked()) {
      showGate();
      return;
    }
    showApp();
    if (!getToken()) {
      $("#token-prompt").hidden = false;
      $("#tray-controls").hidden = true;
      $("#tray").hidden = true;
      return;
    }
    $("#token-prompt").hidden = true;
    $("#tray-controls").hidden = false;
    $("#tray").hidden = false;
    try {
      athletes = await loadJsonFromSite("data/athletes.json");
      await refreshPending();
      renderTray();
    } catch (e) {
      $("#tray").innerHTML = "";
      $("#tray").appendChild(el("p", { class: "tray-error" }, [
        "Couldn't load tray data: " + (e && e.message ? e.message : String(e)),
      ]));
    }
  }

  bindGate();
  bindTokenForm();
  boot();
})();
