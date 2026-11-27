/* Success AI — platform views: Home, Explore, Projects, Templates, History, Settings */
(() => {
  "use strict";
  const { h, $, studio, projects, store, toast, modal, fmtDate, TYPES } = SA;

  /* ---------------------------------------------------------------- */
  /* Shared bits                                                       */
  /* ---------------------------------------------------------------- */
  function projectCard(p, { onChange } = {}) {
    const info = TYPES[p.kind] || TYPES.chat;
    const refresh = () => onChange && onChange();
    return h(
      "article",
      { class: "item-card" },
      h("div", { class: "row nowrap" },
        h("span", { class: "badge" }, info.icon + " " + info.label),
        p.favorite ? h("span", { class: "fav", title: "Favorite" }, "★") : "",
        p.archived ? h("span", { class: "badge warn" }, "Archived") : "",
        p.syncError ? h("span", { class: "badge bad", title: p.syncError }, "Sync blocked") : ""
      ),
      h("div", { class: "title", title: p.title }, p.title),
      h("div", { class: "meta" }, "Edited " + fmtDate(p.updatedAt) + (p.version ? " · v" + p.version : SA.state.user ? " · not yet synced" : " · this device")),
      h("div", { class: "actions" },
        h("button", { class: "btn sm primary", onclick: () => projects.open(p.id) }, "Open"),
        h("button", { class: "btn sm", title: "Favorite", onclick: async () => { await projects.toggle(p.id, "favorite"); refresh(); } }, p.favorite ? "★" : "☆"),
        h("button", { class: "btn sm", onclick: () => projectMenu(p, refresh) }, "More…")
      )
    );
  }

  async function projectMenu(p, refresh) {
    const act = (label, fn, kind = "") => h("button", { class: "btn " + kind, style: { justifyContent: "flex-start" }, onclick: async () => { $(".modal-back")?.remove(); await fn(); refresh(); } }, label);
    await modal({
      title: p.title,
      body: h("div", { class: "stack" },
        act("✎ Rename", () => projects.rename(p.id)),
        act("⧉ Duplicate", () => projects.duplicate(p.id)),
        act(p.archived ? "↩ Restore from archive" : "🗄 Archive", () => projects.toggle(p.id, "archived")),
        act("⇩ Export project file (.json)", () => projects.exportJSON(p.id)),
        act("🕘 Version history", () => showVersions(p)),
        act("📝 Project instructions for AI", () => editInstructions(p)),
        act("🗑 Delete permanently", () => projects.remove(p.id), "danger")
      )
    });
  }

  async function editInstructions(p) {
    const text = await SA.prompt("Standing instructions", { label: "Success AI reads these whenever it helps with this project (tone, audience, constraints…).", value: p.data?.instructions || "", multiline: true });
    if (text === null) return;
    await projects.patch(p.id, { instructions: text.trim() });
    toast("Instructions saved.", "good");
  }

  async function showVersions(p) {
    if (!SA.state.user) {
      await modal({ title: "Version history", body: "Version history is kept in the cloud. Sign in (Settings → Account) to start recording versions of your projects." });
      return;
    }
    let versions = [];
    try {
      ({ versions } = await SA.api("project_versions", { id: p.id }));
    } catch (e) {
      toast(e.message, "bad");
      return;
    }
    const list = h("div", { class: "stack" });
    if (!versions.length) list.append(h("div", { class: "empty" }, "No earlier versions yet. A version is saved each time a synced change replaces older content."));
    versions.forEach(v =>
      list.append(
        h("div", { class: "row card", style: { padding: "10px 12px" } },
          h("div", { class: "grow" }, h("b", {}, "Version " + v.version), h("div", { class: "small muted" }, (v.title || "") + " · " + fmtDate(v.created_at) + " · " + SA.fmtBytes(v.size))),
          h("button", { class: "btn sm", onclick: async () => {
            if (!(await SA.confirm("Restore version " + v.version + "?", "The current content will be kept as a new version, so you can undo this."))) return;
            const { version } = await SA.api("project_version_get", { id: p.id, version: v.version });
            await store.save("projects", { id: p.id, data: version.data, title: version.title || p.title });
            await SA.sync.run();
            $(".modal-back")?.remove();
            toast("Restored version " + v.version + ".", "good");
            if (projects.activeId === p.id) projects.open(p.id);
          } }, "Restore")
        )
      )
    );
    await modal({ title: "Version history — " + p.title, body: list });
  }

  SA.ui = { projectCard, projectMenu, showVersions, editInstructions };

  SA.askSignIn = async message => {
    if ($(".modal-back")) return;
    const go = await modal({ title: "Create a free account", body: h("p", { class: "muted" }, message || "Sign in to use this feature."), actions: [{ label: "Not now", value: false }, { label: "Sign in / Sign up — free", kind: "primary", value: true }] });
    if (go) SA.go("settings", { tab: "account" });
  };

  /** Credit pack picker → hosted checkout (Dodo: worldwide cards/wallets/local methods; Khalti: Nepal). */
  SA.buyCredits = async ({ needed, reason } = {}) => {
    if ($(".modal-back")) return;
    if (!SA.state.user) return SA.askSignIn("Create a free account first — then you can buy Pro credits with any card or local payment method.");
    const c = (await SA.refreshCredits()) || {};
    const intl = c.payments?.dodo || [];
    const np = c.payments?.khalti || [];
    const pay = async (provider, pack, btn) => {
      btn.disabled = true;
      btn.textContent = "Opening secure checkout…";
      try {
        const { url } = await SA.api("pay_checkout", { provider, packId: pack.id });
        location.href = url;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Try again";
        toast(e.message, "bad");
      }
    };
    const packCard = (provider, p) => {
      const btn = h("button", { class: "btn primary", onclick: () => pay(provider, p, btn) }, provider === "khalti" ? `Pay NPR ${(Number(p.amount) / 100).toLocaleString()}` : `Buy${p.price ? " — " + p.price : ""}`);
      return h("div", { class: "item-card" }, h("b", {}, p.name || p.id), h("div", { style: { fontSize: "22px", fontWeight: 800 } }, "⚡ " + Number(p.credits).toLocaleString()), h("div", { class: "meta" }, "credits · never expire"), btn);
    };
    const body = h("div", { class: "stack" },
      reason ? h("div", { class: "notice small" }, reason) : "",
      h("div", { class: "small muted" }, `You have ${c.balance ?? 0} credits${needed ? ` — this needs ${needed}` : ""}.`));
    if (intl.length) body.append(h("h3", { style: { margin: "6px 0 0" } }, "🌍 Pay from anywhere"), h("div", { class: "small faint" }, "Cards, wallets and local payment methods in your own currency. Taxes included. Secure checkout by Dodo Payments."), h("div", { class: "auto-grid" }, ...intl.map(p => packCard("dodo", p))));
    if (np.length) body.append(h("h3", { style: { margin: "10px 0 0" } }, "🇳🇵 Pay in Nepal"), h("div", { class: "small faint" }, "Khalti wallet, mobile banking and connected banks, in Nepali rupees."), h("div", { class: "auto-grid" }, ...np.map(p => packCard("khalti", p))));
    if (!intl.length && !np.length) body.append(h("div", { class: "notice" }, "Payments are being set up for this site. Please check back soon — free engines work in the meantime."));
    await modal({ title: "Buy Pro credits", wide: true, body, actions: [{ label: "Close", value: null }] });
  };

  function statusBadge(value, okWords = ["ready", "configured", "connected", "online", "r2"]) {
    const v = String(value || "unknown");
    const kind = okWords.includes(v) ? "good" : v === "experimental" || v.includes("inline") ? "warn" : "bad";
    return h("span", { class: "badge " + kind }, v.replace(/-/g, " "));
  }

  /* ---------------------------------------------------------------- */
  /* Home                                                              */
  /* ---------------------------------------------------------------- */
  studio({
    id: "home",
    title: "Home",
    kicker: "YOUR CREATIVE WORKSPACE",
    async mount(el) {
      const input = h("textarea", { placeholder: "Ask Success AI anything, or describe what you want to create…\n\nExample: Plan an original Nepali short film set in the Himalayas.", "aria-label": "Message Success AI" });
      const send = () => {
        const text = input.value.trim();
        if (!text) return input.focus();
        input.value = "";
        SA.go("chat", { send: text });
      };
      input.addEventListener("keydown", e => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
      });
      this.greet = h("div", { class: "kicker", style: { color: "var(--accent)", fontWeight: 800, letterSpacing: "2px", fontSize: "11px" } });
      el.append(
        h("div", { class: "hero" }, this.greet, h("h2", {}, "Imagine it. ", h("span", { class: "grad-text" }, "Create it.")), h("p", { class: "muted", style: { maxWidth: "560px" } }, "One workspace for ideas, images, films, music, documents, websites and software — saved to your projects and synced across devices when you sign in.")),
        h("div", { class: "composer" }, input, h("div", { class: "row" }, h("span", { class: "small faint grow" }, "Ctrl/⌘ + Enter to send"), h("button", { class: "btn", onclick: () => projects.newWithPicker() }, "＋ New project"), h("button", { class: "btn primary", onclick: send }, "Send to Success AI")))
      );
      const tiles = h("div", { class: "auto-grid" });
      [
        ["image", "🎨", "Images & Art", "Generate and edit images"],
        ["video", "🎬", "Movies & Films", "AI video clips and film planning"],
        ["music", "🎵", "Music & Audio", "Lyrics, voice and audio editing"],
        ["document", "📄", "Documents", "Reports, letters and resumes"],
        ["website", "🌐", "Websites", "Describe it, preview it, ship it"],
        ["app", "💻", "Applications", "Multi-file apps with live preview"]
      ].forEach(([type, ico, label, sub]) =>
        tiles.append(h("button", { class: "tile", onclick: () => projects.newWithPicker(type) }, h("span", { class: "ico" }, ico), h("b", {}, label), h("small", {}, sub)))
      );
      el.append(h("div", { class: "section-head" }, h("h2", {}, "What do you want to make?"), h("button", { class: "btn sm ghost", onclick: () => SA.go("templates") }, "Browse templates →")), tiles);

      this.recent = h("div", { class: "auto-grid" });
      this.favs = h("div", { class: "auto-grid" });
      this.assetsBox = h("div", { class: "auto-grid" });
      this.chars = h("div", { class: "auto-grid" });
      this.activity = h("div", { class: "stack" });
      this.usage = h("div", { class: "stack small" });
      this.statusBox = h("div", { class: "stack small" });
      this.notices = h("div", { class: "stack" });
      el.append(
        this.notices,
        h("div", { class: "section-head" }, h("h2", {}, "Recent projects"), h("button", { class: "btn sm ghost", onclick: () => SA.go("projects") }, "All projects →")), this.recent,
        h("div", { class: "section-head" }, h("h2", {}, "Favorite projects")), this.favs,
        h("div", { class: "grid g2", style: { marginTop: "8px" } },
          h("div", {}, h("div", { class: "section-head" }, h("h2", {}, "Recent assets"), h("button", { class: "btn sm ghost", onclick: () => SA.go("assets") }, "Library →")), this.assetsBox),
          h("div", {}, h("div", { class: "section-head" }, h("h2", {}, "Saved characters"), h("button", { class: "btn sm ghost", onclick: () => SA.go("characters") }, "Characters →")), this.chars)
        ),
        h("div", { class: "grid g3", style: { marginTop: "8px" } },
          h("div", { class: "card" }, h("h2", {}, "Activity & generation history"), this.activity),
          h("div", { class: "card" }, h("h2", {}, "Usage (last 30 days)"), this.usage),
          h("div", { class: "card" }, h("h2", {}, "System status"), this.statusBox)
        )
      );
      SA.on("change:projects", () => SA.state.view === "home" && this.show());
      SA.on("status", () => this.renderStatus());
      SA.on("credits", () => this.renderStatus());
    },
    async show() {
      const u = SA.state.user;
      const hour = new Date().getHours();
      this.greet.textContent = (hour < 12 ? "GOOD MORNING" : hour < 18 ? "GOOD AFTERNOON" : "GOOD EVENING") + (u?.name ? ", " + u.name.toUpperCase() : "");
      const list = await projects.list({ includeArchived: false });
      const refresh = () => this.show();
      this.recent.replaceChildren(...(list.length ? list.slice(0, 6).map(p => projectCard(p, { onChange: refresh })) : [h("div", { class: "empty" }, "No projects yet — pick something to make above.")]));
      const favs = list.filter(p => p.favorite);
      this.favs.replaceChildren(...(favs.length ? favs.slice(0, 6).map(p => projectCard(p, { onChange: refresh })) : [h("div", { class: "empty small" }, "Star a project (☆) to pin it here.")]));

      this.notices.replaceChildren();
      if (!u) this.notices.append(h("div", { class: "notice info", style: { marginTop: "18px" } }, "You're working as a guest — projects are saved in this browser only. ", h("a", { href: "#settings", onclick: e => { e.preventDefault(); SA.go("settings", { tab: "account" }); } }, "Create a free account"), " to sync across phone, desktop and web."));

      SA.assets.list().then(items => {
        this.assetsBox.replaceChildren(...(items.length ? items.slice(0, 4).map(a => SA.library.assetTile(a, { compact: true })) : [h("div", { class: "empty small" }, "Generated and uploaded files appear here.")]));
      }).catch(() => this.assetsBox.replaceChildren(h("div", { class: "empty small" }, "Assets unavailable offline.")));
      store.list("characters").then(items => {
        this.chars.replaceChildren(...(items.length ? items.slice(0, 4).map(c => SA.library.characterTile(c, { compact: true })) : [h("div", { class: "empty small" }, "Create reusable characters for images and films.")]));
      });
      store.list("history").then(items => {
        this.activity.replaceChildren(...(items.length ? items.slice(0, 7).map(i => h("div", { class: "small" }, h("span", { class: "badge" }, i.kind), " ", i.title, h("span", { class: "faint" }, " · " + fmtDate(i.createdAt)))) : [h("div", { class: "muted small" }, "Nothing yet.")]));
      });
      SA.api("usage_summary").then(({ usage }) => {
        const labels = { chat: "Chat messages", generate_image: "Images generated", edit_image: "Image edits", generate_video: "Videos requested", tts: "Voice clips" };
        this.usage.replaceChildren(...(usage.length ? usage.slice(0, 8).map(r => h("div", { class: "row" }, h("span", { class: "grow" }, labels[r.action] || r.action.replace("ai_task:", "AI · ")), h("b", {}, r.total))) : [h("div", { class: "muted" }, "No AI usage recorded yet.")]));
      }).catch(() => this.usage.replaceChildren(h("div", { class: "muted" }, "Usage unavailable offline.")));
      this.renderStatus();
    },
    renderStatus() {
      const s = SA.state.serverStatus;
      if (!this.statusBox) return;
      if (!s) return this.statusBox.replaceChildren(h("div", { class: "muted" }, "Checking…"));
      const count = kind => (s.engines?.[kind] || []).filter(e => e.status === "ready").length;
      const total = kind => (s.engines?.[kind] || []).length;
      const eng = kind => (s.engines ? (count(kind) ? "ready" : "coming-soon") : "not deployed");
      const rows = [["Server", s.status === "online" ? "online" : s.status], ["Chat AI", s.chat || (s.status === "online" ? "ready" : "offline")], [`Image engines (${count("image")}/${total("image")})`, eng("image")], [`Video engines (${count("video")}/${total("video")})`, eng("video")], [`Music engines (${count("music")}/${total("music")})`, s.engines ? (count("music") ? "ready" : "coming-soon") : "not deployed"], ["Film rendering", s.filmRender ? "ready" : "not deployed"], ["Accounts & sync", s.accounts || "not deployed"], ["Large file storage", s.largeFileStorage || "not deployed"]];
      this.statusBox.replaceChildren(...rows.map(([k, v]) => h("div", { class: "row" }, h("span", { class: "grow" }, k), statusBadge(v))));
      this.statusBox.append(h("div", { class: "small faint" }, SA.engineHelp()));
      if (s.status === "online" && !s.engines) this.statusBox.append(h("div", { class: "notice bad small" }, "Your live worker is an older version. Deploy the new worker.js to enable all engines."));
    }
  });

  /* ---------------------------------------------------------------- */
  /* Explore                                                           */
  /* ---------------------------------------------------------------- */
  studio({
    id: "explore",
    title: "Explore",
    kicker: "CAPABILITIES",
    mount(el) {
      this.el = el;
    },
    show() {
      const s = SA.state.serverStatus || {};
      const caps = [
        ["chat", "✦ AI Chat", "Project-aware conversations with memory, file context, export and regeneration.", s.chat || s.status],
        ["image", "▧ Image Studio", "FLUX.2, Agnes Image 2.1 (up to 4K) and Nano Banana: generate, edit, character references, crop/resize/adjust, PNG/JPG/WebP export.", s.engines ? "ready" : s.imageStudio],
        ["video", "▶ Video Studio", "Prompt or whole story → script, consistent characters, AI clips (Agnes, Veo 3.1, Seedance 2.0, Kling 4), narration, music, subtitles → one finished MP4.", s.engines ? "ready" : s.videoStudio],
        ["music", "♫ Music Studio", "Full songs with vocals (MiniMax Music) or Lyria tracks, AI songwriting, narration voice, recording and a WAV editor.", s.engines ? ((s.engines.music || []).some(e => e.status === "ready") ? "ready" : "coming-soon") : "not deployed"],
        ["documents", "▤ Document Studio", "Rich editor with AI writing, rewrite, proofreading, translation; export PDF, Word, HTML, Markdown, TXT.", s.chat || s.status],
        ["website", "◎ Website Builder", "Describe a site, preview on desktop/tablet/mobile, edit by instruction or code, validate and download.", s.chat || s.status],
        ["app", "⌘ App Builder", "Architecture plan → multi-file project → live preview with console → AI fixes with review → ZIP export.", s.chat || s.status],
        ["devlab", "⟨⟩ Developer Lab", "Explain, debug, refactor, security review, tests and docs — with diff review before any change.", s.chat || s.status],
        ["characters", "☺ Character Library", "Reusable characters with reference images for consistent images and films.", "ready"],
        ["assets", "▦ Asset Library", "Every generated or uploaded file, searchable, taggable, reusable.", s.largeFileStorage ? "ready" : "unknown"]
      ];
      this.el.replaceChildren(
        h("p", { class: "muted" }, "Everything below is live in this build. Status badges come from your worker, so nothing is shown as working unless it's actually connected."),
        h("div", { class: "auto-grid" }, ...caps.map(([view, title, desc, st]) => h("button", { class: "tile", onclick: () => SA.go(view) }, h("div", { class: "row" }, h("b", { class: "grow" }, title), statusBadge(st)), h("small", {}, desc))))
      );
    }
  });

  /* ---------------------------------------------------------------- */
  /* My Projects                                                       */
  /* ---------------------------------------------------------------- */
  studio({
    id: "projects",
    title: "My Projects",
    kicker: "LIBRARY",
    mount(el) {
      this.q = h("input", { class: "input", placeholder: "Search projects…", oninput: SA.debounce(() => this.render(), 150), style: { maxWidth: "280px" } });
      this.type = h("select", { class: "select", style: { width: "auto" }, onchange: () => this.render() }, h("option", { value: "" }, "All types"), ...Object.entries(TYPES).map(([k, v]) => h("option", { value: k }, v.label)));
      this.sort = h("select", { class: "select", style: { width: "auto" }, onchange: () => this.render() }, h("option", { value: "updated" }, "Last edited"), h("option", { value: "created" }, "Newest"), h("option", { value: "name" }, "Name A–Z"));
      this.archived = h("input", { type: "checkbox", onchange: () => this.render() });
      this.favOnly = h("input", { type: "checkbox", onchange: () => this.render() });
      this.grid = h("div", { class: "auto-grid" });
      el.append(
        h("div", { class: "row", style: { marginBottom: "16px" } },
          this.q, this.type, this.sort,
          h("label", { class: "row small muted" }, this.favOnly, "Favorites"),
          h("label", { class: "row small muted" }, this.archived, "Show archived"),
          h("div", { class: "grow" }),
          h("button", { class: "btn", onclick: async () => { const f = await SA.pickFile(".json,application/json"); if (!f) return; try { await projects.importJSON(f); toast("Project imported.", "good"); this.render(); } catch (e) { toast(e.message, "bad"); } } }, "Import"),
          h("button", { class: "btn primary", onclick: () => projects.newWithPicker() }, "＋ New project")
        ),
        this.grid
      );
      SA.on("change:projects", SA.debounce(() => SA.state.view === "projects" && this.render(), 200));
    },
    show() {
      return this.render();
    },
    async render() {
      let items = await projects.list();
      const q = this.q.value.trim().toLowerCase();
      items = items.filter(p => (this.archived.checked || !p.archived) && (!this.favOnly.checked || p.favorite) && (!this.type.value || p.kind === this.type.value) && (!q || (p.title + " " + JSON.stringify(p.data || {}).slice(0, 2000)).toLowerCase().includes(q)));
      if (this.sort.value === "name") items.sort((a, b) => a.title.localeCompare(b.title));
      if (this.sort.value === "created") items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      this.grid.replaceChildren(...(items.length ? items.map(p => projectCard(p, { onChange: () => this.render() })) : [h("div", { class: "empty" }, q || this.type.value ? "No projects match your filters." : "No projects yet. Create one to get started.")]));
    }
  });

  /* ---------------------------------------------------------------- */
  /* Templates                                                         */
  /* ---------------------------------------------------------------- */
  const TEMPLATES = [
    { type: "website", title: "Restaurant website", desc: "Menu, gallery, opening hours, reservation call-to-action.", seed: "A warm, modern website for a Nepali restaurant in Kathmandu called 'Himalayan Hearth'. Sections: hero with call-to-action, menu with prices in NPR, gallery, opening hours, map placeholder, contact form that opens the user's email app (mailto). Earthy colors." },
    { type: "website", title: "Personal portfolio", desc: "Dark portfolio with projects grid and contact.", seed: "A dark, elegant developer portfolio with animated hero, about section, filterable projects grid, skills, timeline and a contact section using mailto." },
    { type: "website", title: "Product landing page", desc: "SaaS-style landing page with pricing.", seed: "A high-converting landing page for a productivity app: hero, feature grid, testimonials clearly marked as sample content, pricing table with monthly/yearly toggle, FAQ accordion, footer." },
    { type: "app", title: "Task manager app", desc: "Projects, tasks, due dates, local persistence.", seed: "A task manager web app with projects, tasks (title, due date, priority, done), filtering, search, dark mode and localStorage persistence. Vanilla HTML/CSS/JS." },
    { type: "app", title: "Expense tracker", desc: "Income/expenses with charts.", seed: "A personal expense tracker web app in NPR: add income/expense with category and date, monthly summary, canvas bar chart by category, CSV export, localStorage persistence." },
    { type: "document", title: "Business proposal", desc: "Structured proposal with pricing table.", html: "<h1>Business Proposal</h1><p><em>Prepared for: Client name · Date</em></p><h2>1. Executive summary</h2><p>Summarize the problem, your solution and the outcome.</p><h2>2. Objectives</h2><ul><li>Objective one</li><li>Objective two</li></ul><h2>3. Scope of work</h2><p>Describe deliverables.</p><h2>4. Timeline</h2><table><tr><th>Phase</th><th>Duration</th><th>Deliverable</th></tr><tr><td>Discovery</td><td>1 week</td><td>Requirements</td></tr><tr><td>Delivery</td><td>4 weeks</td><td>Final product</td></tr></table><h2>5. Investment</h2><p>Pricing details.</p><h2>6. Next steps</h2><p>How to proceed.</p>" },
    { type: "document", title: "Resume", desc: "Clean one-page resume.", html: "<h1>Your Name</h1><p>Email · Phone · City · Portfolio</p><h2>Summary</h2><p>Two or three lines about who you are and what you do best.</p><h2>Experience</h2><h3>Job title — Company</h3><p><em>2023 – Present</em></p><ul><li>Achievement with a measurable result</li></ul><h2>Education</h2><p>Degree — Institution, Year</p><h2>Skills</h2><p>Skill · Skill · Skill</p>" },
    { type: "document", title: "Meeting notes", desc: "Agenda, decisions, action items.", html: "<h1>Meeting notes</h1><p><strong>Date:</strong> · <strong>Attendees:</strong></p><h2>Agenda</h2><ol><li>Topic</li></ol><h2>Decisions</h2><ul><li>Decision</li></ul><h2>Action items</h2><table><tr><th>Task</th><th>Owner</th><th>Due</th></tr><tr><td></td><td></td><td></td></tr></table>" },
    { type: "video", title: "Short film", desc: "Concept → script → scenes → clips.", seed: "A 1-minute cinematic short film: a young porter in the Himalayas discovers an old camera that shows the future. Hopeful, mysterious tone." },
    { type: "video", title: "Product ad", desc: "15-second promo clips.", seed: "A 15-second energetic ad for a reusable water bottle: morning hike, city commute, gym — fast cuts, bright colors." },
    { type: "music", title: "Pop song", desc: "Verse/chorus/bridge with production notes.", seed: "An upbeat pop song about chasing dreams in a big city, bilingual English and Nepali, 112 BPM." },
    { type: "music", title: "Folk ballad", desc: "Acoustic storytelling song.", seed: "A gentle acoustic folk ballad about returning to a mountain village after years abroad, 76 BPM, nostalgic." },
    { type: "image", title: "Product photography", desc: "Studio product shot setup.", seed: "Professional studio product photograph of a handcrafted ceramic mug on a marble surface, soft window light, shallow depth of field, 85mm lens." },
    { type: "image", title: "Fantasy landscape", desc: "Epic matte-painting style scene.", seed: "Epic fantasy landscape of floating islands above the Himalayas at golden hour, waterfalls falling into clouds, cinematic matte painting." },
    { type: "developer", title: "Code review", desc: "Security + quality review of your code.", seed: "Paste code here and run a security review." },
    { type: "chat", title: "Business plan brainstorm", desc: "Start a structured planning chat.", seed: "Help me brainstorm and structure a business plan for a small online business. Ask me questions first." }
  ];
  SA.TEMPLATES = TEMPLATES;

  studio({
    id: "templates",
    title: "Templates",
    kicker: "START FAST",
    mount(el) {
      const grid = h("div", { class: "auto-grid" });
      TEMPLATES.forEach(t => {
        const info = TYPES[t.type];
        grid.append(
          h("div", { class: "item-card" },
            h("span", { class: "badge" }, info.icon + " " + info.label),
            h("div", { class: "title" }, t.title),
            h("div", { class: "meta" }, t.desc),
            h("div", { class: "actions" }, h("button", { class: "btn sm primary", onclick: () => projects.create(t.type, t.title, { seed: t.seed || "", html: t.html }) }, "Use template"))
          )
        );
      });
      el.append(h("p", { class: "muted" }, "Each template creates a new project and opens it in the right studio with a ready-to-go starting point."), grid);
    }
  });

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */
  studio({
    id: "history",
    title: "History",
    kicker: "ACTIVITY",
    mount(el) {
      this.list = h("div", { class: "stack" });
      this.filter = h("select", { class: "select", style: { width: "auto" }, onchange: () => this.show() }, h("option", { value: "" }, "All activity"), ...["project", "chat", "image", "video", "music", "document", "website", "app", "code", "asset"].map(k => h("option", { value: k }, k)));
      el.append(h("div", { class: "row", style: { marginBottom: "14px" } }, this.filter, h("div", { class: "grow" }), h("button", { class: "btn danger", onclick: async () => {
        if (!(await SA.confirm("Clear history?", "This removes the activity log only. Projects and assets are not affected.", { danger: true, ok: "Clear" }))) return;
        for (const i of await store.list("history")) await store.remove("history", i.id);
        this.show();
      } }, "Clear history")), this.list);
    },
    async show() {
      const items = (await store.list("history")).filter(i => !this.filter.value || i.kind === this.filter.value);
      this.list.replaceChildren(...(items.length ? items.map(i => h("div", { class: "card row", style: { padding: "10px 14px" } },
        h("span", { class: "badge" }, i.kind),
        h("div", { class: "grow" }, h("div", {}, i.title), i.data?.detail ? h("div", { class: "small muted" }, i.data.detail) : ""),
        h("span", { class: "small faint" }, fmtDate(i.createdAt)),
        i.projectId ? h("button", { class: "btn sm", onclick: () => projects.open(i.projectId) }, "Open project") : ""
      )) : [h("div", { class: "empty" }, "No activity yet.")]));
    }
  });

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */
  studio({
    id: "settings",
    title: "Settings",
    kicker: "ACCOUNT & PREFERENCES",
    mount(el) {
      this.tabs = h("div", { class: "tabs" });
      this.body = h("div");
      el.append(this.tabs, this.body);
      this.tab = "account";
      SA.on("auth", () => SA.state.view === "settings" && this.render());
      SA.on("credits", () => SA.state.view === "settings" && this.tab === "plan" && this.render());
    },
    show(opts = {}) {
      if (opts.tab) this.tab = opts.tab;
      this.render();
    },
    render() {
      const tabs = [["account", "Account"], ["plan", "Plan & credits"], ["appearance", "Appearance"], ["memory", "AI Memory"], ["data", "Data & Sync"], ["system", "System"], ["about", "About"]];
      this.tabs.replaceChildren(...tabs.map(([id, label]) => h("button", { class: "tab" + (this.tab === id ? " active" : ""), onclick: () => { this.tab = id; this.render(); } }, label)));
      this.body.replaceChildren();
      this["render_" + this.tab](this.body);
    },

    render_account(el) {
      const u = SA.state.user;
      if (!u) {
        const email = h("input", { class: "input", type: "email", autocomplete: "email", placeholder: "you@example.com" });
        const pass = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: "At least 8 characters" });
        const name = h("input", { class: "input", autocomplete: "name", placeholder: "Your name (optional)" });
        const status = h("div", { class: "status-line" });
        let mode = "login";
        const nameRow = h("div", { hidden: true }, h("label", { class: "lbl" }, "Name"), name);
        const submit = h("button", { class: "btn primary", type: "submit" }, "Sign in");
        const switcher = h("button", { class: "btn ghost", type: "button", onclick: () => {
          mode = mode === "login" ? "register" : "login";
          nameRow.hidden = mode === "login";
          submit.textContent = mode === "login" ? "Sign in" : "Create account";
          switcher.textContent = mode === "login" ? "New here? Create an account" : "Have an account? Sign in";
          pass.autocomplete = mode === "login" ? "current-password" : "new-password";
        } }, "New here? Create an account");
        const form = h("form", { class: "card stack", style: { maxWidth: "440px" }, onsubmit: async e => {
          e.preventDefault();
          submit.disabled = true;
          status.className = "status-line";
          status.textContent = mode === "login" ? "Signing in…" : "Creating your account…";
          try {
            if (mode === "login") await SA.auth.login(email.value, pass.value);
            else await SA.auth.register(email.value, pass.value, name.value);
            this.render();
          } catch (err) {
            status.className = "status-line bad";
            status.textContent = err.message;
          } finally {
            submit.disabled = false;
          }
        } },
          h("h2", {}, "Sign in to Success AI"),
          h("p", { class: "muted small" }, "One account for web, phone and desktop. Your projects in this browser are uploaded to your account when you sign in."),
          nameRow, h("label", { class: "lbl" }, "Email"), email, h("label", { class: "lbl" }, "Password"), pass,
          h("div", { class: "row" }, submit, switcher), status,
          h("div", { class: "notice small" }, "Email verification and password reset need an email provider, which isn't connected yet. Keep your password safe.")
        );
        el.append(form);
        return;
      }
      const sessions = h("div", { class: "stack" }, h("div", { class: "muted small" }, "Loading devices…"));
      SA.api("auth_sessions").then(({ sessions: list }) => {
        sessions.replaceChildren(...list.map(s => h("div", { class: "row card", style: { padding: "10px 12px" } },
          h("div", { class: "grow" }, h("div", { class: "small" }, (s.device || "Unknown device").slice(0, 90)), h("div", { class: "small faint" }, "Last active " + fmtDate(s.lastSeen) + (s.current ? " · this device" : ""))),
          s.current ? h("span", { class: "badge good" }, "current") : h("button", { class: "btn sm danger", onclick: async () => { await SA.api("auth_revoke_session", { sessionId: s.id }); this.render(); } }, "Sign out")
        )));
      }).catch(e => sessions.replaceChildren(h("div", { class: "status-line bad" }, e.message)));

      const cur = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: "Current password" });
      const next = h("input", { class: "input", type: "password", autocomplete: "new-password", placeholder: "New password (8+ characters)" });
      el.append(
        h("div", { class: "grid g2" },
          h("div", { class: "card stack" },
            h("h2", {}, "Profile"),
            h("div", {}, h("b", {}, u.name || "Success AI user"), h("div", { class: "muted" }, u.email), h("div", { class: "small faint" }, "Member since " + new Date(String(u.createdAt).replace(" ", "T") + "Z").toLocaleDateString())),
            h("div", { class: "row" },
              h("button", { class: "btn", onclick: () => SA.sync.run() }, "Sync now"),
              h("button", { class: "btn", onclick: async () => {
                const choice = await modal({ title: "Sign out", body: "Your work is safe in your account. Remove the copy stored in this browser too? (Recommended on shared devices.)", actions: [{ label: "Cancel", value: null }, { label: "Keep copy here", value: "keep" }, { label: "Remove copy & sign out", kind: "primary", value: "remove" }] });
                if (!choice) return;
                await SA.auth.logout({ keepLocal: choice === "keep" });
              } }, "Sign out"),
              h("button", { class: "btn", onclick: async () => { if (await SA.confirm("Sign out everywhere?", "This signs you out on all devices.")) await SA.auth.logout({ everywhere: true }); } }, "Sign out everywhere")
            )
          ),
          h("div", { class: "card stack" },
            h("h2", {}, "Change password"), cur, next,
            h("button", { class: "btn", onclick: async () => {
              try {
                await SA.api("auth_change_password", { currentPassword: cur.value, newPassword: next.value });
                cur.value = next.value = "";
                toast("Password changed. Other devices were signed out.", "good");
              } catch (e) {
                toast(e.message, "bad");
              }
            } }, "Update password")
          )
        ),
        h("div", { class: "section-head" }, h("h2", {}, "Devices")), sessions,
        h("div", { class: "section-head" }, h("h2", { style: { color: "var(--bad)" } }, "Danger zone")),
        h("div", { class: "card row" }, h("div", { class: "grow" }, h("b", {}, "Delete account"), h("div", { class: "small muted" }, "Permanently deletes your account, projects, assets, characters, memories and history from the cloud.")),
          h("button", { class: "btn danger", onclick: async () => {
            const pw = await SA.prompt("Delete account permanently", { label: "Enter your password to confirm. This cannot be undone.", ok: "Delete my account" });
            if (!pw) return;
            try {
              await SA.api("auth_delete_account", { password: pw });
              await SA.auth.logout({ keepLocal: false });
              toast("Your account and cloud data were deleted.", "good");
            } catch (e) {
              toast(e.message, "bad");
            }
          } }, "Delete account"))
      );
    },

    async render_plan(el) {
      const c = (await SA.refreshCredits()) || {};
      const u = SA.state.user;
      el.replaceChildren();
      const free = ["AI chat & writing assistant", "Images (FLUX.2, Agnes Image up to 4K)", "Standard AI video (Agnes — may be busy at peak times)", "Story → finished video editor, narration & subtitles", "Documents, websites, apps & Developer Lab", "Publish websites with a live link", "Cloud sync across all your devices"];
      const pro = ["HD video with sound: LTX-2.3, Seedance 2.0, Veo 3.1, Kling 4", "Consistent characters across a whole film", "HD images with Nano Banana 2.1", "Songs with real singing (MiniMax Music) & Lyria tracks", "Pay only for what you use — credits never expire"];
      el.append(h("div", { class: "grid g2" },
        h("div", { class: "card stack" }, h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Free"), h("span", { class: "badge good" }, "always free")), h("ul", { class: "small", style: { margin: 0, paddingLeft: "18px" } }, ...free.map(t => h("li", {}, t)))),
        h("div", { class: "card stack", style: { borderColor: "var(--accent)" } }, h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Pro credits"), h("span", { class: "badge warn" }, c.owner ? "owner: free" : u ? (c.balance ?? 0) + " credits" : "sign in")), h("ul", { class: "small", style: { margin: 0, paddingLeft: "18px" } }, ...pro.map(t => h("li", {}, t))),
          h("button", { class: "btn primary", onclick: () => SA.buyCredits() }, "⚡ Buy credits"))
      ));
      if (c.pricing) {
        const names = Object.fromEntries(["video", "image", "music"].flatMap(k => SA.engines(k).map(e => [e.id, e.label.split(" (")[0]])));
        el.append(h("div", { class: "section-head" }, h("h2", {}, "What things cost")),
          h("div", { class: "card stack small" }, ...Object.entries(c.pricing).map(([id, p]) => h("div", { class: "row" }, h("span", { class: "grow" }, names[id] || id), h("b", {}, `${p.credits} credits / ${p.per}`))),
            h("div", { class: "faint" }, "Example: a 30-second HD video with LTX-2.3 costs " + (c.pricing["ltx-2.3-fast"]?.credits || 6) * 30 + " credits. Failed generations are refunded automatically.")));
      }
      if (u && c.history?.length) {
        el.append(h("div", { class: "section-head" }, h("h2", {}, "Credit history")),
          h("div", { class: "card stack small" }, ...c.history.map(t => h("div", { class: "row" }, h("span", { class: "grow" }, t.reason), h("span", { class: "faint" }, fmtDate(t.created_at)), h("b", { style: { color: t.delta > 0 ? "var(--good)" : "var(--text)" } }, (t.delta > 0 ? "+" : "") + t.delta)))));
      }
      if (c.owner && c.site) {
        el.append(h("div", { class: "section-head" }, h("h2", {}, "Owner: business (last 30 days)")),
          h("div", { class: "card stack small" },
            h("div", { class: "row" }, h("span", { class: "grow" }, "Sales"), h("b", {}, c.site.sales30d.length ? c.site.sales30d.map(x => `${x.n} × ${x.provider} (${x.currency || "?"} ${x.currency === "NPR" ? (x.amount / 100).toFixed(0) : x.amount ? (x.amount / 100).toFixed(2) : "?"})`).join(" · ") : "none yet")),
            h("div", { class: "row" }, h("span", { class: "grow" }, "AI provider cost (paid from your Cloudflare credits)"), h("b", {}, "$" + c.site.providerCostUsd30d.toFixed(2))),
            h("div", { class: "faint" }, "Keep enough Cloudflare AI credits for Pro generations — customers' credit purchases cover them with your markup.")));
      }
    },

    render_appearance(el) {
      const sel = h("select", { class: "select", style: { maxWidth: "240px" }, onchange: () => SA.theme.set(sel.value) }, ...[["dark", "Dark"], ["light", "Light"], ["system", "Match system"]].map(([v, l]) => h("option", { value: v }, l)));
      sel.value = SA.theme.get();
      el.append(h("div", { class: "card stack", style: { maxWidth: "520px" } }, h("h2", {}, "Theme"), sel,
        h("h2", { style: { marginTop: "14px" } }, "Keyboard shortcuts"),
        ...[["Ctrl/⌘ + K", "Go to AI Chat"], ["Ctrl/⌘ + Shift + N", "New project"], ["Ctrl/⌘ + S", "Save current studio"], ["Ctrl/⌘ + Enter", "Send / generate"], ["?", "Show shortcuts"]].map(([k, d]) => h("div", { class: "row" }, h("span", { class: "kbd" }, k), h("span", { class: "muted" }, d)))
      ));
    },

    render_memory(el) {
      const list = h("div", { class: "stack" });
      const status = h("div", { class: "status-line" });
      const load = async () => {
        status.textContent = "Loading…";
        try {
          const { memories } = await SA.api("list_memories");
          status.textContent = memories.length + " saved " + (memories.length === 1 ? "memory" : "memories");
          list.replaceChildren(...memories.map(m => h("div", { class: "card row", style: { padding: "10px 12px" } },
            h("span", { class: "badge" }, m.category),
            h("div", { class: "grow" }, m.content),
            h("button", { class: "btn sm", onclick: async () => { const v = await SA.prompt("Edit memory", { value: m.content, multiline: true }); if (v === null || !v.trim()) return; await SA.api("update_memory", { id: m.id, content: v.trim(), category: m.category }); load(); } }, "Edit"),
            h("button", { class: "btn sm danger", onclick: async () => { if (!(await SA.confirm("Delete memory?", m.content, { danger: true, ok: "Delete" }))) return; await SA.api("delete_memory", { id: m.id }); load(); } }, "Delete")
          )));
        } catch (e) {
          status.className = "status-line bad";
          status.textContent = e.message;
        }
      };
      const add = h("input", { class: "input grow", placeholder: "Add something Success AI should remember (e.g. I write in British English)" });
      el.append(
        h("p", { class: "muted" }, "Success AI uses these memories in chat. It saves one only when you ask it to remember something. Never store passwords or sensitive details."),
        h("div", { class: "row", style: { marginBottom: "12px" } }, add, h("button", { class: "btn primary", onclick: async () => { if (!add.value.trim()) return; await SA.api("create_memory", { content: add.value.trim(), category: "preference" }); add.value = ""; load(); } }, "Add"),
          h("button", { class: "btn danger", onclick: async () => { if (!(await SA.confirm("Clear all memories?", "Success AI will forget everything it saved about you.", { danger: true, ok: "Clear all" }))) return; await SA.api("clear_memories"); load(); } }, "Clear all")),
        status, list
      );
      load();
    },

    render_data(el) {
      const s = SA.sync;
      el.append(
        h("div", { class: "grid g2" },
          h("div", { class: "card stack" }, h("h2", {}, "Sync"),
            h("div", {}, SA.state.user ? "Signed in — projects, conversations, characters and history sync automatically." : "Guest mode — everything is stored in this browser only."),
            h("div", { class: "small muted" }, "Status: " + s.state + (s.lastSync ? " · last synced " + fmtDate(s.lastSync.toISOString()) : "") + (s.detail ? " · " + s.detail : "")),
            h("button", { class: "btn", disabled: !SA.state.user, onclick: async () => { await s.run(); this.render(); } }, "Sync now")),
          h("div", { class: "card stack" }, h("h2", {}, "Export your data"),
            h("p", { class: "small muted" }, "Download every project, conversation, character and history entry as one JSON backup."),
            h("button", { class: "btn", onclick: async () => {
              const dump = {};
              for (const c of ["projects", "conversations", "characters", "history"]) dump[c] = (await store.list(c)).map(({ owner, dirty, ...x }) => x);
              SA.download(JSON.stringify({ format: "success-ai-backup", exportedAt: new Date().toISOString(), ...dump }, null, 2), "success-ai-backup.json", "application/json");
            } }, "Download backup")),
          h("div", { class: "card stack" }, h("h2", {}, "Data from the previous version"),
            h("p", { class: "small muted" }, "Projects and chats saved in this browser by the previous version are kept. Re-import them if something is missing."),
            h("button", { class: "btn", onclick: async () => { localStorage.removeItem("sa_legacy_migrated"); await SA.migrateLegacy(); } }, "Re-import earlier data")),
          h("div", { class: "card stack" }, h("h2", {}, "This device"),
            h("p", { class: "small muted" }, "Remove cached copies from this browser. Synced data stays in your account; unsynced guest data would be lost."),
            h("button", { class: "btn danger", onclick: async () => {
              if (!(await SA.confirm("Clear this device?", SA.state.user ? "Cached copies of your synced data will be removed from this browser. Unsynced changes will be lost." : "You're a guest: ALL your projects in this browser will be permanently deleted.", { danger: true, ok: "Clear" }))) return;
              if (SA.state.user) await SA.sync.run();
              indexedDB.deleteDatabase("success-ai");
              localStorage.removeItem("sa_active_project");
              location.reload();
            } }, "Clear local data"))
        )
      );
    },

    render_system(el) {
      const api = h("input", { class: "input", value: SA.config.API });
      const box = h("div", { class: "stack" });
      el.append(
        h("div", { class: "card stack", style: { maxWidth: "640px" } },
          h("h2", {}, "Server endpoint"),
          h("p", { class: "small muted" }, "The Cloudflare Worker that powers Success AI. Change only for development."),
          api,
          h("div", { class: "row" },
            h("button", { class: "btn", onclick: () => { localStorage.setItem("sa_api_url", api.value.trim()); location.reload(); } }, "Save & reload"),
            h("button", { class: "btn ghost", onclick: () => { localStorage.removeItem("sa_api_url"); location.reload(); } }, "Reset to default")
          ),
          h("h2", { style: { marginTop: "12px" } }, "Live status"), box,
          h("button", { class: "btn", onclick: async () => { await SA.serverStatus(); this.render(); } }, "Re-check")
        )
      );
      const s = SA.state.serverStatus || {};
      box.append(...Object.entries(s).filter(([, v]) => typeof v === "string").map(([k, v]) => h("div", { class: "row small" }, h("span", { class: "grow" }, k), statusBadge(v))));
      if (s.engines) {
        for (const [kind, list] of Object.entries(s.engines)) {
          box.append(h("h3", { style: { margin: "12px 0 4px", textTransform: "capitalize" } }, kind + " engines"));
          list.forEach(e => box.append(h("div", { class: "row small" }, h("span", { class: "grow" }, e.label), h("span", { class: "badge" }, e.tier), statusBadge(e.status))));
        }
        box.append(h("p", { class: "small faint" }, "Owner settings (Cloudflare → Worker → Settings → Variables): OWNER_EMAILS, CREDIT_MARKUP (default 2), DODO_API_KEY, DODO_WEBHOOK_SECRET, DODO_ENV, DODO_PACKS, KHALTI_SECRET_KEY, KHALTI_ENV, KHALTI_PACKS, APP_URL, PREMIUM_AI=off to hide Pro engines."));
      }
    },

    render_about(el) {
      el.append(h("div", { class: "card stack", style: { maxWidth: "720px" } },
        h("h2", {}, "Success AI " + SA.version),
        h("p", { class: "muted" }, "Your all-in-one AI studio for chat, images, video, music, documents, websites and apps — free to use."),
        h("h3", {}, "AI engines"),
        h("ul", { class: "muted small" },
          h("li", {}, "Video: Agnes Video 2.5 Flash (free trial), Google Veo 3.1 Fast, ByteDance Seedance 2.0 Fast, Kling 4.0 Flash. Films are edited and rendered in your browser."),
          h("li", {}, "Images: FLUX.2 Klein, Agnes Image 2.1 Flash (up to 4K), Google Nano Banana 2.1."),
          h("li", {}, "Music: MiniMax Music 2.6 (songs with vocals), Google Lyria 3.5 and Lyria 3."),
          h("li", {}, "Free for everyone. Free accounts also get a daily allowance on the HD engines.")
        ),
        h("h3", {}, "Not available yet"),
        h("ul", { class: "muted small" },
          h("li", {}, "Email verification and password reset (needs an email provider)."),
          h("li", {}, "One-click website deployment (download and publish to GitHub Pages / Cloudflare Pages)."),
          h("li", {}, "App-store apps — Success AI installs as an app (PWA) on phones and computers today.")
        )
      ));
    }
  });
})();
