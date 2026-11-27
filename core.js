/* Success AI — core runtime
 * API client · accounts · IndexedDB cache with cloud sync · projects · assets · router · UI helpers.
 * Classic script: everything hangs off window.SA so studio files can be plain <script> tags.
 */
(() => {
  "use strict";

  const DEFAULT_API = "https://success-ai.successdahal75.workers.dev";
  const SA = (window.SA = {
    version: "2.0.0",
    config: { API: localStorage.getItem("sa_api_url") || DEFAULT_API, DEFAULT_API },
    state: { user: null, token: localStorage.getItem("sa_token") || null, view: "home", serverStatus: null },
    studios: {},
    order: []
  });

  /* ====================================================================== */
  /* Utilities                                                              */
  /* ====================================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function uid(prefix = "id") {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return prefix + "_" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function debounce(fn, ms) {
    let t;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    wrapped.flush = (...args) => {
      clearTimeout(t);
      return fn(...args);
    };
    return wrapped;
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(value) ? value : String(value).replace(" ", "T") + "Z");
    if (isNaN(d)) return "";
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " h ago";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " d ago";
    return d.toLocaleDateString();
  }

  function fmtBytes(n) {
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function download(data, filename, mime = "application/octet-stream") {
    const blob = data instanceof Blob ? data : typeof data === "string" && data.startsWith("data:") ? dataUrlToBlob(data) : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(",");
    const mime = (head.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  const blobToDataUrl = blob =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("Could not read file."));
      r.readAsDataURL(blob);
    });

  const readText = file =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("Could not read file."));
      r.readAsText(file);
    });

  function pickFile(accept = "*/*", multiple = false) {
    return new Promise(resolve => {
      const input = h("input", { type: "file", accept, style: { display: "none" } });
      if (multiple) input.multiple = true;
      input.addEventListener("change", () => {
        resolve(multiple ? [...input.files] : input.files[0] || null);
        input.remove();
      });
      document.body.append(input);
      input.click();
    });
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("Could not load image."));
      img.src = src;
    });
  }

  /** Re-encode an image (data URL / object URL) within maxSide pixels. */
  async function encodeImage(src, { maxSide = 1536, type = "image/png", quality = 0.9 } = {}) {
    const img = await loadImage(src);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL(type, quality);
    if (type === "image/webp" && !out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", quality);
    return out;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard", "good");
    } catch {
      toast("Copy failed — your browser blocked clipboard access.", "bad");
    }
  }

  /* --- Safe HTML (for AI-written documents) --- */
  const SAFE_TAGS = new Set(["H1","H2","H3","H4","P","BR","HR","B","STRONG","I","EM","U","S","UL","OL","LI","BLOCKQUOTE","PRE","CODE","TABLE","THEAD","TBODY","TR","TH","TD","A","SPAN","DIV","SUB","SUP","IMG"]);
  function sanitizeHTML(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const walk = node => {
      for (const child of [...node.children]) {
        if (!SAFE_TAGS.has(child.tagName)) {
          if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"].includes(child.tagName)) child.remove();
          else child.replaceWith(...child.childNodes);
          continue;
        }
        for (const attr of [...child.attributes]) {
          const name = attr.name.toLowerCase();
          const ok =
            (name === "href" && child.tagName === "A" && /^(https?:|mailto:|#)/i.test(attr.value)) ||
            (name === "src" && child.tagName === "IMG" && /^(https:|data:image\/)/i.test(attr.value)) ||
            ["colspan", "rowspan", "alt", "title"].includes(name);
          if (!ok) child.removeAttribute(attr.name);
        }
        if (child.tagName === "A") child.setAttribute("rel", "noopener noreferrer");
        walk(child);
      }
    };
    const root = doc.body.firstElementChild;
    walk(root);
    return root.innerHTML;
  }

  /* --- Minimal, safe Markdown renderer for chat --- */
  function renderMarkdown(src) {
    const blocks = [];
    let text = String(src || "").replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre><code data-lang="${esc(lang)}">${esc(code.replace(/\n$/, ""))}</code></pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    text = esc(text);
    const inline = s =>
      s
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const lines = text.split("\n");
    let html = "";
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) html += `<p>${inline(para.join("<br>"))}</p>`;
      para = [];
    };
    const closeList = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^\u0000\d+\u0000$/.test(line.trim())) {
        flushPara();
        closeList();
        html += line.trim();
      } else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
        flushPara();
        closeList();
        html += `<h${Math.min(3, m[1].length)}>${inline(m[2])}</h${Math.min(3, m[1].length)}>`;
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
        flushPara();
        if (list !== "ul") {
          closeList();
          html += "<ul>";
          list = "ul";
        }
        html += `<li>${inline(m[1])}</li>`;
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
        flushPara();
        if (list !== "ol") {
          closeList();
          html += "<ol>";
          list = "ol";
        }
        html += `<li>${inline(m[1])}</li>`;
      } else if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
        flushPara();
        closeList();
        const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
        html += "<table><tr>" + cells(line).map(c => `<th>${c}</th>`).join("") + "</tr>";
        i++;
        while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1])) {
          i++;
          html += "<tr>" + cells(lines[i]).map(c => `<td>${c}</td>`).join("") + "</tr>";
        }
        html += "</table>";
      } else if (!line.trim()) {
        flushPara();
        closeList();
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
    return html.replace(/\u0000(\d+)\u0000/g, (_, n) => blocks[n]);
  }

  /** Pull a JSON object out of a model reply (handles fences and chatter). */
  function extractJSON(reply) {
    let text = String(reply || "").trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
    const first = Math.min(...["{", "["].map(c => (text.indexOf(c) < 0 ? Infinity : text.indexOf(c))));
    const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (first !== Infinity && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        /* ignore */
      }
    }
    throw new Error("The AI reply was not valid JSON. Try again.");
  }

  /** Simple line diff (LCS) for review screens. */
  function lineDiff(a, b) {
    const A = String(a).split("\n");
    const B = String(b).split("\n");
    if (A.length * B.length > 4e6) return [{ t: "del", s: "(file too large for inline diff — showing new version)" }, ...B.map(s => ({ t: "add", s }))];
    const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0,
      j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) out.push({ t: "same", s: A[i++], _: j++ });
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", s: A[i++] });
      else out.push({ t: "add", s: B[j++] });
    }
    while (i < A.length) out.push({ t: "del", s: A[i++] });
    while (j < B.length) out.push({ t: "add", s: B[j++] });
    return out;
  }

  function renderDiff(a, b) {
    const box = h("div", { class: "diff" });
    const rows = lineDiff(a, b);
    let added = 0,
      removed = 0;
    rows.forEach(r => {
      if (r.t === "add") added++;
      if (r.t === "del") removed++;
      box.append(h("div", { class: r.t }, (r.t === "add" ? "+ " : r.t === "del" ? "- " : "  ") + r.s));
    });
    return { el: box, added, removed };
  }

  Object.assign(SA, { $, $$, h, esc, uid, debounce, fmtDate, fmtBytes, download, dataUrlToBlob, blobToDataUrl, readText, pickFile, loadImage, encodeImage, copyText, sanitizeHTML, renderMarkdown, extractJSON, lineDiff, renderDiff });

  /* ====================================================================== */
  /* UI: toasts and modals                                                  */
  /* ====================================================================== */
  function toast(message, kind = "") {
    let host = $(".toasts");
    if (!host) document.body.append((host = h("div", { class: "toasts", role: "status", "aria-live": "polite" })));
    const t = h("div", { class: "toast " + kind }, message);
    host.append(t);
    setTimeout(() => t.remove(), kind === "bad" ? 7000 : 3800);
  }

  /** modal({title, body, actions:[{label, kind, value, onClick}], wide}) → Promise(value) */
  function modal({ title, body, actions = [{ label: "Close", value: null }], wide = false, dismissable = true }) {
    return new Promise(resolve => {
      const back = h("div", { class: "modal-back" });
      const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title });
      const close = value => {
        back.remove();
        document.removeEventListener("keydown", onKey);
        resolve(value);
      };
      const onKey = e => {
        if (e.key === "Escape" && dismissable) close(null);
      };
      document.addEventListener("keydown", onKey);
      if (dismissable) back.addEventListener("mousedown", e => e.target === back && close(null));
      const foot = h("div", { class: "modal-foot" });
      actions.forEach(a =>
        foot.append(
          h("button", {
            class: "btn " + (a.kind || ""),
            type: "button",
            onclick: async () => {
              if (a.onClick) {
                const r = await a.onClick();
                if (r === false) return;
                close(r === undefined ? a.value : r);
              } else close(a.value);
            }
          }, a.label)
        )
      );
      box.append(h("h2", {}, title), typeof body === "string" ? h("div", { class: "muted", html: body }) : body || "", foot);
      back.append(box);
      document.body.append(back);
      setTimeout(() => (box.querySelector("input,textarea,select") || foot.lastChild)?.focus(), 30);
    });
  }

  const confirmBox = (title, message, { danger = false, ok = "Confirm" } = {}) =>
    modal({
      title,
      body: h("p", { class: "muted" }, message),
      actions: [
        { label: "Cancel", value: false },
        { label: ok, kind: danger ? "danger" : "primary", value: true }
      ]
    });

  function promptBox(title, { label = "", value = "", placeholder = "", multiline = false, ok = "Save" } = {}) {
    const input = multiline
      ? h("textarea", { class: "textarea", placeholder })
      : h("input", { class: "input", placeholder, onkeydown: e => e.key === "Enter" && e.target.closest(".modal").querySelector(".btn.primary").click() });
    input.value = value;
    return modal({
      title,
      body: h("div", {}, label ? h("label", { class: "lbl" }, label) : "", input),
      actions: [
        { label: "Cancel", value: null },
        { label: ok, kind: "primary", onClick: () => input.value }
      ]
    });
  }

  Object.assign(SA, { toast, modal, confirm: confirmBox, prompt: promptBox });

  /* ====================================================================== */
  /* API client                                                              */
  /* ====================================================================== */
  function guestId() {
    let id = localStorage.getItem("nova_user_id"); // legacy key kept on purpose
    if (!id || !/^[a-zA-Z0-9_-]{20,80}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID() : uid("guest");
      localStorage.setItem("nova_user_id", id);
    }
    return id;
  }

  async function api(action, payload = {}, { timeout = 120000 } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (SA.state.token) headers.Authorization = "Bearer " + SA.state.token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetch(SA.config.API, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, userId: guestId(), ...payload }),
        signal: controller.signal
      });
    } catch (e) {
      const err = new Error(e.name === "AbortError" ? "The request timed out." : "Could not reach the Success AI server. Check your connection.");
      err.offline = e.name !== "AbortError";
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || "Server error (HTTP " + res.status + ")");
      err.status = res.status;
      err.code = data.code;
      err.data = data;
      if (res.status === 401 && data.code === "AUTH_REQUIRED" && SA.state.token) auth.expire();
      if (data.code === "CREDITS") setTimeout(() => SA.buyCredits?.({ needed: data.needed, reason: data.error }), 0);
      if (data.code === "SIGN_IN") setTimeout(() => SA.askSignIn?.(data.error), 0);
      throw err;
    }
    return data;
  }

  async function serverStatus() {
    try {
      const res = await fetch(SA.config.API, { method: "GET" });
      SA.state.serverStatus = await res.json();
    } catch {
      SA.state.serverStatus = { status: "offline" };
    }
    emit("status");
    return SA.state.serverStatus;
  }

  /** Convenience for text generation tasks. */
  async function ai(task, input, { maxTokens, messages } = {}) {
    const data = await api("ai_task", messages ? { task, messages, maxTokens } : { task, input, maxTokens }, { timeout: 180000 });
    return data.reply;
  }

  Object.assign(SA, { api, ai, guestId, serverStatus });

  /** Binary download through the worker (used for provider-hosted results that lack CORS). */
  async function apiBlob(action, payload = {}, { timeout = 300000 } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (SA.state.token) headers.Authorization = "Bearer " + SA.state.token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(SA.config.API, { method: "POST", headers, body: JSON.stringify({ action, userId: guestId(), ...payload }), signal: controller.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed (HTTP " + res.status + ")");
      }
      return await res.blob();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Get a generated file (video/music URL) as a Blob. */
  async function fetchResult(url) {
    if (!url) throw new Error("Missing file URL.");
    if (url.startsWith("data:")) return dataUrlToBlob(url);
    return apiBlob("media_proxy", { url });
  }

  /** Poll a video job until it finishes. onUpdate receives each status payload. */
  async function waitForVideo(jobId, { onUpdate, isCancelled, maxMs = 25 * 60000 } = {}) {
    const t0 = Date.now();
    let delay = 4000;
    while (Date.now() - t0 < maxMs) {
      if (isCancelled?.()) throw new Error("Cancelled.");
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(10000, delay + 1000);
      let st;
      try {
        st = await api("video_status", { jobId });
      } catch (e) {
        if (e.status === 404) throw e;
        continue; // network blip — keep waiting
      }
      onUpdate?.({ ...st, elapsed: Math.round((Date.now() - t0) / 1000) });
      if (st.status === "completed" && st.url) return st;
      if (st.status === "failed") throw new Error(st.error || "Video generation failed.");
    }
    throw new Error("The video is taking unusually long. It may still finish — check the Clips tab later.");
  }

  /* ---------- engines ---------- */
  const FALLBACK_ENGINES = {
    video: [{ id: "agnes-flash", label: "Agnes Video 2.5 Flash", tier: "free", status: "ready", min: 4, max: 12, ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], modes: ["text"], maxRefs: 0 }],
    image: [{ id: "flux-klein", label: "FLUX.2 Klein", tier: "free", status: "ready", edit: true, maxRefs: 3, resolutions: ["1K"] }],
    music: []
  };
  function engines(kind) {
    return SA.state.serverStatus?.engines?.[kind] || FALLBACK_ENGINES[kind] || [];
  }
  function engine(kind, id) {
    return engines(kind).find(e => e.id === id) || null;
  }
  /** "ready" on the server and usable by this user (premium engines need an account). */
  const usable = e => e.status === "ready" && (e.tier === "free" || !!SA.state.user);
  function readyEngines(kind) {
    return engines(kind).filter(usable);
  }
  const ENGINE_NOTE = { "premium-off": "coming soon", "missing-agnes-key": "unavailable", "missing-ai-binding": "unavailable" };
  /** <select> of engines for a kind; keeps itself up to date when the server status loads. */
  function engineSelect(kind, { value, onChange, filter } = {}) {
    const sel = h("select", { class: "select", "aria-label": kind + " engine" });
    const fill = () => {
      const cur = sel.value || value;
      const list = engines(kind).filter(e => !filter || filter(e));
      const price = e => {
        const p = SA.state.credits?.pricing?.[e.id];
        return p ? `Pro · ${p.credits} credits/${p.per === "second" ? "s" : p.per}` : "Pro";
      };
      sel.replaceChildren(...list.map(e => h("option", { value: e.id, disabled: !usable(e) }, `${e.label} · ${e.tier === "free" ? "Free" : price(e)}${e.status !== "ready" ? " (" + (ENGINE_NOTE[e.status] || e.status) + ")" : !usable(e) ? " (free account)" : ""}`)));
      const pick = list.find(e => e.id === cur && usable(e)) || list.find(usable) || list[0];
      if (pick) sel.value = pick.id;
      onChange?.(engine(kind, sel.value));
    };
    sel.addEventListener("change", () => onChange?.(engine(kind, sel.value)));
    fill();
    on("status", fill);
    on("auth", fill);
    on("credits", fill);
    return sel;
  }
  /* ---------- Pro credits ---------- */
  async function refreshCredits() {
    try {
      SA.state.credits = await api("credits");
    } catch {
      SA.state.credits = SA.state.credits || null;
    }
    emit("credits", SA.state.credits);
    return SA.state.credits;
  }
  const refreshQuota = refreshCredits; // older name used in a few places
  const engineHelp = () => {
    const c = SA.state.credits;
    if (!SA.state.user) return "Free engines are always free. Create a free account to buy Pro credits for HD video, HD images and songs with real singing — pay with any card or local payment method, in your currency.";
    if (c?.owner) return "Owner account: Pro engines are free for you. Sales and provider costs are in Settings → Plan & credits.";
    return `You have ${c?.balance ?? 0} Pro credits. Free engines are always free; Pro engines use credits.`;
  };
  /** Credits a Pro generation will cost (0 for free engines / owner). */
  function creditCost(engineId, units = 1) {
    const p = SA.state.credits?.pricing?.[engineId];
    if (!p || SA.state.credits?.owner) return 0;
    return p.credits * units;
  }

  Object.assign(SA, { apiBlob, fetchResult, waitForVideo, engines, engine, readyEngines, engineSelect, engineHelp, refreshQuota, refreshCredits, creditCost });


  /* ====================================================================== */
  /* Event bus                                                               */
  /* ====================================================================== */
  const listeners = {};
  function on(event, fn) {
    (listeners[event] ||= []).push(fn);
  }
  function emit(event, payload) {
    (listeners[event] || []).forEach(fn => {
      try {
        fn(payload);
      } catch (e) {
        console.error(e);
      }
    });
  }
  Object.assign(SA, { on, emit });

  /* ====================================================================== */
  /* IndexedDB                                                               */
  /* ====================================================================== */
  const STORES = ["projects", "conversations", "characters", "history", "assets", "meta"];
  let dbPromise;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open("success-ai", 1);
        req.onupgradeneeded = () => STORES.forEach(s => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s, { keyPath: "id" }));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then(r => (result = r));
      tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage quota exceeded or blocked."));
    });
  }
  const idbGet = (s, id) => idb(s, "readonly", os => os.get(id));
  const idbAll = (s) => idb(s, "readonly", os => os.getAll());
  const idbPut = (s, v) => idb(s, "readwrite", os => os.put(v));
  const idbDel = (s, id) => idb(s, "readwrite", os => os.delete(id));
  SA.idb = { get: idbGet, all: idbAll, put: idbPut, del: idbDel };

  /* ====================================================================== */
  /* Accounts                                                                */
  /* ====================================================================== */
  const owner = () => (SA.state.user ? SA.state.user.id : "guest");

  const auth = {
    async refresh() {
      if (!SA.state.token) {
        SA.state.user = null;
        emit("auth");
        return null;
      }
      try {
        const { user } = await api("auth_me");
        if (!user) return auth.expire();
        SA.state.user = user;
        localStorage.setItem("sa_user", JSON.stringify(user));
        // Work done in this browser while signed out joins the account.
        await store.adoptGuestData();
      } catch (e) {
        // Offline: trust the cached user so local work continues.
        if (e.offline) SA.state.user = JSON.parse(localStorage.getItem("sa_user") || "null");
      }
      emit("auth");
      return SA.state.user;
    },
    async _complete(data) {
      SA.state.token = data.token;
      SA.state.user = data.user;
      localStorage.setItem("sa_token", data.token);
      localStorage.setItem("sa_user", JSON.stringify(data.user));
      await store.adoptGuestData();
      emit("auth");
      sync.run();
      toast("Signed in as " + data.user.email, "good");
    },
    async register(email, password, name) {
      return auth._complete(await api("auth_register", { email, password, name }));
    },
    async login(email, password) {
      return auth._complete(await api("auth_login", { email, password }));
    },
    async logout({ everywhere = false, keepLocal = false } = {}) {
      try {
        await sync.run();
        await api("auth_logout", { everywhere });
      } catch {
        /* still sign out locally */
      }
      const uidNow = owner();
      if (!keepLocal) await store.purgeOwner(uidNow);
      SA.state.user = null;
      SA.state.token = null;
      localStorage.removeItem("sa_token");
      localStorage.removeItem("sa_user");
      emit("auth");
      toast("Signed out.");
    },
    expire() {
      SA.state.user = null;
      SA.state.token = null;
      localStorage.removeItem("sa_token");
      localStorage.removeItem("sa_user");
      emit("auth");
      toast("Your session ended. Sign in again to keep syncing.", "bad");
      return null;
    }
  };
  SA.auth = auth;
  SA.owner = owner;

  /* ====================================================================== */
  /* Collections store (IndexedDB working copy + cloud sync)                 */
  /* ====================================================================== */
  const COLS = ["projects", "conversations", "characters", "history"];
  const nowISO = () => new Date().toISOString();

  const store = {
    async list(col, { includeArchived = true } = {}) {
      const all = (await idbAll(col)).filter(x => x.owner === owner());
      return all.filter(x => includeArchived || !x.archived).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async get(col, id) {
      const item = await idbGet(col, id);
      return item && item.owner === owner() ? item : null;
    },
    async save(col, item, { touch = true } = {}) {
      const existing = await idbGet(col, item.id);
      const merged = {
        version: 0,
        createdAt: nowISO(),
        favorite: false,
        archived: false,
        data: {},
        ...existing,
        ...item,
        owner: owner(),
        dirty: true,
        syncError: null
      };
      if (touch) merged.updatedAt = nowISO();
      try {
        await idbPut(col, merged);
      } catch (e) {
        toast("Could not save on this device: " + (e?.message || "storage full"), "bad");
        throw e;
      }
      emit("change:" + col, merged);
      sync.schedule();
      return merged;
    },
    async remove(col, id) {
      const item = await idbGet(col, id);
      if (!item) return;
      await idbDel(col, id);
      if (item.version > 0 && SA.state.user) {
        const tomb = JSON.parse(localStorage.getItem("sa_tombstones") || "[]");
        tomb.push({ col, id, owner: item.owner });
        localStorage.setItem("sa_tombstones", JSON.stringify(tomb));
      }
      emit("change:" + col, { id, deleted: true });
      sync.schedule();
    },
    async adoptGuestData() {
      const uidNow = owner();
      if (uidNow === "guest") return;
      for (const col of COLS) {
        for (const item of await idbAll(col)) {
          if (item.owner === "guest") await idbPut(col, { ...item, owner: uidNow, dirty: true, version: 0 });
        }
      }
      await assets.uploadGuestAssets();
    },
    async purgeOwner(ownerId) {
      if (ownerId === "guest") return;
      for (const col of [...COLS, "assets"]) {
        for (const item of await idbAll(col)) if (item.owner === ownerId) await idbDel(col, item.id);
      }
    }
  };
  SA.store = store;

  /* ---------------- Sync engine ---------------- */
  const sync = {
    state: "idle",
    lastSync: null,
    conflicts: [],
    _running: null,
    schedule: debounce(() => sync.run(), 1500),
    setState(state, detail = "") {
      sync.state = state;
      sync.detail = detail;
      emit("sync");
    },
    async run() {
      if (!SA.state.user) {
        sync.setState("guest");
        return;
      }
      if (!navigator.onLine) {
        sync.setState("offline");
        return;
      }
      if (sync._running) {
        sync._again = true; // changes arrived mid-sync: run once more afterwards
        return sync._running;
      }
      sync._running = (async () => {
        sync.setState("syncing");
        try {
          await sync.pushDeletes();
          for (const col of COLS) await sync.syncCollection(col);
          sync.lastSync = new Date();
          sync.setState(sync.conflicts.length ? "conflict" : "synced");
          if (sync.conflicts.length) sync.resolveConflicts();
        } catch (e) {
          console.warn("sync failed", e);
          sync.setState(e.offline ? "offline" : "error", e.message);
        } finally {
          sync._running = null;
          if (sync._again) {
            sync._again = false;
            setTimeout(() => sync.run(), 50);
          }
        }
      })();
      return sync._running;
    },
    async pushDeletes() {
      const tomb = JSON.parse(localStorage.getItem("sa_tombstones") || "[]");
      const remaining = [];
      for (const t of tomb) {
        if (t.owner !== owner()) {
          remaining.push(t);
          continue;
        }
        try {
          await api("col_delete", { collection: t.col, id: t.id });
        } catch (e) {
          if (e.offline) remaining.push(t);
        }
      }
      localStorage.setItem("sa_tombstones", JSON.stringify(remaining));
    },
    async syncCollection(col) {
      const me = owner();
      const local = (await idbAll(col)).filter(x => x.owner === me);
      const localMap = new Map(local.map(x => [x.id, x]));

      // 1) push local changes
      for (const item of local.filter(x => x.dirty && !x.syncBlocked)) {
        try {
          const payload = {
            collection: col,
            item: { id: item.id, kind: item.kind, title: item.title, data: item.data, projectId: item.projectId, favorite: item.favorite, archived: item.archived }
          };
          if (item.version > 0) payload.baseVersion = item.version;
          const res = await api("col_save", payload);
          const fresh = await idbGet(col, item.id);
          // Only clear "dirty" if nothing changed locally while we were uploading.
          if (fresh && fresh.updatedAt === item.updatedAt) await idbPut(col, { ...fresh, version: res.item.version, dirty: false, syncError: null });
          else if (fresh) await idbPut(col, { ...fresh, version: res.item.version });
        } catch (e) {
          if (e.status === 409 && e.data?.server) {
            if (!sync.conflicts.some(c => c.id === item.id)) sync.conflicts.push({ col, id: item.id, local: item, server: e.data.server });
          } else if (e.status === 413 || e.status === 400) {
            await idbPut(col, { ...item, syncBlocked: true, syncError: e.message });
            toast(`"${item.title}" can't sync: ${e.message}`, "bad");
          } else throw e;
        }
      }

      // 2) pull remote changes
      const { items: remote } = await api("col_list", { collection: col });
      const remoteIds = new Set();
      for (const r of remote) {
        remoteIds.add(r.id);
        const l = localMap.get(r.id);
        if (!l || (!l.dirty && (l.version || 0) < r.version)) {
          const { item } = await api("col_get", { collection: col, id: r.id });
          await idbPut(col, { ...item, owner: me, dirty: false });
          emit("change:" + col, item);
          emit("remote-update", { col, id: r.id });
        }
      }
      // 3) items deleted on another device
      for (const l of local) {
        if (l.version > 0 && !l.dirty && !remoteIds.has(l.id)) {
          await idbDel(col, l.id);
          emit("change:" + col, { id: l.id, deleted: true });
        }
      }
    },
    async resolveConflicts() {
      while (sync.conflicts.length) {
        const c = sync.conflicts[0];
        const choice = await modal({
          title: "Sync conflict",
          body: h(
            "div",
            {},
            h("p", {}, `"${c.local.title}" was changed on another device while you also edited it here.`),
            h("p", { class: "muted small" }, `This device: ${fmtDate(c.local.updatedAt)} · Cloud: ${fmtDate(c.server.updatedAt)} (v${c.server.version})`)
          ),
          dismissable: false,
          actions: [
            { label: "Use cloud version", value: "cloud" },
            { label: "Keep both", value: "both" },
            { label: "Keep this device's version", kind: "primary", value: "local" }
          ]
        });
        sync.conflicts.shift();
        const me = owner();
        if (choice === "local") {
          await api("col_save", { collection: c.col, force: true, item: { ...c.local, projectId: c.local.projectId } });
          const res = await api("col_get", { collection: c.col, id: c.id });
          await idbPut(c.col, { ...res.item, owner: me, dirty: false });
        } else if (choice === "cloud") {
          await idbPut(c.col, { ...c.server, owner: me, dirty: false });
        } else {
          await idbPut(c.col, { ...c.local, id: uid(c.col.slice(0, 4)), title: c.local.title + " (this device)", version: 0, dirty: true, owner: me });
          await idbPut(c.col, { ...c.server, owner: me, dirty: false });
        }
        emit("change:" + c.col, { id: c.id });
        emit("remote-update", { col: c.col, id: c.id });
      }
      sync.schedule();
    }
  };
  SA.sync = sync;
  window.addEventListener("online", () => sync.run());
  window.addEventListener("offline", () => sync.setState("offline"));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync.run());
  setInterval(() => document.visibilityState === "visible" && sync.run(), 60000);

  /* ====================================================================== */
  /* Assets                                                                  */
  /* ====================================================================== */
  const assetCache = new Map();
  const assets = {
    signedIn: () => !!SA.state.user,
    async list({ kind, q, projectId } = {}) {
      let items = [];
      if (assets.signedIn()) {
        try {
          const res = await api("asset_list", { kind, q, projectId });
          items = res.assets.map(a => ({ ...a, location: "cloud" }));
        } catch (e) {
          if (!e.offline) throw e;
          toast("Offline: showing assets stored on this device only.");
        }
      }
      const local = (await idbAll("assets")).filter(a => a.owner === owner());
      const ql = (q || "").toLowerCase();
      items.push(
        ...local
          .filter(a => (!kind || a.kind === kind) && (!projectId || a.projectId === projectId) && (!ql || (a.name + " " + (a.tags || []).join(" ") + " " + (a.folder || "")).toLowerCase().includes(ql)))
          .map(({ dataUrl, ...a }) => ({ ...a, location: assets.signedIn() ? "device" : "local" }))
      );
      return items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    },
    async save({ kind, name, dataUrl, url, projectId, tags = [], folder = "" }) {
      const base = { kind, name, projectId: projectId || null, tags, folder, favorite: false };
      if (assets.signedIn()) {
        try {
          const res = await api("asset_save", { asset: { ...base, dataUrl, url } }, { timeout: 180000 });
          if (dataUrl) assetCache.set(res.asset.id, dataUrl);
          emit("change:assets");
          return { ...res.asset, location: "cloud" };
        } catch (e) {
          if (e.code !== "R2_REQUIRED" && !e.offline) throw e;
          toast(e.code === "R2_REQUIRED" ? "Saved on this device only — file is too large for cloud storage until R2 is configured." : "Offline — saved on this device.", "bad");
        }
      }
      const id = uid("as");
      const mime = dataUrl ? (dataUrl.match(/^data:([^;]+)/) || [])[1] : null;
      const size = dataUrl ? Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75) : 0;
      const rec = { id, ...base, mime, size, dataUrl: dataUrl || null, url: url || null, owner: owner(), createdAt: nowISO(), updatedAt: nowISO(), storage: "device" };
      await idbPut("assets", rec);
      emit("change:assets");
      return { ...rec, location: assets.signedIn() ? "device" : "local" };
    },
    async get(id) {
      const local = await idbGet("assets", id);
      if (local && local.owner === owner()) return { asset: local, dataUrl: local.dataUrl || local.url };
      if (assetCache.has(id)) return { asset: { id }, dataUrl: assetCache.get(id) };
      const res = await api("asset_get", { id }, { timeout: 120000 });
      const src = res.dataUrl || res.asset.url;
      if (src && src.length < 8e6) assetCache.set(id, src);
      return { asset: res.asset, dataUrl: src };
    },
    async update(id, patch) {
      const local = await idbGet("assets", id);
      if (local) await idbPut("assets", { ...local, ...patch, updatedAt: nowISO() });
      else await api("asset_update", { id, ...patch });
      emit("change:assets");
    },
    async remove(id) {
      const local = await idbGet("assets", id);
      if (local) await idbDel("assets", id);
      else await api("asset_delete", { id });
      assetCache.delete(id);
      emit("change:assets");
    },
    async duplicate(id) {
      const local = await idbGet("assets", id);
      if (local) await idbPut("assets", { ...local, id: uid("as"), name: local.name + " (copy)", favorite: false, createdAt: nowISO(), updatedAt: nowISO() });
      else await api("asset_duplicate", { id });
      emit("change:assets");
    },
    async uploadGuestAssets() {
      const guest = (await idbAll("assets")).filter(a => a.owner === "guest");
      let moved = 0;
      for (const a of guest) {
        try {
          await api("asset_save", { asset: { kind: a.kind, name: a.name, dataUrl: a.dataUrl || undefined, url: a.dataUrl ? undefined : a.url, projectId: a.projectId, tags: a.tags, folder: a.folder } });
          await idbDel("assets", a.id);
          moved++;
        } catch {
          await idbPut("assets", { ...a, owner: owner() }); // keep it on this device for this account
        }
      }
      if (moved) toast(`Moved ${moved} asset(s) from this browser to your cloud library.`, "good");
    }
  };
  SA.assets = assets;

  /* ====================================================================== */
  /* Projects                                                                */
  /* ====================================================================== */
  const TYPES = {
    chat: { label: "AI Chat", icon: "✦", view: "chat", desc: "Ideas, research and planning" },
    image: { label: "Image", icon: "▧", view: "image", desc: "Generate and edit images" },
    video: { label: "Video / Film", icon: "▶", view: "video", desc: "AI video clips and films" },
    music: { label: "Music & Audio", icon: "♫", view: "music", desc: "Songs, lyrics, voice and audio" },
    document: { label: "Document", icon: "▤", view: "documents", desc: "Reports, letters, resumes" },
    website: { label: "Website", icon: "◎", view: "website", desc: "Sites and landing pages" },
    app: { label: "Application", icon: "⌘", view: "app", desc: "Multi-file apps and tools" },
    developer: { label: "Developer", icon: "⟨⟩", view: "devlab", desc: "Code analysis and fixes" }
  };
  const LEGACY_TYPE = { apps: "website", documents: "document" };

  const projects = {
    TYPES,
    activeId: localStorage.getItem("sa_active_project") || null,
    active: null,
    async list(opts) {
      return store.list("projects", opts);
    },
    async create(type, title, data = {}, { open = true } = {}) {
      const info = TYPES[type] || TYPES.chat;
      const p = await store.save("projects", { id: uid("proj"), kind: type, title: (title || "").trim() || "Untitled " + info.label, data: { ...data, instructions: data.instructions || "" } });
      await SA.history.add({ kind: "project", title: "Created " + info.label.toLowerCase() + " project: " + p.title, projectId: p.id });
      if (open) await projects.open(p.id);
      return p;
    },
    async newWithPicker(preferredType) {
      if (preferredType) {
        const name = await promptBox("New " + TYPES[preferredType].label + " project", { label: "Project name", value: "Untitled " + TYPES[preferredType].label, ok: "Create" });
        if (name === null) return null;
        return projects.create(preferredType, name);
      }
      const grid = h("div", { class: "type-grid" });
      const chosen = new Promise(resolve => {
        Object.entries(TYPES).forEach(([type, info]) =>
          grid.append(
            h("button", { class: "tile", type: "button", onclick: () => resolve(type) }, h("span", { class: "ico" }, info.icon), h("b", {}, info.label), h("small", {}, info.desc))
          )
        );
      });
      const closed = modal({ title: "What are we creating?", body: h("div", {}, h("p", { class: "muted" }, "Choose a workspace. Success AI opens the right studio and saves everything to this project."), grid), actions: [{ label: "Cancel", value: null }] });
      const type = await Promise.race([chosen, closed]);
      $(".modal-back")?.remove();
      if (!type) return null;
      return projects.newWithPicker(type);
    },
    /** Make sure the studio has a project of `type` to save into; create one silently if needed. */
    async ensure(type, suggestedTitle) {
      if (projects.active && projects.active.kind === type) return projects.active;
      const title = (suggestedTitle || "").replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled " + TYPES[type].label;
      const p = await projects.create(type, title, {}, { open: false });
      projects.setActive(p);
      toast(`Created project "${p.title}" — your work saves automatically.`, "good");
      return p;
    },
    setActive(p) {
      projects.active = p;
      projects.activeId = p ? p.id : null;
      if (p) localStorage.setItem("sa_active_project", p.id);
      else localStorage.removeItem("sa_active_project");
      emit("project");
    },
    async open(id) {
      const p = await store.get("projects", id);
      if (!p) {
        toast("Project not found.", "bad");
        return;
      }
      projects.setActive(p);
      const view = TYPES[p.kind]?.view || "chat";
      await go(view, { project: p });
      store.save("projects", { id: p.id, data: { ...p.data, lastOpenedAt: nowISO() } }, { touch: false });
    },
    /** Merge a data patch into the project. Patches to one project are applied strictly in order,
     *  so concurrent saves (e.g. several clips finishing at once) never overwrite each other. */
    _locks: new Map(),
    patch(id, dataPatch = {}, extra = {}) {
      const apply = async () => {
        const p = await store.get("projects", id);
        if (!p) return null;
        const patchObj = typeof dataPatch === "function" ? dataPatch(p.data || {}) : dataPatch;
        const saved = await store.save("projects", { ...extra, id, data: { ...p.data, ...patchObj } });
        if (projects.active?.id === id) {
          projects.active = saved;
          emit("project");
        }
        return saved;
      };
      const next = (projects._locks.get(id) || Promise.resolve()).then(apply, apply);
      projects._locks.set(id, next.catch(() => {}));
      return next;
    },
    async rename(id) {
      const p = await store.get("projects", id);
      const name = await promptBox("Rename project", { value: p.title });
      if (name === null || !name.trim()) return;
      await store.save("projects", { id, title: name.trim() });
      if (projects.active?.id === id) projects.setActive(await store.get("projects", id));
    },
    async duplicate(id) {
      const p = await store.get("projects", id);
      const copy = await store.save("projects", { id: uid("proj"), kind: p.kind, title: p.title + " (copy)", data: structuredClone(p.data), favorite: false, archived: false, version: 0, createdAt: nowISO() });
      toast("Duplicated project.", "good");
      return copy;
    },
    async toggle(id, field) {
      const p = await store.get("projects", id);
      await store.save("projects", { id, [field]: !p[field] });
    },
    async remove(id) {
      const p = await store.get("projects", id);
      if (!(await confirmBox("Delete project?", `"${p.title}" will be permanently deleted from all your devices. This cannot be undone. (Tip: Archive keeps it out of the way instead.)`, { danger: true, ok: "Delete" }))) return false;
      await store.remove("projects", id);
      if (projects.activeId === id) projects.setActive(null);
      toast("Project deleted.");
      return true;
    },
    async exportJSON(id) {
      const p = await store.get("projects", id);
      const { owner: _o, dirty: _d, syncError: _e, syncBlocked: _b, ...clean } = p;
      download(JSON.stringify({ format: "success-ai-project", version: 1, project: clean }, null, 2), p.title.replace(/[^\w-]+/g, "-") + ".successai.json", "application/json");
    },
    async importJSON(file) {
      const parsed = JSON.parse(await readText(file));
      const src = parsed.project || parsed;
      if (!src || !src.kind || !TYPES[src.kind]) throw new Error("This is not a Success AI project file.");
      return store.save("projects", { id: uid("proj"), kind: src.kind, title: (src.title || "Imported") + " (imported)", data: src.data || {}, version: 0 });
    },
    /** A compact text description of a project for project-aware AI. */
    context(p) {
      if (!p) return "";
      const studio = SA.studios[TYPES[p.kind]?.view];
      const detail = studio?.context ? studio.context(p) : JSON.stringify(p.data || {}).slice(0, 3000);
      return `Project: "${p.title}" (type: ${TYPES[p.kind]?.label || p.kind})\n${p.data?.instructions ? "Standing instructions: " + p.data.instructions + "\n" : ""}${detail}`.slice(0, 7800);
    }
  };
  SA.projects = projects;

  /* ====================================================================== */
  /* History                                                                 */
  /* ====================================================================== */
  SA.history = {
    async add({ kind, title, projectId = null, assetId = null, detail = "" }) {
      try {
        await store.save("history", { id: uid("hist"), kind, title: String(title).slice(0, 180), projectId, data: { assetId, detail: String(detail).slice(0, 400) } });
        const all = await store.list("history");
        for (const old of all.slice(300)) await store.remove("history", old.id);
      } catch {
        /* history must never block work */
      }
    }
  };

  /* ====================================================================== */
  /* Router & studios                                                        */
  /* ====================================================================== */
  /** Register a view: { id, title, icon, group, mount(el), show(opts), load(project), context(project) } */
  function studio(def) {
    SA.studios[def.id] = def;
    SA.order.push(def.id);
  }

  async function go(view, opts = {}) {
    const def = SA.studios[view] || SA.studios.home;
    const host = $("#views");
    let el = $(`#view-${def.id}`);
    if (!el) {
      el = h("section", { id: "view-" + def.id, class: "view", "data-view": def.id });
      host.append(el);
      try {
        await def.mount(el);
      } catch (e) {
        console.error(e);
        el.append(h("div", { class: "notice bad" }, "This studio failed to load: " + e.message));
      }
      def._mounted = true;
    }
    $$("#views > .view").forEach(v => (v.hidden = v !== el));
    SA.state.view = def.id;
    $$(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === def.id));
    $("#view-title").textContent = def.title;
    $("#view-kicker").textContent = def.kicker || (def.group || "Success AI").toUpperCase();
    document.title = def.title + " · Success AI";
    if (location.hash.split("?")[0] !== "#" + def.id) history.replaceState(null, "", "#" + def.id);
    $(".sidebar")?.classList.remove("open");

    // Hand the studio its project (only if types match).
    if (def.projectType) {
      const p = opts.project || (projects.active?.kind === def.projectType ? projects.active : null);
      if (def.load && (opts.project || def._loadedId !== (p?.id || null))) {
        def._loadedId = p?.id || null;
        await def.load(p);
      }
    }
    if (def.show) await def.show(opts);
    updateChip();
    window.scrollTo({ top: 0 });
  }

  function updateChip() {
    const chip = $("#project-chip");
    if (!chip) return;
    const def = SA.studios[SA.state.view];
    const p = projects.active;
    chip.replaceChildren();
    if (p && (!def?.projectType || def.projectType === p.kind || def.id === "chat")) {
      chip.append(TYPES[p.kind]?.icon + " ", h("b", {}, p.title), p.dirty && SA.state.user ? h("span", { class: "faint" }, " · unsynced") : "");
      chip.title = "Active project — click to see all projects";
    } else if (def?.projectType) {
      chip.append(h("span", {}, "No " + TYPES[def.projectType].label.toLowerCase() + " project open"));
    } else chip.append(h("span", {}, "No project selected"));
  }
  on("project", updateChip);
  on("sync", updateChip);

  Object.assign(SA, { studio, go, updateChip, TYPES });

  /* ====================================================================== */
  /* Theme                                                                   */
  /* ====================================================================== */
  SA.theme = {
    get: () => localStorage.getItem("sa_theme") || "dark",
    set(theme) {
      localStorage.setItem("sa_theme", theme);
      SA.theme.apply();
    },
    apply() {
      const t = SA.theme.get();
      const resolved = t === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : t;
      document.documentElement.dataset.theme = resolved;
      $('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f5f6fa" : "#070a12");
    }
  };
  SA.theme.apply();

  /* ====================================================================== */
  /* Migration of data from the previous version (localStorage → IndexedDB) */
  /* ====================================================================== */
  SA.migrateLegacy = async function () {
    // One-time clean-up: titles created by v2.0's migration mentioned the old name.
    if (!localStorage.getItem("sa_rename_fixed")) {
      for (const col of ["projects", "conversations"]) {
        for (const item of await idbAll(col)) {
          if (/^Earlier NOVA (project|conversation)$/.test(item.title)) await idbPut(col, { ...item, title: item.title.replace("NOVA ", ""), dirty: true, updatedAt: nowISO() });
        }
      }
      localStorage.setItem("sa_rename_fixed", "1");
    }
    if (localStorage.getItem("sa_legacy_migrated")) return;
    let count = 0;
    try {
      const legacy = JSON.parse(localStorage.getItem("nova_projects_v1") || "[]");
      for (const p of Array.isArray(legacy) ? legacy : []) {
        let type = LEGACY_TYPE[p.type] || p.type;
        if (String(p.title || "").toLowerCase().startsWith("development:")) type = "developer";
        if (!TYPES[type]) type = "chat";
        const data = { ...(p.data || {}) };
        if (type === "chat" && p.prompt) data.legacyExchange = { prompt: p.prompt, response: p.response || "" };
        if (type === "developer") data.legacyProposal = { request: p.prompt, response: p.response };
        if (type === "document" && p.data) data.html = esc(p.data.content || "").replace(/\n/g, "<br>");
        if (type === "music" && p.data) data.lyrics = p.data.lyrics || "";
        await idbPut("projects", { id: "legacy_" + String(p.id || uid("x")).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60).padEnd(8, "0"), kind: type, title: p.title || "Earlier project", data, owner: "guest", version: 0, dirty: true, favorite: false, archived: false, createdAt: p.createdAt || nowISO(), updatedAt: p.updatedAt || p.createdAt || nowISO() });
        count++;
      }
      const conv = JSON.parse(localStorage.getItem("nova_conversation_v1") || "[]");
      if (Array.isArray(conv) && conv.length) {
        await idbPut("conversations", { id: uid("conv"), kind: "chat", title: "Earlier conversation", data: { messages: conv.filter(m => m && m.content).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content), at: nowISO() })) }, owner: "guest", version: 0, dirty: true, createdAt: nowISO(), updatedAt: nowISO() });
        count++;
      }
    } catch (e) {
      console.warn("Legacy migration skipped", e);
    }
    localStorage.setItem("sa_legacy_migrated", "1"); // originals are left untouched in localStorage
    if (count) toast(`Brought ${count} earlier item(s) into Success AI.`, "good");
  };
})();
