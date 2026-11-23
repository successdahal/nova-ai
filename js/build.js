/* Success AI — Website Builder, App Builder, Developer Lab */
(() => {
  "use strict";
  const { h, studio, store, projects, toast, renderDiff, uid } = SA;

  /* ====================================================================== */
  /* Shared helpers                                                          */
  /* ====================================================================== */
  function extractHTML(reply) {
    let html = String(reply || "").trim();
    const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fenced) html = fenced[1].trim();
    const lower = html.toLowerCase();
    const start = lower.indexOf("<!doctype html");
    const alt = lower.indexOf("<html");
    const idx = start >= 0 ? start : alt;
    if (idx > 0) html = html.slice(idx);
    const end = html.toLowerCase().lastIndexOf("</html>");
    if (end > 0) html = html.slice(0, end + 7);
    if (!/<html[\s>]/i.test(html)) throw new Error("The AI didn't return a complete HTML page. Try again or simplify the request.");
    if (!/<\/html>/i.test(html)) throw new Error("The page was cut off (too long for one response). Ask for a smaller site or fewer sections.");
    return html;
  }

  /** Validate a standalone page: real checks only. */
  function validateHTML(html) {
    const out = [];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const add = (level, msg) => out.push({ level, msg });
    if (!/^\s*<!doctype html>/i.test(html)) add("warn", "Missing <!DOCTYPE html>.");
    if (!doc.title?.trim()) add("warn", "Page has no <title>.");
    if (!doc.querySelector('meta[name="viewport"]')) add("bad", "No viewport meta tag — page won't be mobile responsive.");
    if (!doc.documentElement.getAttribute("lang")) add("warn", "<html> has no lang attribute (accessibility).");
    const imgs = [...doc.images].filter(i => !i.hasAttribute("alt"));
    if (imgs.length) add("warn", `${imgs.length} image(s) without alt text.`);
    const dead = [...doc.querySelectorAll("a[href]")].filter(a => {
      const href = a.getAttribute("href");
      if (href === "#" || href === "" || /^javascript:/i.test(href)) return true;
      if (href.startsWith("#") && href.length > 1) return !doc.getElementById(decodeURIComponent(href.slice(1)));
      return false;
    });
    if (dead.length) add("bad", `${dead.length} link(s) go nowhere (href="#", javascript: or missing section id).`);
    const forms = [...doc.forms].filter(f => !f.getAttribute("action") && !/addEventListener\(\s*["']submit|onsubmit/i.test(html));
    if (forms.length) add("bad", `${forms.length} form(s) have no action or submit handler — they would do nothing.`);
    if (/http:\/\/(?!localhost)/i.test(html)) add("warn", "Loads insecure http:// resources.");
    const ids = [...doc.querySelectorAll("[id]")].map(e => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) add("warn", "Duplicate ids: " + [...new Set(dupes)].slice(0, 5).join(", "));
    if (!doc.querySelector("h1")) add("warn", "No <h1> heading.");
    if (!out.length) add("good", "All checks passed.");
    return out;
  }

  // Bridges console output + errors from preview iframes to the parent page.
  const BRIDGE = `<script>(function(){var send=function(t,a){try{parent.postMessage({__sa:1,type:t,text:[].map.call(a,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")},"*")}catch(e){}};["log","warn","error","info"].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o.apply(console,arguments)}});window.addEventListener("error",function(e){send("error",[e.message+(e.lineno?" (line "+e.lineno+")":"")])});window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled promise rejection: "+(e.reason&&e.reason.message||e.reason)])});})();<\/script>`;

  function injectBridge(html) {
    return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${BRIDGE}`) : BRIDGE + html;
  }

  /* --- ZIP (store, no compression) --- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = bytes => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.path.replace(/^\/+/, ""));
      const data = typeof f.content === "string" ? enc.encode(f.content) : f.content;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cenSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }
  SA.makeZip = makeZip;

  /** Review a set of file changes; resolves true if the user approves. */
  async function reviewChanges(oldFiles, newFiles, deleted = [], summary = "") {
    const oldMap = new Map(oldFiles.map(f => [f.path, f.content]));
    const box = h("div", { class: "stack" });
    if (summary) box.append(h("div", { class: "notice info small" }, summary));
    let total = 0;
    for (const f of newFiles) {
      const before = oldMap.get(f.path) ?? "";
      if (before === f.content) continue;
      total++;
      const d = renderDiff(before, f.content);
      box.append(h("details", { open: total <= 2 }, h("summary", { style: { cursor: "pointer", fontWeight: 700 } }, (oldMap.has(f.path) ? "Modified " : "New file ") + f.path + `  (+${d.added} −${d.removed})`), d.el));
    }
    deleted.forEach(p => {
      total++;
      box.append(h("div", { class: "notice bad small" }, "Delete " + p));
    });
    if (!total) {
      toast("The AI proposed no changes.");
      return false;
    }
    return SA.modal({
      title: `Review ${total} change(s)`,
      wide: true,
      body: h("div", {}, h("p", { class: "muted small" }, "Nothing is changed until you approve. A snapshot is saved first so you can roll back."), box),
      actions: [{ label: "Reject", value: false }, { label: "Approve & apply", kind: "primary", value: true }]
    });
  }

  /* ====================================================================== */
  /* Website Builder                                                         */
  /* ====================================================================== */
  const SITE_TYPES = ["Landing page", "Business website", "Portfolio", "Online store front-end", "Blog", "Dashboard", "Admin panel", "Event page", "Restaurant", "Personal page"];

  studio({
    id: "website",
    title: "Website Builder",
    kicker: "DESCRIBE · PREVIEW · SHIP",
    projectType: "website",
    project: null,
    versions: [],
    vIndex: -1,

    mount(el) {
      this.prompt = h("textarea", { class: "textarea", maxlength: 6000, style: { minHeight: "130px" }, placeholder: "Describe your website: purpose, sections, style, colors, content…" });
      this.siteType = h("select", { class: "select" }, ...SITE_TYPES.map(t => h("option", { value: t }, t)));
      this.editPrompt = h("textarea", { class: "textarea", placeholder: "Tell Success AI what to change: “Make the header sticky and add a pricing section”" });
      this.status = h("div", { class: "status-line" });
      this.progress = h("div", { class: "progress indeterminate", hidden: true }, h("i"));
      this.buildBtn = h("button", { class: "btn primary", onclick: () => this.build() }, "Build website");
      this.editBtn = h("button", { class: "btn primary", onclick: () => this.edit() }, "Apply change");
      this.checks = h("div", { class: "stack small" });
      this.versionsEl = h("div", { class: "stack small" });
      this.frame = h("iframe", { class: "preview-frame", title: "Website preview", sandbox: "allow-scripts allow-forms allow-popups allow-modals" });
      this.code = h("textarea", { class: "editor code", spellcheck: "false", hidden: true });
      this.consoleEl = h("div", { class: "console", hidden: true });
      this.deviceBtns = h("div", { class: "row" });
      [["Desktop", "100%"], ["Tablet", "820px"], ["Mobile", "390px"]].forEach(([l, w], i) => {
        const b = h("button", { class: "btn sm" + (i === 0 ? " active" : ""), onclick: () => { this.frame.style.width = w; this.deviceBtns.querySelectorAll(".btn").forEach(x => x.classList.toggle("active", x === b)); } }, l);
        this.deviceBtns.append(b);
      });
      this.viewToggle = h("button", { class: "btn sm", onclick: () => this.toggleCode() }, "</> Code");
      this.undoBtn = h("button", { class: "btn sm", onclick: () => this.stepVersion(-1) }, "↶ Undo");
      this.redoBtn = h("button", { class: "btn sm", onclick: () => this.stepVersion(1) }, "↷ Redo");

      el.append(
        h("div", { class: "split" },
          h("div", { class: "stack" },
            h("div", { class: "card stack" },
              h("h2", {}, "Create"),
              h("div", {}, h("label", { class: "lbl" }, "Website type"), this.siteType),
              h("div", {}, h("label", { class: "lbl" }, "Description"), this.prompt),
              h("div", { class: "row" }, this.buildBtn),
              this.progress, this.status
            ),
            h("div", { class: "card stack" }, h("h2", {}, "Edit with AI"), this.editPrompt, this.editBtn),
            h("div", { class: "card stack" }, h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Build validation"), h("button", { class: "btn sm", onclick: () => this.runChecks() }, "Run")), this.checks),
            h("div", { class: "card stack" }, h("h2", {}, "Versions"), this.versionsEl),
            h("div", { class: "card stack" }, h("h2", {}, "Publish"),
              h("p", { class: "small muted" }, "One-click deployment isn't connected yet. Your download is a complete, self-contained site:"),
              h("ol", { class: "small muted", style: { margin: 0, paddingLeft: "18px" } }, h("li", {}, "Download HTML and rename it index.html."), h("li", {}, "Upload it to a GitHub repository → Settings → Pages, or drag it into Cloudflare Pages / Netlify Drop."), h("li", {}, "Add a custom domain in that host's settings.")))
          ),
          h("div", { class: "stack" },
            h("div", { class: "row" }, this.deviceBtns, this.undoBtn, this.redoBtn, h("div", { class: "grow" }), this.viewToggle,
              h("button", { class: "btn sm", onclick: () => this.openTab() }, "↗ Open"),
              h("button", { class: "btn sm", onclick: () => this.consoleEl.hidden = !this.consoleEl.hidden }, "Console"),
              h("button", { class: "btn sm primary", onclick: () => this.download() }, "⇩ Download HTML")),
            this.frame, this.code, this.consoleEl
          )
        )
      );
      this.code.addEventListener("input", SA.debounce(() => this.applyCode(), 1200));
      window.addEventListener("message", e => {
        if (e.source !== this.frame.contentWindow || !e.data?.__sa) return;
        this.log(e.data.type, e.data.text);
      });
      this.prompt.addEventListener("input", SA.debounce(() => this.project && projects.patch(this.project.id, { prompt: this.prompt.value, siteType: this.siteType.value }), 800));
      this.render();
    },

    log(type, text) {
      const cls = type === "error" ? "err" : type === "warn" ? "warn" : "";
      this.consoleEl.append(h("div", { class: cls }, `[${type}] ${text}`));
      if (type === "error") this.consoleEl.hidden = false;
      this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    },

    html() {
      return this.versions[this.vIndex]?.html || "";
    },

    render() {
      const html = this.html();
      this.consoleEl.replaceChildren();
      this.frame.srcdoc = html ? injectBridge(html) : `<html><body style="font-family:system-ui;display:grid;place-items:center;height:90vh;color:#888;background:#fafafa"><div style="text-align:center"><div style="font-size:40px">◎</div><p>Describe a website and press <b>Build website</b>.</p></div></body></html>`;
      if (document.activeElement !== this.code) this.code.value = html;
      this.undoBtn.disabled = this.vIndex <= 0;
      this.redoBtn.disabled = this.vIndex >= this.versions.length - 1;
      this.versionsEl.replaceChildren(...(this.versions.length ? this.versions.map((v, i) => h("div", { class: "row" }, h("span", { class: "grow" + (i === this.vIndex ? "" : " muted") }, (i === this.vIndex ? "● " : "○ ") + v.label), h("span", { class: "faint" }, new Date(v.at).toLocaleTimeString()), i !== this.vIndex ? h("button", { class: "btn sm", onclick: () => { this.vIndex = i; this.persist(); this.render(); } }, "Restore") : "")).reverse() : [h("div", { class: "muted" }, "No versions yet.")]));
      if (html) this.runChecks();
    },

    async pushVersion(html, label) {
      this.versions = this.versions.slice(0, this.vIndex + 1).concat({ html, label, at: Date.now() }).slice(-15);
      this.vIndex = this.versions.length - 1;
      await this.persist();
      this.render();
    },

    async persist() {
      if (!this.project) return;
      // Keep the project under the sync size limit: drop old versions if needed.
      let versions = this.versions;
      while (JSON.stringify(versions).length > 700000 && versions.length > 1) versions = versions.slice(1);
      const offset = this.versions.length - versions.length;
      this.project = await projects.patch(this.project.id, { html: this.html(), versions, vIndex: Math.max(0, this.vIndex - offset), prompt: this.prompt.value, siteType: this.siteType.value });
    },

    stepVersion(d) {
      const n = this.vIndex + d;
      if (n < 0 || n >= this.versions.length) return;
      this.vIndex = n;
      this.persist();
      this.render();
    },

    busy(on, msg = "") {
      this.buildBtn.disabled = this.editBtn.disabled = on;
      this.progress.hidden = !on;
      this.status.className = "status-line";
      this.status.textContent = msg;
    },

    async build() {
      const desc = this.prompt.value.trim();
      if (!desc) return this.prompt.focus();
      if (this.html() && !(await SA.confirm("Build a new version?", "A brand-new site will be generated. Your current site stays in Versions so you can restore it."))) return;
      this.busy(true, "Designing and building your website… (30–90 seconds)");
      try {
        this.project = await projects.ensure("website", desc);
        const reply = await SA.ai("website", `Build a complete, polished, responsive ${this.siteType.value.toLowerCase()} from this request:\n\n${desc}\n\nRequirements: one standalone HTML document with all CSS and JavaScript inline; <!DOCTYPE html>, lang attribute, <title>, viewport meta; semantic sections with ids that match the navigation links; accessible alt text; working mobile menu; no external images unless from https://images.unsplash.com or https://picsum.photos; forms must either use mailto: or show a clear client-side confirmation and say no data is sent; mark any sample testimonials or numbers as placeholders. Return ONLY the HTML document.`, { maxTokens: 8000 });
        await this.pushVersion(extractHTML(reply), "Built: " + desc.slice(0, 40));
        this.busy(false, "Website built. Preview it, edit it, or download it.");
        SA.history.add({ kind: "website", title: "Built website: " + desc.slice(0, 70), projectId: this.project.id });
      } catch (e) {
        this.busy(false);
        this.status.className = "status-line bad";
        this.status.textContent = e.message;
      }
    },

    async edit() {
      const instruction = this.editPrompt.value.trim();
      if (!this.html()) return toast("Build a website first.");
      if (!instruction) return this.editPrompt.focus();
      this.busy(true, "Updating your website…");
      try {
        const reply = await SA.ai("website", `Here is the current website:\n\n${this.html()}\n\nApply this change: ${instruction}\n\nKeep everything else exactly as it is. Return the COMPLETE updated HTML document only.`, { maxTokens: 8000 });
        const next = extractHTML(reply);
        const ok = await SA.modal({ title: "Review change", wide: true, body: h("div", {}, h("p", { class: "small muted" }, instruction), renderDiff(this.html(), next).el), actions: [{ label: "Discard", value: false }, { label: "Apply", kind: "primary", value: true }] });
        if (ok) {
          await this.pushVersion(next, "Edit: " + instruction.slice(0, 40));
          this.editPrompt.value = "";
          this.busy(false, "Change applied. Use Undo to go back.");
        } else this.busy(false, "Change discarded.");
      } catch (e) {
        this.busy(false);
        this.status.className = "status-line bad";
        this.status.textContent = e.message;
      }
    },

    toggleCode() {
      const showCode = this.code.hidden;
      this.code.hidden = !showCode;
      this.frame.hidden = showCode;
      this.viewToggle.textContent = showCode ? "◎ Preview" : "</> Code";
      if (showCode) this.code.value = this.html();
    },

    async applyCode() {
      const val = this.code.value;
      if (val === this.html()) return;
      if (!this.project) this.project = await projects.ensure("website", "Hand-coded site");
      const last = this.versions[this.vIndex];
      if (last && last.label === "Code edit" && Date.now() - last.at < 60000) {
        last.html = val;
        last.at = Date.now();
        await this.persist();
        this.render();
      } else await this.pushVersion(val, "Code edit");
    },

    runChecks() {
      const results = validateHTML(this.html() || "<html></html>");
      this.checks.replaceChildren(...results.map(r => h("div", { class: "row nowrap" }, h("span", { class: "badge " + r.level }, r.level === "good" ? "ok" : r.level === "bad" ? "fix" : "check"), h("span", {}, r.msg))));
    },

    openTab() {
      if (!this.html()) return;
      const url = URL.createObjectURL(new Blob([this.html()], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },

    download() {
      if (!this.html()) return toast("Build a website first.");
      SA.download(this.html(), (this.project?.title || "website").replace(/[^\w-]+/g, "-").toLowerCase() + ".html", "text/html");
    },

    async load(p) {
      this.project = p;
      const d = p?.data || {};
      this.prompt.value = d.prompt || d.seed || "";
      this.siteType.value = d.siteType || SITE_TYPES[0];
      this.versions = d.versions?.length ? d.versions : d.html ? [{ html: d.html, label: "Saved", at: Date.now() }] : [];
      this.vIndex = Math.min(d.vIndex ?? this.versions.length - 1, this.versions.length - 1);
      this.render();
    },
    context(p) {
      const html = p.data?.html || "";
      const doc = new DOMParser().parseFromString(html, "text/html");
      const outline = [...doc.querySelectorAll("nav a, h1, h2, section[id]")].slice(0, 40).map(e => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}: ${e.textContent.trim().slice(0, 60)}`).join("\n");
      return `Website project (${p.data?.siteType || "site"}). Brief: ${p.data?.prompt || ""}\nStructure:\n${outline}\nHTML excerpt:\n${html.slice(0, 3500)}`;
    }
  });

  /* ====================================================================== */
  /* App Builder                                                             */
  /* ====================================================================== */
  const PLATFORMS = {
    web: { label: "Web app (HTML/CSS/JS)", hint: "Vanilla HTML, CSS and JavaScript in separate files: index.html, styles.css, app.js. No build step." },
    pwa: { label: "Installable PWA", hint: "Vanilla web app plus manifest.webmanifest, a service worker (sw.js) for offline use, and an icon.svg. No build step." },
    react: { label: "React (no build, ES modules)", hint: "React 18 loaded from https://esm.sh via an import map in index.html; components in .js files using React.createElement or htm (from esm.sh). No bundler." },
    mobile: { label: "Android / iOS (Capacitor)", hint: "A mobile-first web app in www/ (www/index.html, www/styles.css, www/app.js) plus capacitor.config.json, package.json with @capacitor/core, @capacitor/cli, @capacitor/android, @capacitor/ios, and README.md with exact build steps (npx cap add android/ios, npx cap open)." },
    desktop: { label: "Desktop (Electron)", hint: "Electron app: package.json (electron as devDependency, start script), main.js creating a BrowserWindow with contextIsolation, preload.js, and the UI in index.html, styles.css, renderer.js. README.md with run/build steps (electron-builder for Windows/macOS/Linux)." }
  };

  studio({
    id: "app",
    title: "App Builder",
    kicker: "PLAN · GENERATE · TEST · EXPORT",
    projectType: "app",
    project: null,
    files: [],
    active: null,

    mount(el) {
      this.desc = h("textarea", { class: "textarea", style: { minHeight: "110px" }, placeholder: "Describe the application: who it's for, features, screens, data it stores…" });
      this.platform = h("select", { class: "select" }, ...Object.entries(PLATFORMS).map(([k, v]) => h("option", { value: k }, v.label)));
      this.status = h("div", { class: "status-line" });
      this.progress = h("div", { class: "progress indeterminate", hidden: true }, h("i"));
      this.planEl = h("div", { class: "md small", style: { maxHeight: "300px", overflow: "auto" } });
      this.tree = h("div", { class: "file-tree" });
      this.editor = h("textarea", { class: "editor code", spellcheck: "false", placeholder: "Select a file" });
      this.fileLabel = h("b", { class: "grow", style: { fontFamily: "var(--mono)", fontSize: "13px" } });
      this.frame = h("iframe", { class: "preview-frame", style: { height: "56vh" }, title: "App preview", sandbox: "allow-scripts allow-forms allow-modals allow-popups" });
      this.consoleEl = h("div", { class: "console" });
      this.changeInput = h("textarea", { class: "textarea", placeholder: "Ask for a change: “Add a dark mode toggle” or “Store tasks in IndexedDB instead”" });
      this.snapEl = h("div", { class: "stack small" });
      const tabs = h("div", { class: "tabs" });
      this.codePane = h("div", { class: "stack" }, h("div", { class: "row" }, this.fileLabel, h("button", { class: "btn sm", onclick: () => this.newFile() }, "＋ File"), h("button", { class: "btn sm", onclick: () => this.renameFile() }, "Rename"), h("button", { class: "btn sm danger", onclick: () => this.deleteFile() }, "Delete")), this.editor);
      this.previewPane = h("div", { class: "stack" }, h("div", { class: "row" }, h("button", { class: "btn sm primary", onclick: () => this.runPreview() }, "▶ Run"), h("button", { class: "btn sm", onclick: () => this.runChecks() }, "✓ Run checks"), h("button", { class: "btn sm", onclick: () => this.fixErrors() }, "🛠 Fix errors with AI"), h("button", { class: "btn sm ghost", onclick: () => this.consoleEl.replaceChildren() }, "Clear console")), this.frame, this.consoleEl);
      const sel = name => {
        tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.t === name));
        this.codePane.hidden = name !== "code";
        this.previewPane.hidden = name !== "preview";
        if (name === "preview") this.runPreview();
      };
      tabs.append(h("button", { class: "tab", "data-t": "code", onclick: () => sel("code") }, "Code"), h("button", { class: "tab", "data-t": "preview", onclick: () => sel("preview") }, "Preview & test"));
      this.selectPane = sel;

      el.append(
        h("div", { class: "split" },
          h("div", { class: "stack" },
            h("div", { class: "card stack" },
              h("div", {}, h("label", { class: "lbl" }, "Platform"), this.platform),
              h("div", {}, h("label", { class: "lbl" }, "Describe your app"), this.desc),
              h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.plan() }, "1 · Plan architecture"), h("button", { class: "btn primary", onclick: () => this.generate() }, "2 · Generate project")),
              this.progress, this.status, this.planEl
            ),
            h("div", { class: "card stack" }, h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Files"), h("button", { class: "btn sm", onclick: () => this.importFiles() }, "⇧ Import")), this.tree),
            h("div", { class: "card stack" }, h("h2", {}, "Change with AI"), this.changeInput, h("button", { class: "btn primary", onclick: () => this.requestChange(this.changeInput.value) }, "Propose changes")),
            h("div", { class: "card stack" }, h("h2", {}, "Snapshots"), this.snapEl),
            h("div", { class: "card stack" }, h("h2", {}, "Export"),
              h("button", { class: "btn", onclick: () => this.exportZip() }, "⇩ Download source (.zip)"),
              h("button", { class: "btn", onclick: () => SA.go("devlab", { appProject: this.project?.id }) }, "⟨⟩ Open in Developer Lab"),
              h("details", { class: "small muted" }, h("summary", {}, "Push to GitHub"), h("pre", { class: "code", style: { whiteSpace: "pre-wrap" } }, "unzip app.zip -d my-app && cd my-app\ngit init && git add . && git commit -m \"Initial commit from Success AI\"\ngit branch -M main\ngit remote add origin https://github.com/<you>/<repo>.git\ngit push -u origin main")),
              h("div", { class: "notice small" }, "Native packages (APK, IPA, EXE, DMG) are built on your computer with the steps in the generated README — browsers can't run Android Studio, Xcode or Electron builders."))
          ),
          h("div", { class: "card stack" }, tabs, this.codePane, this.previewPane)
        )
      );
      sel("code");
      this.editor.addEventListener("input", () => {
        const f = this.files.find(x => x.path === this.active);
        if (f) {
          f.content = this.editor.value;
          this.saveSoon();
        }
      });
      this.editor.addEventListener("keydown", e => {
        if (e.key === "Tab") {
          e.preventDefault();
          document.execCommand("insertText", false, "  ");
        }
      });
      this.saveSoon = SA.debounce(() => this.persist(), 900);
      window.addEventListener("message", e => {
        if (e.source !== this.frame.contentWindow || !e.data?.__sa) return;
        this.log(e.data.type, e.data.text);
      });
      this.desc.addEventListener("input", SA.debounce(() => this.project && projects.patch(this.project.id, { description: this.desc.value, platform: this.platform.value }), 800));
      this.renderTree();
    },

    log(type, text) {
      this.consoleEl.append(h("div", { class: type === "error" ? "err" : type === "warn" ? "warn" : type === "ok" ? "ok" : "" }, `[${type}] ${text}`));
      this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    },

    busy(on, msg = "") {
      this.progress.hidden = !on;
      this.status.className = "status-line";
      this.status.textContent = msg;
    },
    fail(e) {
      this.busy(false);
      this.status.className = "status-line bad";
      this.status.textContent = e.message;
    },

    async persist(snapshots) {
      if (!this.project) return;
      const data = { files: this.files, activeFile: this.active, description: this.desc.value, platform: this.platform.value };
      if (snapshots) data.snapshots = snapshots;
      if (JSON.stringify(data).length > 800000) {
        data.snapshots = (snapshots || this.project.data.snapshots || []).slice(-2);
        toast("Project is large — keeping only the 2 latest snapshots so it can sync.", "bad");
      }
      this.project = await projects.patch(this.project.id, data);
    },

    async snapshot(label) {
      const snaps = [...(this.project?.data?.snapshots || []), { label, at: Date.now(), files: structuredClone(this.files) }].slice(-8);
      await this.persist(snaps);
      this.renderSnapshots();
    },

    renderSnapshots() {
      const snaps = this.project?.data?.snapshots || [];
      this.snapEl.replaceChildren(...(snaps.length ? snaps.slice().reverse().map(s => h("div", { class: "row" }, h("span", { class: "grow" }, s.label), h("span", { class: "faint" }, new Date(s.at).toLocaleString()), h("button", { class: "btn sm", onclick: async () => {
        if (!(await SA.confirm("Restore snapshot?", `Files will return to “${s.label}”. Your current files are snapshotted first.`))) return;
        await this.snapshot("Before restore");
        this.files = structuredClone(s.files);
        this.active = this.files[0]?.path || null;
        await this.persist();
        this.renderTree();
        this.openFile(this.active);
      } }, "Restore"))) : [h("div", { class: "muted" }, "Snapshots are saved automatically before every AI change.")]));
    },

    renderTree() {
      const sorted = [...this.files].sort((a, b) => a.path.localeCompare(b.path));
      this.tree.replaceChildren(...(sorted.length ? sorted.map(f => h("button", { class: "file-item" + (f.path === this.active ? " active" : ""), title: f.path, onclick: () => this.openFile(f.path) }, f.path, h("span", { class: "faint" }, "  " + SA.fmtBytes(new Blob([f.content]).size)))) : [h("div", { class: "muted small" }, "No files yet — describe your app and press Generate.")]));
    },

    openFile(path) {
      const f = this.files.find(x => x.path === path);
      this.active = f ? f.path : null;
      this.fileLabel.textContent = f ? f.path : "No file selected";
      this.editor.value = f ? f.content : "";
      this.editor.disabled = !f;
      this.renderTree();
      this.selectPane("code");
    },

    async newFile() {
      const path = await SA.prompt("New file", { label: "Path, e.g. utils.js or css/theme.css", ok: "Create" });
      if (!path || !path.trim()) return;
      const clean = path.trim().replace(/^\/+/, "");
      if (this.files.some(f => f.path === clean)) return toast("That file already exists.", "bad");
      if (!this.project) this.project = await projects.ensure("app", this.desc.value || "New app");
      this.files.push({ path: clean, content: "" });
      await this.persist();
      this.openFile(clean);
    },
    async renameFile() {
      const f = this.files.find(x => x.path === this.active);
      if (!f) return;
      const path = await SA.prompt("Rename file", { value: f.path });
      if (!path || !path.trim() || path === f.path) return;
      if (this.files.some(x => x.path === path.trim())) return toast("A file with that name exists.", "bad");
      f.path = path.trim();
      this.active = f.path;
      await this.persist();
      this.renderTree();
      this.fileLabel.textContent = f.path;
    },
    async deleteFile() {
      const f = this.files.find(x => x.path === this.active);
      if (!f || !(await SA.confirm("Delete file?", f.path + " will be removed. (A snapshot is saved first.)", { danger: true, ok: "Delete" }))) return;
      await this.snapshot("Before deleting " + f.path);
      this.files = this.files.filter(x => x !== f);
      await this.persist();
      this.openFile(this.files[0]?.path);
    },
    async importFiles() {
      const list = await SA.pickFile("*/*", true);
      if (!list?.length) return;
      if (!this.project) this.project = await projects.ensure("app", "Imported app");
      for (const f of list) {
        if (f.size > 300000) {
          toast(f.name + " skipped (over 300 KB).", "bad");
          continue;
        }
        const content = await SA.readText(f);
        const existing = this.files.find(x => x.path === f.name);
        if (existing) {
          if (!(await SA.confirm("Overwrite " + f.name + "?", "A file with this name already exists in the project."))) continue;
          existing.content = content;
        } else this.files.push({ path: f.name, content });
      }
      await this.persist();
      this.renderTree();
    },

    /* ---------- AI ---------- */
    filesForPrompt(limit = 60000) {
      let budget = limit;
      return this.files.map(f => {
        const c = f.content.length > budget ? f.content.slice(0, Math.max(0, budget)) + "\n/* …truncated… */" : f.content;
        budget -= c.length;
        return `--- FILE: ${f.path} ---\n${c}`;
      }).join("\n\n");
    },

    parseFiles(reply) {
      const parsed = SA.extractJSON(reply);
      const files = (parsed.files || []).filter(f => f && typeof f.path === "string" && typeof f.content === "string").map(f => ({ path: f.path.replace(/^\.?\/+/, ""), content: f.content }));
      if (!files.length) throw new Error("The AI didn't return any files. Try again with a simpler description.");
      return { files, summary: String(parsed.summary || ""), deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [] };
    },

    async plan() {
      const desc = this.desc.value.trim();
      if (!desc) return this.desc.focus();
      this.busy(true, "Analyzing requirements and planning architecture…");
      try {
        this.project = await projects.ensure("app", desc);
        const p = PLATFORMS[this.platform.value];
        const reply = await SA.ai("code", `Plan the architecture for this application.\nApp: ${desc}\nPlatform: ${p.label}. ${p.hint}\n\nGive: 1) requirements & user stories, 2) screens/components, 3) data model, 4) file structure, 5) APIs/integrations (be explicit about anything needing a server or keys), 6) test plan. Be concise.`, { maxTokens: 2500 });
        await projects.patch(this.project.id, { plan: reply, description: desc, platform: this.platform.value });
        this.project = await store.get("projects", this.project.id);
        this.planEl.innerHTML = SA.renderMarkdown(reply);
        this.busy(false, "Plan ready. Review it, then Generate project.");
      } catch (e) {
        this.fail(e);
      }
    },

    async generate() {
      const desc = this.desc.value.trim();
      if (!desc) return this.desc.focus();
      if (this.files.length && !(await SA.confirm("Generate a new project?", "Your current files will be replaced. A snapshot is saved first so you can restore them."))) return;
      this.busy(true, "Generating your project files… (30–120 seconds)");
      try {
        this.project = await projects.ensure("app", desc);
        if (this.files.length) await this.snapshot("Before regenerate");
        const p = PLATFORMS[this.platform.value];
        const plan = this.project.data?.plan ? `\nFollow this plan:\n${this.project.data.plan.slice(0, 5000)}` : "";
        const reply = await SA.ai("app", `Create a complete, working project.\nApp: ${desc}\nPlatform: ${p.label}. ${p.hint}${plan}\n\nRules: every feature must actually work; persist data with localStorage/IndexedDB unless a server is required (then include a clearly marked stub and explain in README.md); include README.md; keep total size reasonable. Respond ONLY with JSON: {"summary":"...","files":[{"path":"...","content":"..."}]}`, { maxTokens: 8000 });
        const { files, summary } = this.parseFiles(reply);
        this.files = files;
        this.active = files.find(f => /index\.html$/.test(f.path))?.path || files[0].path;
        await this.persist();
        this.renderTree();
        this.openFile(this.active);
        this.busy(false, `Generated ${files.length} files. ${summary}`.slice(0, 300));
        SA.history.add({ kind: "app", title: "Generated app: " + desc.slice(0, 60), projectId: this.project.id, detail: summary });
        this.selectPane("preview");
      } catch (e) {
        this.fail(e);
      }
    },

    async requestChange(instruction, extraContext = "") {
      instruction = String(instruction || "").trim();
      if (!this.files.length) return toast("Generate or import files first.");
      if (!instruction) return this.changeInput.focus();
      this.busy(true, "Working on your change…");
      try {
        const reply = await SA.ai("app", `Project files:\n${this.filesForPrompt()}\n${extraContext}\nRequested change: ${instruction}\n\nReturn ONLY JSON: {"summary":"what you changed","files":[ONLY the files you changed or added, each with COMPLETE content],"deleted":[paths to delete, usually empty]}`, { maxTokens: 8000 });
        const { files, summary, deleted } = this.parseFiles(reply);
        this.busy(false, "Review the proposed changes.");
        if (!(await reviewChanges(this.files, files, deleted, summary))) return this.busy(false, "Changes rejected — nothing was modified.");
        await this.snapshot("Before: " + instruction.slice(0, 40));
        for (const f of files) {
          const ex = this.files.find(x => x.path === f.path);
          if (ex) ex.content = f.content;
          else this.files.push(f);
        }
        this.files = this.files.filter(f => !deleted.includes(f.path));
        await this.persist();
        this.renderTree();
        this.openFile(this.active && this.files.some(f => f.path === this.active) ? this.active : files[0].path);
        this.changeInput.value = "";
        this.busy(false, "Changes applied. " + summary);
        SA.history.add({ kind: "app", title: "Changed app: " + instruction.slice(0, 60), projectId: this.project.id });
      } catch (e) {
        this.fail(e);
      }
    },

    async fixErrors() {
      const errors = [...this.consoleEl.querySelectorAll(".err")].map(e => e.textContent).slice(-15);
      if (!errors.length) return toast("No errors in the console. Run the preview or checks first.");
      await this.requestChange("Fix these errors without changing intended behavior.", "\nErrors observed when running the app:\n" + errors.join("\n"));
    },

    /* ---------- preview & checks ---------- */
    bundle() {
      const entry = this.files.find(f => /(^|\/)index\.html$/.test(f.path));
      if (!entry) return null;
      const base = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/") + 1) : "";
      const resolve = href => {
        const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
        return this.files.find(f => f.path === base + clean || f.path === clean)?.content;
      };
      let html = entry.content;
      html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, tag => {
        const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
        if (!href || /^https?:/i.test(href)) return tag;
        const css = resolve(href);
        return css !== undefined ? `<style>/* ${href} */\n${css}</style>` : tag;
      });
      html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, a, src, b) => {
        if (/^https?:/i.test(src)) return tag;
        const js = resolve(src);
        return js !== undefined ? `<script${a}${b}>/* ${src} */\n${js.replace(/<\/script/gi, "<\\/script")}</script>` : tag;
      });
      return injectBridge(html);
    },

    runPreview() {
      const html = this.bundle();
      this.consoleEl.replaceChildren();
      if (!html) {
        this.frame.srcdoc = "<p style='font-family:system-ui;color:#888;padding:20px'>No index.html in this project — preview needs one. (Desktop/mobile projects keep their UI in index.html or www/index.html.)</p>";
        return;
      }
      if (this.files.some(f => /\.(js|mjs)$/.test(f.path) && /^\s*import\s.+from\s+["']\.\.?\//m.test(f.content))) this.log("warn", "Local ES-module imports between files can't be resolved in the inline preview. Download the project and serve it locally to test them.");
      this.frame.srcdoc = html;
      this.log("ok", "Preview started.");
    },

    runChecks() {
      this.consoleEl.replaceChildren();
      let problems = 0;
      const paths = new Set(this.files.map(f => f.path));
      for (const f of this.files) {
        if (/\.json$/i.test(f.path) || f.path.endsWith(".webmanifest")) {
          try {
            JSON.parse(f.content);
            this.log("ok", f.path + ": valid JSON");
          } catch (e) {
            problems++;
            this.log("error", f.path + ": invalid JSON — " + e.message);
          }
        } else if (/\.(js|cjs)$/i.test(f.path)) {
          if (/^\s*(import|export)\s/m.test(f.content)) {
            this.log("info", f.path + ": ES module — syntax checked when the preview runs.");
            continue;
          }
          try {
            new Function(f.content); // compiles only; does not execute
            this.log("ok", f.path + ": syntax OK");
          } catch (e) {
            problems++;
            this.log("error", f.path + ": " + e.message);
          }
        } else if (/\.html?$/i.test(f.path)) {
          const refs = [...f.content.matchAll(/(?:src|href)=["']([^"'#?]+)["']/gi)].map(m => m[1]).filter(r => !/^(https?:|mailto:|tel:|data:|\/\/)/i.test(r));
          const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
          const missing = refs.filter(r => !paths.has(dir + r.replace(/^\.\//, "")) && !paths.has(r.replace(/^\.?\//, "")));
          if (missing.length) {
            problems++;
            this.log("error", f.path + ": references missing file(s): " + [...new Set(missing)].join(", "));
          } else this.log("ok", f.path + ": all local references resolve");
        }
      }
      if (!this.files.some(f => /readme\.md$/i.test(f.path))) this.log("warn", "No README.md.");
      this.log(problems ? "error" : "ok", problems ? `${problems} problem(s) found.` : "All checks passed.");
      // Show the console without re-running the preview (which would clear these results).
      this.previewPane.hidden = false;
      this.codePane.hidden = true;
      this.previewPane.parentElement.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.t === "preview"));
    },

    exportZip() {
      if (!this.files.length) return toast("No files to export.");
      SA.download(makeZip(this.files), (this.project?.title || "app").replace(/[^\w-]+/g, "-").toLowerCase() + ".zip");
    },

    async load(p) {
      this.project = p;
      const d = p?.data || {};
      this.desc.value = d.description || d.seed || "";
      this.platform.value = d.platform || "web";
      this.files = structuredClone(d.files || []);
      this.planEl.innerHTML = d.plan ? SA.renderMarkdown(d.plan) : "";
      this.renderTree();
      this.renderSnapshots();
      this.openFile(d.activeFile || this.files[0]?.path);
      this.consoleEl.replaceChildren();
    },
    context(p) {
      const d = p.data || {};
      return `Application project (${PLATFORMS[d.platform]?.label || "web"}). Description: ${d.description || ""}\nFiles: ${(d.files || []).map(f => f.path + " (" + f.content.length + " chars)").join(", ")}\nPlan excerpt: ${(d.plan || "").slice(0, 1500)}`;
    }
  });

  /* ====================================================================== */
  /* Developer Lab                                                           */
  /* ====================================================================== */
  const MODES = {
    explain: ["Explain code", "Explain what this code does, how it's structured, and anything surprising."],
    debug: ["Debug", "Find bugs, explain root causes, and show corrected code."],
    refactor: ["Refactor", "Refactor for readability and maintainability without changing behavior. Show the improved code."],
    security: ["Security review", "Do a security review: list vulnerabilities by severity (injection, XSS, auth, secrets, unsafe input), with fixes."],
    performance: ["Performance", "Analyze performance bottlenecks and propose concrete optimizations with code."],
    tests: ["Generate tests", "Write thorough unit tests (choose the idiomatic framework for the language) covering edge cases."],
    docs: ["Documentation", "Write clear documentation: overview, API reference, usage examples, and inline doc comments."],
    architecture: ["Architecture", "Propose an architecture: components, data flow, technology choices, trade-offs and a phased plan."],
    api: ["API integration", "Explain how to integrate the described API safely: auth, requests, error handling, rate limits, with example code. Never put secrets in client code."],
    database: ["Database design", "Design the database: entities, fields, relationships, indexes, constraints and migrations (SQL)."]
  };
  const CHANGE_MODES = new Set(["debug", "refactor", "performance", "docs", "security"]);

  studio({
    id: "devlab",
    title: "Developer Lab",
    kicker: "ANALYZE · DEBUG · IMPROVE",
    projectType: "developer",
    project: null,

    mount(el) {
      this.mode = h("select", { class: "select" }, ...Object.entries(MODES).map(([k, [l]]) => h("option", { value: k }, l)));
      this.source = h("select", { class: "select", onchange: () => this.updateSource() }, h("option", { value: "paste" }, "Pasted code / description"), h("option", { value: "app" }, "An App Builder project"));
      this.appSel = h("select", { class: "select", onchange: () => this.fillFiles() });
      this.fileSel = h("select", { class: "select" });
      this.appRow = h("div", { class: "grid g2", hidden: true }, h("div", {}, h("label", { class: "lbl" }, "Project"), this.appSel), h("div", {}, h("label", { class: "lbl" }, "File"), this.fileSel));
      this.code = h("textarea", { class: "editor code", style: { minHeight: "260px" }, spellcheck: "false", placeholder: "Paste code, an error message, a schema, or describe your system…" });
      this.instruction = h("textarea", { class: "textarea", style: { minHeight: "60px" }, placeholder: "Optional: extra context or what you want (language, framework, constraints)…" });
      this.output = h("div", { class: "md" });
      this.status = h("div", { class: "status-line" });
      this.progress = h("div", { class: "progress indeterminate", hidden: true }, h("i"));
      this.proposeBtn = h("button", { class: "btn", hidden: true, onclick: () => this.proposeFileChange() }, "Propose change to this file");
      this.historyEl = h("div", { class: "stack small" });
      el.append(
        h("div", { class: "split" },
          h("div", { class: "stack" },
            h("div", { class: "card stack" },
              h("div", { class: "grid g2" }, h("div", {}, h("label", { class: "lbl" }, "Task"), this.mode), h("div", {}, h("label", { class: "lbl" }, "Source"), this.source)),
              this.appRow,
              this.code,
              this.instruction,
              h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => this.run() }, "Run analysis"), this.proposeBtn),
              this.progress, this.status,
              h("div", { class: "notice info small" }, "Developer Lab never changes files on its own. Proposed changes are shown as a diff and only applied to an App Builder project after you approve them (with a snapshot for rollback).")
            ),
            h("div", { class: "card stack" }, h("h2", {}, "Recent analyses"), this.historyEl)
          ),
          h("div", { class: "card", style: { minHeight: "60vh" } }, h("div", { class: "row", style: { marginBottom: "10px" } }, h("h2", { class: "grow", style: { margin: 0 } }, "Result"), h("button", { class: "btn sm", onclick: () => SA.copyText(this.lastReply || "") }, "Copy"), h("button", { class: "btn sm", onclick: () => this.lastReply && SA.download(this.lastReply, "success-ai-analysis.md", "text/markdown") }, "⇩ .md")), this.output)
        )
      );
    },

    async show(opts = {}) {
      await this.fillApps();
      if (opts.appProject) {
        this.source.value = "app";
        this.appSel.value = opts.appProject;
        this.updateSource();
      }
    },

    async fillApps() {
      const apps = (await projects.list({ includeArchived: false })).filter(p => p.kind === "app");
      const cur = this.appSel.value;
      this.appSel.replaceChildren(...(apps.length ? apps.map(p => h("option", { value: p.id }, p.title)) : [h("option", { value: "" }, "No App Builder projects yet")]));
      if (apps.some(a => a.id === cur)) this.appSel.value = cur;
      await this.fillFiles();
    },
    async fillFiles() {
      const p = this.appSel.value ? await store.get("projects", this.appSel.value) : null;
      const files = p?.data?.files || [];
      this.fileSel.replaceChildren(h("option", { value: "*" }, "Entire project (" + files.length + " files)"), ...files.map(f => h("option", { value: f.path }, f.path)));
    },
    updateSource() {
      const app = this.source.value === "app";
      this.appRow.hidden = !app;
      this.code.hidden = app;
      this.proposeBtn.hidden = !app;
      if (app) this.fillFiles();
    },

    async sourceText() {
      if (this.source.value === "paste") return this.code.value.trim();
      const p = await store.get("projects", this.appSel.value);
      if (!p) return "";
      const files = p.data.files || [];
      const chosen = this.fileSel.value === "*" ? files : files.filter(f => f.path === this.fileSel.value);
      let budget = 70000;
      return chosen.map(f => {
        const c = f.content.slice(0, Math.max(0, budget));
        budget -= c.length;
        return `--- FILE: ${f.path} ---\n${c}`;
      }).join("\n\n");
    },

    async run() {
      const src = await this.sourceText();
      if (!src) return toast(this.source.value === "paste" ? "Paste some code or a description first." : "Choose a project with files.");
      const [label, instr] = MODES[this.mode.value];
      this.progress.hidden = false;
      this.status.className = "status-line";
      this.status.textContent = label + "…";
      try {
        const reply = await SA.ai("code", `${instr}\n${this.instruction.value.trim() ? "Additional context: " + this.instruction.value.trim() + "\n" : ""}\n${src}`, { maxTokens: 5000 });
        this.lastReply = reply;
        this.output.innerHTML = SA.renderMarkdown(reply);
        this.output.querySelectorAll("pre").forEach(pre => pre.append(h("button", { class: "btn sm", style: { position: "absolute", top: "6px", right: "6px" }, onclick: () => SA.copyText(pre.querySelector("code").innerText) }, "Copy")));
        this.status.textContent = "Done.";
        if (!this.project) this.project = await projects.ensure("developer", label + ": " + (this.instruction.value || src).slice(0, 40));
        const runs = [...(this.project.data?.runs || []), { mode: this.mode.value, input: src.slice(0, 4000), instruction: this.instruction.value, output: reply.slice(0, 20000), at: Date.now() }].slice(-15);
        this.project = await projects.patch(this.project.id, { runs });
        this.renderHistory();
        SA.history.add({ kind: "code", title: label + " in Developer Lab", projectId: this.project.id });
        this.proposeBtn.hidden = !(this.source.value === "app" && this.fileSel.value !== "*" && CHANGE_MODES.has(this.mode.value));
      } catch (e) {
        this.status.className = "status-line bad";
        this.status.textContent = e.message;
      } finally {
        this.progress.hidden = true;
      }
    },

    async proposeFileChange() {
      const p = await store.get("projects", this.appSel.value);
      const path = this.fileSel.value;
      const file = p?.data?.files?.find(f => f.path === path);
      if (!file) return toast("Pick a single file first.");
      const [label, instr] = MODES[this.mode.value];
      this.progress.hidden = false;
      this.status.textContent = "Preparing a proposed version of " + path + "…";
      try {
        const reply = await SA.ai("code", `${instr}\n${this.instruction.value}\n${this.lastReply ? "Your earlier analysis:\n" + this.lastReply.slice(0, 6000) + "\n" : ""}\nReturn ONLY the complete new content of ${path} in a single fenced code block, nothing else.\n\n--- FILE: ${path} ---\n${file.content}`, { maxTokens: 8000 });
        const m = reply.match(/```[\w+-]*\n([\s\S]*?)```/);
        const next = (m ? m[1] : reply).replace(/\n$/, "");
        const ok = await SA.modal({ title: `${label}: review ${path}`, wide: true, body: renderDiff(file.content, next).el, actions: [{ label: "Reject", value: false }, { label: "Approve & apply", kind: "primary", value: true }] });
        if (!ok) return (this.status.textContent = "Rejected — the file was not changed.");
        const fresh = await store.get("projects", p.id);
        const snaps = [...(fresh.data.snapshots || []), { label: "Before Developer Lab: " + label + " " + path, at: Date.now(), files: structuredClone(fresh.data.files) }].slice(-8);
        const files = fresh.data.files.map(f => (f.path === path ? { ...f, content: next } : f));
        await projects.patch(p.id, { files, snapshots: snaps });
        if (SA.studios.app.project?.id === p.id) await SA.studios.app.load(await store.get("projects", p.id));
        this.status.textContent = `Applied to ${path}. A snapshot was saved in App Builder.`;
        toast("Change applied.", "good");
      } catch (e) {
        this.status.className = "status-line bad";
        this.status.textContent = e.message;
      } finally {
        this.progress.hidden = true;
      }
    },

    renderHistory() {
      const runs = (this.project?.data?.runs || []).slice().reverse();
      this.historyEl.replaceChildren(...(runs.length ? runs.map(r => h("button", { class: "btn ghost", style: { justifyContent: "flex-start" }, onclick: () => { this.lastReply = r.output; this.output.innerHTML = SA.renderMarkdown(r.output); this.mode.value = r.mode; } }, (MODES[r.mode]?.[0] || r.mode) + " · " + new Date(r.at).toLocaleString())) : [h("div", { class: "muted" }, "No analyses yet.")]));
    },

    async load(p) {
      this.project = p;
      const d = p?.data || {};
      if (d.seed && !d.runs) this.instruction.value = d.seed;
      if (d.legacyProposal) {
        this.lastReply = d.legacyProposal.response || "";
        this.output.innerHTML = SA.renderMarkdown(this.lastReply);
        this.code.value = d.legacyProposal.request || "";
      } else {
        const last = (d.runs || []).at(-1);
        this.lastReply = last?.output || "";
        this.output.innerHTML = last ? SA.renderMarkdown(last.output) : "";
      }
      this.renderHistory();
    },
    context(p) {
      const last = (p.data?.runs || []).at(-1);
      return `Developer Lab session. Last task: ${last?.mode || "none"}\nLast input excerpt:\n${(last?.input || "").slice(0, 2000)}\nLast result excerpt:\n${(last?.output || "").slice(0, 2000)}`;
    }
  });

  SA.build = { validateHTML, extractHTML, makeZip, reviewChanges };
})();
