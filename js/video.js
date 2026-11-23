/* Success AI — Video Studio
 * 1. Create   — prompt or whole story → AI plans shots → consistent characters → clips → narration + music → one MP4
 * 2. Scenes   — edit every shot (text / image-to-video / character reference), regenerate, render again
 * 3. Clips    — single clips with any engine, image-to-video, clip history
 */
(() => {
  "use strict";
  const { h, studio, store, projects, toast, assets, uid } = SA;

  const STYLES = ["Cinematic, realistic, natural color grading", "Documentary, natural light, handheld", "Anime animation", "3D animated feature film", "Vintage 16mm film", "Music video, bold neon colors", "Commercial advertisement, crisp and bright", "Watercolor storybook animation", "Dark fantasy, moody lighting"];
  const LENGTHS = [["shot", "One shot (5–12 s)", 1], ["s30", "About 30 seconds", 4], ["m1", "About 1 minute", 8], ["m2", "About 2 minutes", 14], ["m3", "About 3 minutes", 20]];
  const RATIOS = [["16:9", "Landscape 16:9 (YouTube)"], ["9:16", "Vertical 9:16 (Reels, TikTok, Shorts)"], ["1:1", "Square 1:1"], ["4:3", "Classic 4:3"], ["3:4", "Portrait 3:4"], ["21:9", "Cinemascope 21:9"]];
  const TTS_LANGS = [["", "No narration"], ["en", "English voice"], ["es", "Spanish voice"], ["fr", "French voice"], ["zh", "Chinese voice"], ["ja", "Japanese voice"], ["ko", "Korean voice"]];
  const STEP_ICON = { wait: "○", run: "◔", done: "●", skip: "–", fail: "✕" };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const opt = (v, l) => h("option", { value: v }, l);

  studio({
    id: "video",
    title: "Video Studio",
    kicker: "PROMPT OR STORY → FINISHED VIDEO",
    projectType: "video",
    project: null,
    narrationCache: new Map(),

    mount(el) {
      this.tabs = h("div", { class: "tabs" });
      this.panels = { create: h("div"), scenes: h("div"), clips: h("div") };
      const sel = name => {
        this.tab = name;
        this.tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        Object.entries(this.panels).forEach(([k, p]) => (p.hidden = k !== name));
        if (name === "scenes") this.renderScenes();
        if (name === "clips") this.renderClips();
      };
      [["create", "🎬 Create video"], ["scenes", "Scenes & edit"], ["clips", "Single clips"]].forEach(([k, l]) => this.tabs.append(h("button", { class: "tab", "data-tab": k, onclick: () => sel(k) }, l)));
      this.selectTab = sel;
      el.append(this.tabs, ...Object.values(this.panels));
      this.buildCreate();
      this.buildScenes();
      this.buildClips();
      sel("create");
    },

    /* ================================================================== */
    /* Data                                                                */
    /* ================================================================== */
    film() {
      return this.project?.data?.film || { scenes: [], characters: [], options: {} };
    },
    async ensureProject(title) {
      if (!this.project || this.project.kind !== "video") this.project = await projects.ensure("video", title || "Untitled video");
      return this.project;
    },
    /** patch: object, or function(currentFilm) → object. Applied atomically on the latest saved film. */
    async saveFilm(patch) {
      await this.ensureProject((typeof patch === "object" && patch?.title) || this.story?.value);
      let film;
      this.project = await projects.patch(this.project.id, data => {
        const cur = data.film || {};
        film = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
        return { film };
      });
      return film;
    },
    patchScene(id, patch) {
      return this.saveFilm(cur => ({ scenes: (cur.scenes || []).map(s => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    optionsFromUI() {
      return {
        length: this.length.value,
        ratio: this.ratio.value,
        style: this.style.value,
        engine: this.engineSel.value,
        consistent: this.consistent.checked,
        narration: this.narration.value,
        music: this.music.value,
        musicAssetId: this.musicAssetId || null,
        subtitles: this.subs.checked,
        keepSound: this.keepSound.checked
      };
    },

    /* ================================================================== */
    /* Create (autopilot)                                                  */
    /* ================================================================== */
    buildCreate() {
      this.story = h("textarea", { class: "textarea", style: { minHeight: "170px", fontSize: "15px" }, maxlength: 12000, placeholder: "Describe any video — or paste a whole story.\n\nExamples:\n• A 30-second ad for a Himalayan coffee brand, sunrise over the mountains\n• A porter in the Himalayas finds an old camera that shows the future…\n• A cute cartoon dumpling who wants to fly" });
      this.length = h("select", { class: "select" }, ...LENGTHS.map(([v, l]) => opt(v, l)));
      this.length.value = "s30";
      this.ratio = h("select", { class: "select" }, ...RATIOS.map(([v, l]) => opt(v, l)));
      this.style = h("select", { class: "select" }, ...STYLES.map(s => opt(s, s.split(",")[0])));
      this.engineSel = SA.engineSelect("video", { onChange: e => this.onEngine(e) });
      this.consistent = h("input", { type: "checkbox", checked: true });
      this.narration = h("select", { class: "select" }, ...TTS_LANGS.map(([v, l]) => opt(v, l)));
      this.music = h("select", { class: "select", onchange: () => this.onMusicChoice() }, opt("ai", "AI-composed soundtrack"), opt("library", "Choose from my library…"), opt("none", "No music"));
      this.musicLabel = h("div", { class: "small faint" });
      this.subs = h("input", { type: "checkbox", checked: true });
      this.keepSound = h("input", { type: "checkbox", checked: true });
      this.engineNote = h("div", { class: "small faint" });
      this.goBtn = h("button", { class: "btn primary", style: { fontSize: "15px", padding: "11px 18px" }, onclick: () => this.autopilot() }, "🎬 Create my video");
      this.cancelBtn = h("button", { class: "btn", hidden: true, onclick: () => this.cancel() }, "Stop");
      this.stepsEl = h("div", { class: "stack small" });
      this.bar = h("div", { class: "progress" }, h("i"));
      this.statusEl = h("div", { class: "status-line" });
      this.resultEl = h("div", { class: "stack" });

      const field = (label, el) => h("div", {}, h("label", { class: "lbl" }, label), el);
      this.panels.create.append(
        h("div", { class: "split wide-left" },
          h("div", { class: "stack" },
            h("div", { class: "card stack" },
              h("h2", {}, "What should the video be?"),
              this.story,
              h("div", { class: "grid g3" }, field("Length", this.length), field("Format", this.ratio), field("Visual style", this.style)),
              h("div", { class: "grid g2" }, field("Video engine", this.engineSel), field("Narration", this.narration)),
              this.engineNote,
              h("div", { class: "grid g2" }, field("Soundtrack", this.music), h("div", {}, h("label", { class: "lbl" }, " "), this.musicLabel)),
              h("div", { class: "row" },
                h("label", { class: "row small muted" }, this.consistent, "Consistent characters (reference images)"),
                h("label", { class: "row small muted" }, this.subs, "Subtitles"),
                h("label", { class: "row small muted" }, this.keepSound, "Keep AI-generated sound")),
              h("div", { class: "row" }, this.goBtn, this.cancelBtn, h("span", { class: "small faint" }, "Runs in the background — you can switch studios while it works."))
            ),
            h("div", { class: "card stack" }, h("h2", {}, "Your video"), this.resultEl)
          ),
          h("div", { class: "card stack", style: { position: "sticky", top: "76px" } },
            h("h2", {}, "Production"),
            this.bar, this.statusEl, this.stepsEl,
            h("div", { class: "small faint" }, SA.engineHelp())
          )
        )
      );
      this.renderSteps();
      this.renderResult();
      const save = SA.debounce(() => this.project && this.saveFilm({ story: this.story.value, options: this.optionsFromUI() }), 800);
      this.story.addEventListener("input", save);
      [this.length, this.ratio, this.style, this.engineSel, this.narration, this.music, this.consistent, this.subs, this.keepSound].forEach(i => i.addEventListener("change", save));
    },

    onEngine(e) {
      if (!e || !this.engineNote) return;
      const secs = e.allowed ? e.allowed.join(" / ") + " s" : `${e.min}–${e.max} s`;
      this.engineNote.textContent = `${e.label}: clips of ${secs}, ${e.audio ? "with generated sound" : "silent (narration & music are added)"}, ${e.maxRefs ? "character references supported" : "text and image prompts"}.`;
      if (this.ratio && e.ratios && !e.ratios.includes(this.ratio.value)) this.ratio.value = e.ratios[0];
    },

    async onMusicChoice() {
      if (this.music.value === "library") {
        const [pick] = await SA.library.pickAssets({ kind: "audio", multiple: false });
        if (pick) {
          this.musicAssetId = pick.id;
          this.musicLabel.textContent = "♫ " + pick.name;
        } else {
          this.music.value = "ai";
        }
      }
      if (this.music.value === "ai") {
        const ready = SA.readyEngines("music");
        this.musicLabel.textContent = ready.length ? "Composed by " + ready[0].label.split(" —")[0] : "AI music needs a premium engine — the film will be rendered without music.";
      }
      if (this.music.value === "none") this.musicLabel.textContent = "";
    },

    steps: [
      ["plan", "Write the script & shot list"],
      ["cast", "Design consistent characters"],
      ["clips", "Generate video clips"],
      ["audio", "Narration & soundtrack"],
      ["render", "Edit & render final MP4"]
    ],
    stepState: {},
    renderSteps() {
      this.stepsEl.replaceChildren(...this.steps.map(([k, label]) => {
        const st = this.stepState[k] || { s: "wait" };
        return h("div", { class: "row nowrap" }, h("span", { style: { width: "16px", color: st.s === "done" ? "var(--good)" : st.s === "fail" ? "var(--bad)" : st.s === "run" ? "var(--accent)" : "var(--faint)" } }, STEP_ICON[st.s]), h("div", { class: "grow" }, h("div", {}, label), st.d ? h("div", { class: "faint" }, st.d) : ""));
      }));
    },
    step(k, s, d = "") {
      this.stepState[k] = { s, d };
      this.renderSteps();
    },
    progress(p, text) {
      if (typeof p === "number" && !isNaN(p)) this.bar.firstChild.style.width = Math.round(p * 100) + "%";
      if (text !== undefined) {
        this.statusEl.className = "status-line";
        this.statusEl.textContent = text;
      }
    },
    cancel() {
      if (this.run) this.run.cancelled = true;
      this.statusEl.textContent = "Stopping after the current step… (clips already requested keep generating)";
    },
    checkCancel() {
      if (this.run?.cancelled) throw new Error("Stopped.");
    },

    async autopilot() {
      const story = this.story.value.trim();
      if (!story) return this.story.focus();
      if (this.run && !this.run.done) return toast("A video is already being made.");
      const o = this.optionsFromUI();
      const eng = SA.engine("video", o.engine);
      if (!eng || eng.status !== "ready") return toast("Choose an available video engine.", "bad");
      if (this.film().scenes?.length && this.film().story === story) {
        const choice = await SA.modal({ title: "Continue or start over?", body: "This project already has a shot list for this story. Continue (keeps finished clips) or plan it again from scratch?", actions: [{ label: "Cancel", value: null }, { label: "Start over", value: "new" }, { label: "Continue", kind: "primary", value: "continue" }] });
        if (!choice) return;
        if (choice === "new") await this.saveFilm({ scenes: [], characters: [] });
      } else if (this.film().scenes?.length) {
        await projects.create("video", story.slice(0, 50), {}, { open: false }).then(p => projects.setActive(p));
        this.project = projects.active;
      }
      this.run = { cancelled: false, done: false };
      this.stepState = {};
      this.renderSteps();
      this.goBtn.disabled = true;
      this.cancelBtn.hidden = false;
      try {
        await this.saveFilm({ story, options: o });
        if (!this.film().scenes?.length) await this.planFilm(story, o, eng);
        else this.step("plan", "done", this.film().scenes.length + " scenes (kept)");
        this.checkCancel();
        await this.castCharacters(o, eng);
        this.checkCancel();
        await this.generateClips(o, eng);
        this.checkCancel();
        await this.renderFilm({ fromAutopilot: true });
        this.progress(1, "Your video is ready! 🎉");
        SA.history.add({ kind: "video", title: "Created video: " + (this.film().title || story.slice(0, 60)), projectId: this.project.id });
        if (document.visibilityState !== "visible") toast("Your video is ready!", "good");
      } catch (e) {
        this.statusEl.className = "status-line bad";
        this.statusEl.textContent = e.message;
        for (const [k] of this.steps) if (this.stepState[k]?.s === "run") this.step(k, "fail", e.message.slice(0, 120));
      } finally {
        this.run.done = true;
        this.goBtn.disabled = false;
        this.cancelBtn.hidden = true;
        this.renderScenes();
      }
    },

    /* ---------- 1. plan ---------- */
    async planFilm(story, o, eng) {
      this.step("plan", "run");
      this.progress(0.03, "Writing the script and shot list…");
      const target = LENGTHS.find(l => l[0] === o.length)?.[2] || 4;
      const maxS = eng.allowed ? Math.max(...eng.allowed) : eng.max;
      const minS = eng.allowed ? Math.min(...eng.allowed) : eng.min;
      const reply = await SA.ai("json", `You are a film director planning an AI-generated video.
Request / story:
"""${story.slice(0, 9000)}"""

Plan ${target === 1 ? "exactly 1 shot" : `${target} shots (you may use ${Math.max(1, target - 2)}–${target + 2} if the story needs it)`}. Visual style: ${o.style}. Format: ${o.ratio}.
Rules:
- Each shot is ${minS}–${maxS} seconds and shows ONE continuous action that an AI video model can render.
- "prompt": a vivid visual description: subject, action, setting, camera movement, lighting. No dialogue, no text on screen, no character names without their look.
- "narration": one short spoken line for a voice-over (or "" if none). Keep the total narration natural for the shot length (about 2.5 words per second).
- "subtitle": on-screen subtitle text (usually same as narration, may be "").
- "characters": names of recurring characters appearing in the shot.
- List recurring characters with a precise visual "look" (age, face, hair, clothing, colors) so they stay consistent.
Return JSON: {"title":"","logline":"","mood":"","characters":[{"name":"","look":""}],"scenes":[{"title":"","prompt":"","seconds":${Math.min(maxS, 8)},"narration":"","subtitle":"","characters":[]}]}`, { maxTokens: 6000 });
      const plan = SA.extractJSON(reply);
      const scenes = (plan.scenes || []).slice(0, 30).map((s, i) => ({
        id: uid("scn"),
        title: String(s.title || "Shot " + (i + 1)),
        prompt: String(s.prompt || "").slice(0, 2000),
        seconds: Math.max(minS, Math.min(maxS, Math.round(Number(s.seconds) || 6))),
        narration: o.narration ? String(s.narration || "") : "",
        subtitle: String(s.subtitle || s.narration || ""),
        characters: Array.isArray(s.characters) ? s.characters.map(String) : [],
        mode: "text"
      })).filter(s => s.prompt);
      if (!scenes.length) throw new Error("The AI couldn't plan this video. Try describing it differently.");
      const characters = (plan.characters || []).slice(0, 5).map(c => ({ name: String(c.name || "").trim(), look: String(c.look || "").trim() })).filter(c => c.name);
      await this.saveFilm({ title: plan.title || "", logline: plan.logline || "", mood: plan.mood || "", scenes, characters });
      if (plan.title && /^(Untitled|Create|A |An )/.test(this.project.title)) {
        await store.save("projects", { id: this.project.id, title: plan.title });
        this.project = await store.get("projects", this.project.id);
        projects.setActive(this.project);
      }
      const total = scenes.reduce((n, s) => n + s.seconds, 0);
      this.step("plan", "done", `“${plan.title || "Untitled"}” — ${scenes.length} shots, ~${total}s`);
      this.progress(0.1);
    },

    /* ---------- 2. characters ---------- */
    async castCharacters(o, eng) {
      const film = this.film();
      if (!o.consistent || !eng.maxRefs || !film.characters?.length) {
        this.step("cast", "skip", !film.characters?.length ? "No recurring characters" : !eng.maxRefs ? "This engine uses text descriptions for consistency" : "Off");
        return;
      }
      this.step("cast", "run");
      const imgEngine = SA.readyEngines("image").find(e => e.id === "agnes-image") || SA.readyEngines("image")[0];
      const library = await store.list("characters");
      const characters = [...film.characters];
      for (let i = 0; i < characters.length && i < 5; i++) {
        this.checkCancel();
        const c = characters[i];
        if (c.refAssetId) continue;
        const existing = library.find(x => x.title.toLowerCase() === c.name.toLowerCase() && x.data?.referenceAssetIds?.length);
        if (existing) {
          c.refAssetId = existing.data.referenceAssetIds[0];
          continue;
        }
        this.progress(0.1 + (0.08 * i) / characters.length, `Designing ${c.name}…`);
        try {
          const res = await SA.api("image_generate", { engine: imgEngine?.id, prompt: `Character reference sheet, full body, front view, plain light background, ${o.style}. ${c.name}: ${c.look}`, aspectRatio: "3:4", resolution: "1K" }, { timeout: 200000 });
          const compact = await SA.encodeImage(res.imageData, { maxSide: 1024, type: "image/jpeg", quality: 0.9 });
          const asset = await assets.save({ kind: "image", name: c.name + " — character reference", dataUrl: compact, projectId: this.project.id, tags: ["character", "video"] });
          c.refAssetId = asset.id;
          await store.save("characters", { id: uid("char"), kind: "character", title: c.name, data: { description: c.look, appearance: c.look, referenceAssetIds: [asset.id], projectIds: [this.project.id], tags: ["film"] } });
        } catch (e) {
          toast(`Couldn't design ${c.name}: ${e.message}`, "bad");
        }
      }
      const withRefs = new Map(characters.filter(c => c.refAssetId).map(c => [c.name.toLowerCase(), c]));
      const scenes = film.scenes.map(s => {
        if (s.mode === "image") return s;
        const refs = (s.characters || []).map(n => withRefs.get(String(n).toLowerCase())).filter(Boolean).slice(0, eng.maxRefs);
        return { ...s, mode: refs.length ? "reference" : "text", refNames: refs.map(r => r.name) };
      });
      await this.saveFilm({ characters, scenes });
      this.step("cast", "done", `${withRefs.size} character${withRefs.size === 1 ? "" : "s"} ready`);
    },

    /* ---------- 3. clips ---------- */
    async imageData(assetId) {
      const { dataUrl } = await assets.get(assetId);
      return SA.encodeImage(dataUrl, { maxSide: 1024, type: "image/jpeg", quality: 0.88 });
    },

    async scenePayload(s, o, eng) {
      const film = this.film();
      const chars = film.characters || [];
      const style = o.style ? ` Style: ${o.style}.` : "";
      const looks = (s.characters || []).map(n => chars.find(c => c.name.toLowerCase() === String(n).toLowerCase())).filter(Boolean);
      let prompt = s.prompt;
      let mode = "text";
      let images = [];
      if (s.mode === "image" && s.frameAssetId && eng.modes.includes("image")) {
        mode = "image";
        images = [await this.imageData(s.frameAssetId)];
      } else if (s.mode === "reference" && eng.modes.includes("reference") && eng.maxRefs) {
        const refs = looks.filter(c => c.refAssetId).slice(0, eng.maxRefs);
        if (refs.length) {
          mode = "reference";
          images = await Promise.all(refs.map(c => this.imageData(c.refAssetId)));
          const intro = eng.id === "agnes-flash" ? refs.map((c, i) => `<Picture ${i + 1}> is ${c.name}`).join(", ") + ". " : refs.map(c => `${c.name} looks exactly like the reference image`).join("; ") + ". ";
          prompt = intro + prompt;
        }
      }
      if (mode === "text" && looks.length) prompt += " " + looks.map(c => `${c.name}: ${c.look}`).join(". ") + ".";
      return { engine: eng.id, prompt: (prompt + style).slice(0, 2400), seconds: s.seconds, aspectRatio: o.ratio, mode, images, generateAudio: o.keepSound, projectId: this.project.id };
    },

    /** Generate (or resume) one scene's clip. Resolves when the clip is ready. */
    async makeClip(s, o, eng, onNote) {
      let attempt = 0;
      for (;;) {
        this.checkCancel();
        try {
          let st;
          if (s.jobId && !["failed"].includes(s.clipStatus) && !s.clipUrl) {
            st = { jobId: s.jobId, status: s.clipStatus };
          } else {
            const payload = await this.scenePayload(s, o, eng);
            onNote?.("requesting");
            st = await SA.api("video_generate", payload, { timeout: 15 * 60000 });
            await this.patchScene(s.id, { jobId: st.jobId, clipStatus: st.status, clipUrl: st.url || null, engine: eng.id, error: null });
            s = { ...s, jobId: st.jobId };
          }
          if (st.status !== "completed") {
            st = await SA.waitForVideo(st.jobId, { isCancelled: () => this.run?.cancelled, onUpdate: u => { onNote?.(u.status + (u.progress ? " " + u.progress + "%" : "")); } });
          }
          await this.patchScene(s.id, { clipStatus: "completed", clipUrl: st.url, error: null });
          return st.url;
        } catch (e) {
          if (/Stopped|Cancelled/.test(e.message)) throw e;
          if (e.code === "ENGINE_UNAVAILABLE") throw e;
          if (e.status === 429) {
            onNote?.("waiting for the provider…");
            await sleep(20000);
            continue;
          }
          attempt++;
          await this.patchScene(s.id, { clipStatus: "failed", error: e.message, jobId: null });
          s = { ...s, jobId: null, clipStatus: "failed" };
          if (attempt >= 2) throw new Error(`Shot "${s.title}" failed twice: ${e.message}`);
          onNote?.("retrying");
          await sleep(3000);
        }
      }
    },

    async generateClips(o, eng) {
      this.step("clips", "run");
      const all = this.film().scenes;
      const todo = all.filter(s => !(s.clipStatus === "completed" && s.clipUrl));
      let done = all.length - todo.length;
      const notes = new Map();
      const show = () => {
        this.step("clips", "run", `${done}/${all.length} ready · ` + [...notes.values()].slice(0, 3).join(" · "));
        this.progress(0.18 + 0.6 * (done / all.length), `Generating clips: ${done} of ${all.length} ready`);
      };
      show();
      const concurrency = eng.tier === "free" ? 3 : 2;
      const queue = [...todo];
      const errors = [];
      const worker = async () => {
        while (queue.length) {
          const s = queue.shift();
          try {
            await this.makeClip(s, o, eng, n => {
              notes.set(s.id, `${s.title}: ${n}`);
              show();
            });
            done++;
          } catch (e) {
            errors.push(e);
            if (e.code === "ENGINE_UNAVAILABLE" || /Stopped/.test(e.message)) queue.length = 0;
          }
          notes.delete(s.id);
          show();
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, todo.length || 1) }, worker));
      this.renderScenes();
      if (errors.length) {
        const fatal = errors.find(e => e.code === "ENGINE_UNAVAILABLE" || /Stopped/.test(e.message)) || errors[0];
        if (done === 0 || fatal.code === "ENGINE_UNAVAILABLE" || /Stopped/.test(fatal.message)) throw fatal;
        this.step("clips", "done", `${done}/${all.length} ready — ${errors.length} shot(s) failed and will be left out (retry them in Scenes)`);
      } else this.step("clips", "done", `${all.length} clips ready`);
    },

    /* ---------- 4+5. audio & render ---------- */
    async narrationFor(s, lang) {
      const key = lang + "|" + s.narration;
      if (this.narrationCache.has(key)) return this.narrationCache.get(key);
      const { audioData } = await SA.api("tts", { text: s.narration.slice(0, 1400), lang });
      const blob = SA.dataUrlToBlob(audioData);
      this.narrationCache.set(key, blob);
      return blob;
    },

    async soundtrack(o) {
      const film = this.film();
      if (o.music === "none") return null;
      if (o.music === "library" && o.musicAssetId) {
        const { dataUrl } = await assets.get(o.musicAssetId);
        return SA.fetchResult(dataUrl);
      }
      if (film.musicUrl) {
        try {
          return await SA.fetchResult(film.musicUrl);
        } catch {
          /* expired — compose again */
        }
      }
      const eng = SA.readyEngines("music")[0];
      if (!eng) return null;
      const total = film.scenes.reduce((n, s) => n + (s.seconds || 6), 0);
      const res = await SA.api("music_generate", { engine: eng.id, instrumental: true, prompt: `Instrumental film score, ${film.mood || "cinematic"} mood, about ${total} seconds, for a video titled "${film.title || ""}": ${film.logline || this.story.value.slice(0, 300)}. Style: ${o.style}.`, projectId: this.project.id }, { timeout: 10 * 60000 });
      const url = res.url || res.audioData;
      await this.saveFilm({ musicUrl: url });
      if (res.url) assets.save({ kind: "audio", name: (film.title || "Film") + " — soundtrack", url: res.url, projectId: this.project.id, tags: ["soundtrack"] }).catch(() => {});
      return SA.fetchResult(url);
    },

    async renderFilm({ fromAutopilot = false } = {}) {
      const o = this.film().options || this.optionsFromUI();
      const scenes = (this.film().scenes || []).filter(s => s.clipStatus === "completed" && s.clipUrl);
      if (!scenes.length) throw new Error("No finished clips to render yet.");
      const setP = (p, t) => (fromAutopilot ? this.progress(p === undefined ? undefined : 0.78 + 0.22 * p, t) : this.renderProgress(p, t));

      // Audio
      if (fromAutopilot) this.step("audio", "run");
      const narr = new Map();
      if (o.narration) {
        for (let i = 0; i < scenes.length; i++) {
          if (!scenes[i].narration?.trim()) continue;
          setP(0.02 + (0.1 * i) / scenes.length, `Recording narration ${i + 1}/${scenes.length}…`);
          try {
            narr.set(scenes[i].id, await this.narrationFor(scenes[i], o.narration));
          } catch (e) {
            toast("Narration skipped for one shot: " + e.message, "bad");
          }
        }
      }
      let music = null;
      let musicNote = "no music";
      try {
        setP(0.14, "Preparing the soundtrack…");
        music = await this.soundtrack(o);
        musicNote = music ? "soundtrack added" : o.music === "ai" ? "no AI music engine available — rendered without music" : "no music";
      } catch (e) {
        musicNote = "music failed: " + e.message;
        toast("Soundtrack skipped: " + e.message, "bad");
      }
      if (fromAutopilot) this.step("audio", "done", `${narr.size ? narr.size + " narration lines, " : ""}${musicNote}`);

      // Download clips
      if (fromAutopilot) this.step("render", "run");
      const clips = [];
      for (let i = 0; i < scenes.length; i++) {
        setP(0.2 + (0.25 * i) / scenes.length, `Downloading clip ${i + 1}/${scenes.length}…`);
        try {
          clips.push({ blob: await SA.fetchResult(scenes[i].clipUrl), narration: narr.get(scenes[i].id) || null, subtitle: o.subtitles ? scenes[i].subtitle : "", inPoint: scenes[i].inPoint, outPoint: scenes[i].outPoint });
        } catch (e) {
          await this.patchScene(scenes[i].id, { clipStatus: "expired", error: e.message });
          toast(`Clip "${scenes[i].title}" couldn't be downloaded (${e.message}). Regenerate it in Scenes.`, "bad");
        }
      }
      if (!clips.length) throw new Error("None of the clips could be downloaded. Provider links may have expired — regenerate them in Scenes.");

      const out = await SA.render.film({ clips, music: music ? { blob: music } : null, keepClipAudio: o.keepSound !== false, onStatus: t => setP(undefined, t), onProgress: p => setP(0.45 + 0.55 * p) });
      this.lastRender = out;
      await this.storeRender(out);
      if (fromAutopilot) this.step("render", "done", `${Math.round(out.duration)}s MP4 · ${SA.fmtBytes(out.blob.size)}`);
      this.renderResult();
      return out;
    },

    async storeRender(out) {
      try {
        const asset = await assets.save({ kind: "video", name: (this.film().title || this.project.title) + " — final", dataUrl: await SA.blobToDataUrl(out.blob), projectId: this.project.id, tags: ["film", "final"] });
        await this.saveFilm({ lastRender: { assetId: asset.id, duration: out.duration, at: Date.now(), srt: out.srt } });
      } catch (e) {
        toast("Rendered, but couldn't save to your library: " + e.message + " — download it now.", "bad");
      }
    },

    renderResult() {
      const el = this.resultEl;
      if (!el) return;
      el.replaceChildren();
      const film = this.film();
      const show = (src, out) => {
        el.append(
          h("video", { src, controls: true, playsinline: true, style: { width: "100%", borderRadius: "12px", background: "#000", maxHeight: "62vh" } }),
          h("div", { class: "row" },
            h("b", { class: "grow" }, film.title || this.project?.title || "Your video"),
            h("button", { class: "btn primary", onclick: async () => SA.download(out?.blob || (await SA.fetchResult(src)), (film.title || "success-ai-video").replace(/[^\w-]+/g, "-") + ".mp4") }, "⇩ Download MP4"),
            film.lastRender?.srt || out?.srt ? h("button", { class: "btn", onclick: () => SA.download(out?.srt || film.lastRender.srt, "subtitles.srt", "text/plain") }, "Subtitles (.srt)") : "",
            h("button", { class: "btn", onclick: () => this.selectTab("scenes") }, "Edit scenes")
          ),
          film.logline ? h("div", { class: "small muted" }, film.logline) : ""
        );
      };
      if (this.lastRender && this.lastRender.projectId !== undefined && this.lastRender.projectId !== this.project?.id) this.lastRender = null;
      if (this.lastRender) {
        this.lastRender.projectId = this.project?.id;
        show(URL.createObjectURL(this.lastRender.blob), this.lastRender);
      } else if (film.lastRender?.assetId) {
        el.append(h("div", { class: "muted small" }, "Loading your last render…"));
        assets.get(film.lastRender.assetId).then(({ dataUrl }) => { el.replaceChildren(); show(dataUrl); }).catch(() => el.replaceChildren(h("div", { class: "empty" }, "Your last render isn't available on this device. Re-render it from the Scenes tab.")));
      } else {
        el.append(h("div", { class: "empty" }, "Your finished video appears here. ", h("br"), h("small", {}, "Success AI writes the script, generates every shot, adds narration, music and subtitles, then edits it into one MP4.")));
      }
    },

    /* ================================================================== */
    /* Scenes & edit                                                        */
    /* ================================================================== */
    buildScenes() {
      this.scenesEl = h("div", { class: "stack" });
      this.renderStatus = h("div", { class: "status-line" });
      this.renderBar = h("div", { class: "progress", hidden: true }, h("i"));
      this.player = h("div", { class: "player" }, h("div", { class: "placeholder" }, "Preview your shots in order here."));
      this.panels.scenes.append(
        h("div", { class: "split wide-left" },
          h("div", { class: "card stack" },
            h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Shots"), h("button", { class: "btn sm", onclick: () => this.addScene() }, "＋ Shot"), h("button", { class: "btn sm primary", onclick: () => this.generateMissing() }, "Generate missing clips")),
            this.scenesEl
          ),
          h("div", { class: "stack", style: { position: "sticky", top: "76px" } },
            h("div", { class: "card stack" },
              h("h2", {}, "Preview"),
              this.player,
              h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.playSequence() }, "▶ Play shots"), h("button", { class: "btn", onclick: () => this.stopSequence() }, "■ Stop"))
            ),
            h("div", { class: "card stack" },
              h("h2", {}, "Final video"),
              h("p", { class: "small muted" }, "Uses the narration, soundtrack and subtitle settings from the Create tab."),
              h("button", { class: "btn primary", onclick: () => this.rerender() }, "🎞 Render final MP4"),
              this.renderBar, this.renderStatus,
              h("div", { class: "row" },
                h("button", { class: "btn sm", onclick: () => this.exportPlan() }, "Script (.md)"),
                h("button", { class: "btn sm", onclick: () => this.planToDocument() }, "→ Document Studio"))
            )
          )
        )
      );
    },

    renderProgress(p, t) {
      this.renderBar.hidden = false;
      if (p !== undefined) this.renderBar.firstChild.style.width = Math.round(p * 100) + "%";
      if (t) this.renderStatus.textContent = t;
    },

    async rerender() {
      if (!this.project) return toast("Create a video first.");
      try {
        this.renderStatus.className = "status-line";
        await this.saveFilm({ options: { ...this.optionsFromUI() } });
        const out = await this.renderFilm();
        this.renderStatus.textContent = `Rendered ${Math.round(out.duration)}s — see the Create tab or download below.`;
        this.renderStatus.append(" ", h("button", { class: "btn sm primary", onclick: () => SA.download(out.blob, (this.film().title || "video").replace(/[^\w-]+/g, "-") + ".mp4") }, "⇩ Download"));
      } catch (e) {
        this.renderStatus.className = "status-line bad";
        this.renderStatus.textContent = e.message;
      }
    },

    async addScene() {
      await this.ensureProject("Untitled video");
      await this.saveFilm({ scenes: [...(this.film().scenes || []), { id: uid("scn"), title: "New shot", prompt: "", seconds: 6, narration: "", subtitle: "", mode: "text", characters: [] }] });
      this.renderScenes();
    },

    async moveScene(i, d) {
      const scenes = [...this.film().scenes];
      [scenes[i], scenes[i + d]] = [scenes[i + d], scenes[i]];
      await this.saveFilm({ scenes });
      this.renderScenes();
    },

    async regenerateScene(id) {
      const o = { ...this.optionsFromUI(), ...(this.film().options || {}), engine: this.engineSel.value };
      const eng = SA.engine("video", o.engine);
      if (!eng || eng.status !== "ready") return toast("Choose an available video engine in the Create tab.", "bad");
      await this.patchScene(id, { clipStatus: "queued", clipUrl: null, jobId: null, error: null });
      this.renderScenes();
      const s = this.film().scenes.find(x => x.id === id);
      try {
        await this.makeClip(s, o, eng, n => {
          const badge = this.scenesEl.querySelector(`[data-scene="${id}"] .badge`);
          if (badge) badge.textContent = n;
        });
        toast(`Shot "${s.title}" is ready.`, "good");
      } catch (e) {
        toast(e.message, "bad");
      }
      this.renderScenes();
    },

    async generateMissing() {
      const o = { ...this.optionsFromUI(), ...(this.film().options || {}), engine: this.engineSel.value };
      const eng = SA.engine("video", o.engine);
      if (!eng || eng.status !== "ready") return toast("Choose an available video engine in the Create tab.", "bad");
      this.run = { cancelled: false };
      try {
        await this.generateClips(o, eng);
        toast("All shots are ready.", "good");
      } catch (e) {
        toast(e.message, "bad");
      }
      this.run.done = true;
    },

    renderScenes() {
      if (!this.scenesEl) return;
      const scenes = this.film().scenes || [];
      const save = SA.debounce((id, patch) => this.patchScene(id, patch), 600);
      this.scenesEl.replaceChildren(...(scenes.length ? [] : [h("div", { class: "empty" }, "No shots yet. Use “Create video” to plan them automatically, or add shots yourself.")]));
      scenes.forEach((s, i) => {
        const bind = (key, el, num = false) => (el.addEventListener("input", () => save(s.id, { [key]: num ? Number(el.value) || null : el.value })), el);
        const ready = s.clipStatus === "completed" && s.clipUrl;
        const busy = s.jobId && !ready && !["failed", "expired"].includes(s.clipStatus);
        const mode = h("select", { class: "select", onchange: async e => { await this.patchScene(s.id, { mode: e.target.value }); this.renderScenes(); } }, opt("text", "Text → video"), opt("image", "Image → video"), opt("reference", "Character reference"));
        mode.value = s.mode || "text";
        const frame = h("div", { class: "row" });
        if ((s.mode || "text") === "image") {
          const thumb = h("div", { class: "thumb", style: { width: "96px" } }, "▧");
          if (s.frameAssetId) assets.get(s.frameAssetId).then(({ dataUrl }) => thumb.replaceChildren(h("img", { src: dataUrl, alt: "First frame" }))).catch(() => {});
          frame.append(thumb,
            h("button", { class: "btn sm", onclick: async () => { const [a] = await SA.library.pickAssets({ kind: "image", multiple: false }); if (a) { await this.patchScene(s.id, { frameAssetId: a.id }); this.renderScenes(); } } }, "From library"),
            h("button", { class: "btn sm", onclick: async () => { const f = await SA.pickFile("image/png,image/jpeg,image/webp"); if (!f) return; const src = await SA.encodeImage(URL.createObjectURL(f), { maxSide: 1280, type: "image/jpeg", quality: 0.9 }); const a = await assets.save({ kind: "image", name: s.title + " — first frame", dataUrl: src, projectId: this.project?.id, tags: ["frame"] }); await this.patchScene(s.id, { frameAssetId: a.id }); this.renderScenes(); } }, "Upload"),
            h("span", { class: "small faint" }, "The video starts from this image."));
        } else if (s.mode === "reference") {
          frame.append(h("span", { class: "small faint" }, (s.characters || []).length ? "Uses reference images of: " + s.characters.join(", ") : "Add character names below so their reference images are used."));
        }
        this.scenesEl.append(
          h("div", { class: "scene", "data-scene": s.id },
            h("div", { class: "scene-head" },
              h("span", { class: "scene-num" }, i + 1),
              bind("title", h("input", { class: "input", value: s.title })),
              h("button", { class: "btn sm ghost", title: "Move up", disabled: i === 0, onclick: () => this.moveScene(i, -1) }, "↑"),
              h("button", { class: "btn sm ghost", title: "Move down", disabled: i === scenes.length - 1, onclick: () => this.moveScene(i, 1) }, "↓"),
              h("button", { class: "btn sm ghost", title: "Delete shot", onclick: async () => { if (await SA.confirm("Delete shot?", s.title, { danger: true, ok: "Delete" })) { await this.saveFilm({ scenes: scenes.filter(x => x.id !== s.id) }); this.renderScenes(); } } }, "🗑")
            ),
            bind("prompt", h("textarea", { class: "textarea", style: { minHeight: "64px" }, placeholder: "What happens in this shot (subject, action, setting, camera, light)" }, s.prompt)),
            h("div", { class: "grid g3" },
              h("div", {}, h("label", { class: "lbl" }, "How to generate"), mode),
              h("div", {}, h("label", { class: "lbl" }, "Seconds"), bind("seconds", h("input", { class: "input", type: "number", min: 3, max: 20, value: s.seconds || 6 }), true)),
              h("div", {}, h("label", { class: "lbl" }, "Characters (comma-separated)"), (() => { const inp = h("input", { class: "input", value: (s.characters || []).join(", ") }); inp.addEventListener("input", () => save(s.id, { characters: inp.value.split(",").map(x => x.trim()).filter(Boolean) })); return inp; })())
            ),
            frame,
            h("div", { class: "grid g2" },
              h("div", {}, h("label", { class: "lbl" }, "Narration (spoken)"), bind("narration", h("input", { class: "input", value: s.narration || "" }))),
              h("div", {}, h("label", { class: "lbl" }, "Subtitle"), bind("subtitle", h("input", { class: "input", value: s.subtitle || "" })))
            ),
            h("div", { class: "grid g2" },
              h("div", {}, h("label", { class: "lbl" }, "Trim start (s)"), bind("inPoint", h("input", { class: "input", type: "number", min: 0, step: 0.1, value: s.inPoint || "" , placeholder: "0" }), true)),
              h("div", {}, h("label", { class: "lbl" }, "Trim end (s)"), bind("outPoint", h("input", { class: "input", type: "number", min: 0, step: 0.1, value: s.outPoint || "", placeholder: "end" }), true))
            ),
            s.error ? h("div", { class: "small", style: { color: "var(--bad)" } }, s.error) : "",
            h("div", { class: "row" },
              h("span", { class: "badge " + (ready ? "good" : ["failed", "expired"].includes(s.clipStatus) ? "bad" : busy ? "warn" : "") }, ready ? "clip ready" : s.clipStatus || "no clip yet"),
              h("div", { class: "grow" }),
              ready ? h("button", { class: "btn sm", onclick: () => this.playList([s]) }, "▶") : "",
              ready ? h("button", { class: "btn sm", onclick: async () => SA.download(await SA.fetchResult(s.clipUrl), s.title.replace(/[^\w-]+/g, "-") + ".mp4") }, "⇩") : "",
              h("button", { class: "btn sm primary", disabled: busy, onclick: () => this.regenerateScene(s.id) }, ready ? "Regenerate" : "Generate")
            )
          )
        );
      });
    },

    stopSequence() {
      this.seqStop = true;
      this.player.querySelector("video")?.pause();
    },
    playSequence() {
      const ready = (this.film().scenes || []).filter(s => s.clipStatus === "completed" && s.clipUrl);
      if (!ready.length) return toast("No finished shots yet.");
      return this.playList(ready);
    },
    async playList(list) {
      this.seqStop = false;
      const video = h("video", { playsinline: true });
      const sub = h("div", { class: "subtitle" });
      this.player.replaceChildren(video, sub);
      for (const s of list) {
        if (this.seqStop) break;
        sub.textContent = s.subtitle || "";
        let src;
        try {
          src = URL.createObjectURL(await SA.fetchResult(s.clipUrl));
        } catch (e) {
          toast(`“${s.title}”: ${e.message}`, "bad");
          continue;
        }
        await new Promise(resolve => {
          video.src = src;
          video.onloadedmetadata = () => {
            video.currentTime = Number(s.inPoint) || 0;
            video.play().catch(resolve);
          };
          video.ontimeupdate = () => {
            if (this.seqStop || (Number(s.outPoint) && video.currentTime >= Number(s.outPoint))) {
              video.pause();
              resolve();
            }
          };
          video.onended = resolve;
          video.onerror = resolve;
        });
        URL.revokeObjectURL(src);
      }
      sub.textContent = "";
    },

    planMarkdown() {
      const f = this.film();
      return `# ${f.title || this.project?.title || "Video"}\n\n${f.logline ? "_" + f.logline + "_\n\n" : ""}## Story\n${f.story || ""}\n\n## Characters\n${(f.characters || []).map(c => `- **${c.name}** — ${c.look}`).join("\n") || "-"}\n\n## Shot list\n\n` + (f.scenes || []).map((s, i) => `### ${i + 1}. ${s.title} (${s.seconds}s)\n${s.prompt}\n${s.narration ? "\n> " + s.narration + "\n" : ""}`).join("\n");
    },
    exportPlan() {
      SA.download(this.planMarkdown(), (this.project?.title || "video").replace(/[^\w-]+/g, "-") + "-script.md", "text/markdown");
    },
    async planToDocument() {
      await projects.create("document", (this.project?.title || "Video") + " — script", { html: SA.sanitizeHTML(SA.renderMarkdown(this.planMarkdown())) });
    },

    /* ================================================================== */
    /* Single clips                                                         */
    /* ================================================================== */
    buildClips() {
      this.cPrompt = h("textarea", { class: "textarea", maxlength: 2400, placeholder: "Describe one shot: subject, motion, camera, lighting…" });
      this.cEngine = SA.engineSelect("video", { onChange: () => this.syncClipControls() });
      this.cSeconds = h("input", { class: "input", type: "number", min: 3, max: 20, value: 8 });
      this.cRatio = h("select", { class: "select" }, ...RATIOS.map(([v, l]) => opt(v, l)));
      this.cMode = h("select", { class: "select", onchange: () => this.syncClipControls() }, opt("text", "Text → video"), opt("image", "Image → video"), opt("reference", "Reference images"));
      this.cImages = [];
      this.cImgRow = h("div", { class: "row" });
      this.cStatus = h("div", { class: "status-line" });
      this.cBtn = h("button", { class: "btn primary", onclick: () => this.generateSingle() }, "Generate clip");
      this.cList = h("div", { class: "auto-grid" });
      this.cPreview = h("video", { controls: true, playsinline: true, style: { width: "100%", borderRadius: "12px", background: "#000", display: "none" } });
      const field = (l, e) => h("div", {}, h("label", { class: "lbl" }, l), e);
      this.panels.clips.append(
        h("div", { class: "split" },
          h("div", { class: "card stack" },
            this.cPrompt,
            h("button", { class: "btn sm", style: { alignSelf: "flex-start" }, onclick: async () => { const t = this.cPrompt.value.trim(); if (!t) return; this.cStatus.textContent = "Improving…"; try { this.cPrompt.value = (await SA.ai("prompt", "Improve this AI VIDEO prompt; describe subject, motion, camera and lighting: " + t, { maxTokens: 400 })).trim(); this.cStatus.textContent = ""; } catch (e) { this.cStatus.textContent = e.message; } } }, "✨ Enhance prompt"),
            field("Engine", this.cEngine),
            h("div", { class: "grid g3" }, field("Mode", this.cMode), field("Seconds", this.cSeconds), field("Format", this.cRatio)),
            this.cImgRow,
            this.cBtn, this.cStatus
          ),
          h("div", { class: "stack" },
            this.cPreview,
            h("div", { class: "row" }, h("h3", { class: "grow", style: { margin: 0 } }, "Clips in this project"), h("button", { class: "btn sm ghost", onclick: () => this.importJobs() }, "Find my earlier clips")),
            this.cList
          )
        )
      );
      this.syncClipControls();
    },

    syncClipControls() {
      if (!this.cMode) return;
      const e = SA.engine("video", this.cEngine.value);
      [...this.cMode.options].forEach(o => (o.disabled = !!e && !e.modes.includes(o.value)));
      if (e && !e.modes.includes(this.cMode.value)) this.cMode.value = "text";
      if (e) {
        this.cSeconds.min = e.allowed ? Math.min(...e.allowed) : e.min;
        this.cSeconds.max = e.allowed ? Math.max(...e.allowed) : e.max;
        [...this.cRatio.options].forEach(o => (o.disabled = !e.ratios.includes(o.value)));
        if (!e.ratios.includes(this.cRatio.value)) this.cRatio.value = e.ratios[0];
      }
      const mode = this.cMode.value;
      const max = mode === "image" ? 2 : e?.maxRefs || 0;
      this.cImgRow.replaceChildren();
      if (mode === "text") return;
      this.cImages = this.cImages.slice(0, max);
      this.cImgRow.append(
        h("span", { class: "small muted" }, mode === "image" ? "First frame (and optional last frame):" : `Up to ${max} reference images (characters, products, places):`),
        ...this.cImages.map((src, i) => h("div", { class: "thumb", style: { width: "70px", position: "relative" } }, h("img", { src, alt: "" }), h("button", { class: "btn sm", style: { position: "absolute", top: "2px", right: "2px", padding: "0 5px" }, onclick: () => { this.cImages.splice(i, 1); this.syncClipControls(); } }, "×"))),
        this.cImages.length < max ? h("button", { class: "btn sm", onclick: async () => { const f = await SA.pickFile("image/png,image/jpeg,image/webp"); if (!f) return; this.cImages.push(await SA.encodeImage(URL.createObjectURL(f), { maxSide: 1280, type: "image/jpeg", quality: 0.9 })); this.syncClipControls(); } }, "⇧ Add image") : "",
        this.cImages.length < max ? h("button", { class: "btn sm", onclick: async () => { const picks = await SA.library.pickAssets({ kind: "image" }); for (const a of picks.slice(0, max - this.cImages.length)) this.cImages.push(await this.imageData(a.id)); this.syncClipControls(); } }, "From library") : ""
      );
    },

    async generateSingle() {
      const prompt = this.cPrompt.value.trim();
      if (!prompt) return this.cPrompt.focus();
      if (this.cMode.value !== "text" && !this.cImages.length) return toast("Add an image for this mode.", "bad");
      const eng = SA.engine("video", this.cEngine.value);
      this.cBtn.disabled = true;
      this.cStatus.className = "status-line";
      this.cStatus.textContent = eng?.tier === "premium" ? `Generating with ${eng.label}… this usually takes 1–4 minutes.` : "Sending your request…";
      try {
        await this.ensureProject(prompt);
        const res = await SA.api("video_generate", { engine: this.cEngine.value, prompt, seconds: Number(this.cSeconds.value), aspectRatio: this.cRatio.value, mode: this.cMode.value, images: this.cImages, projectId: this.project.id }, { timeout: 15 * 60000 });
        const clip = { jobId: res.jobId, prompt, engine: this.cEngine.value, seconds: res.seconds, ratio: res.aspectRatio, status: res.status, url: res.url || null, at: Date.now() };
        await this.upsertClip(clip);
        SA.history.add({ kind: "video", title: "Video clip: " + prompt.slice(0, 70), projectId: this.project.id });
        if (res.status !== "completed") {
          this.cStatus.textContent = "Accepted — generating (usually 1–5 minutes). You can keep working.";
          this.pollClip(clip);
        } else {
          this.cStatus.textContent = "Ready!";
          this.showClip(res.url);
        }
      } catch (e) {
        this.cStatus.className = "status-line bad";
        this.cStatus.textContent = e.message;
      } finally {
        this.cBtn.disabled = false;
      }
    },

    async upsertClip(clip, projectId = this.project.id) {
      const key = c => c.jobId || c.videoId;
      const saved = await projects.patch(projectId, data => {
        const clips = [...(data.clips || [])];
        const i = clips.findIndex(c => key(c) === key(clip));
        if (i >= 0) clips[i] = { ...clips[i], ...clip };
        else clips.push(clip);
        return { clips: clips.slice(-100) };
      });
      if (!saved) return;
      if (this.project?.id === projectId) {
        this.project = saved;
        this.renderClips();
      }
    },

    polling: new Set(),
    async pollClip(clip) {
      const id = clip.jobId || clip.videoId;
      if (this.polling.has(id)) return;
      this.polling.add(id);
      const projectId = this.project.id;
      try {
        if (clip.jobId) {
          const st = await SA.waitForVideo(clip.jobId, { onUpdate: u => this.upsertClip({ jobId: clip.jobId, status: u.status, progress: u.progress }, projectId) });
          await this.upsertClip({ jobId: clip.jobId, status: "completed", url: st.url }, projectId);
          toast("Your clip is ready!", "good");
          if (this.project?.id === projectId) this.showClip(st.url);
        } else {
          // Clip created by the earlier NOVA version (legacy endpoint)
          for (let i = 0; i < 200; i++) {
            await sleep(6000);
            const st = await SA.api("check_video", { videoId: clip.videoId }).catch(e => (e.status === 404 ? { status: "failed", error: e.message } : null));
            if (!st) continue;
            if (st.status === "completed" || st.status === "failed") {
              await this.upsertClip({ videoId: clip.videoId, status: st.status, url: st.videoUrl || null, error: st.error }, projectId);
              break;
            }
          }
        }
      } catch (e) {
        await this.upsertClip({ jobId: clip.jobId, videoId: clip.videoId, status: "failed", error: e.message }, projectId);
      } finally {
        this.polling.delete(id);
      }
    },

    showClip(url) {
      this.cPreview.style.display = "block";
      this.cPreview.removeAttribute("src");
      SA.fetchResult(url).then(b => (this.cPreview.src = URL.createObjectURL(b))).catch(() => (this.cPreview.src = url));
    },

    renderClips() {
      if (!this.cList) return;
      const clips = (this.project?.data?.clips || []).slice().reverse();
      this.cList.replaceChildren(...(clips.length ? clips.map(c => {
        const done = c.status === "completed" && c.url;
        const failed = ["failed", "error", "expired"].includes(c.status);
        return h("div", { class: "item-card" },
          h("div", { class: "row" }, h("span", { class: "badge " + (done ? "good" : failed ? "bad" : "warn") }, done ? "ready" : c.status || "queued"), h("span", { class: "small faint" }, [c.seconds && c.seconds + "s", c.ratio, SA.engine("video", c.engine)?.label?.split(" (")[0]].filter(Boolean).join(" · "))),
          h("div", { class: "meta", title: c.prompt }, (c.prompt || "").slice(0, 120)),
          c.error ? h("div", { class: "small", style: { color: "var(--bad)" } }, c.error) : "",
          h("div", { class: "actions" },
            done ? h("button", { class: "btn sm primary", onclick: () => this.showClip(c.url) }, "▶ Play") : "",
            done ? h("button", { class: "btn sm", onclick: async () => SA.download(await SA.fetchResult(c.url), "success-ai-clip.mp4") }, "⇩") : "",
            done ? h("button", { class: "btn sm", onclick: async () => { await assets.save({ kind: "video", name: (c.prompt || "Clip").slice(0, 60), url: c.url, projectId: this.project.id, tags: ["clip"] }); toast("Saved to Asset Library.", "good"); } }, "Save") : "",
            done ? h("button", { class: "btn sm", onclick: async () => { await this.saveFilm({ scenes: [...(this.film().scenes || []), { id: uid("scn"), title: "Clip", prompt: c.prompt, seconds: c.seconds || 6, mode: "text", clipStatus: "completed", clipUrl: c.url, jobId: c.jobId, narration: "", subtitle: "" }] }); toast("Added to Scenes."); } }, "＋ Scenes") : "",
            !done && !failed ? h("button", { class: "btn sm", onclick: () => this.pollClip(c) }, "Check") : ""
          )
        );
      }) : [h("div", { class: "empty" }, "No single clips yet.")]));
    },

    async importJobs() {
      try {
        await this.ensureProject("Earlier videos");
        const [{ jobs }, legacy] = await Promise.all([SA.api("list_gen_jobs", { kind: "video" }), SA.api("list_video_jobs").catch(() => ({ jobs: [] }))]);
        const have = new Set((this.project.data.clips || []).map(c => c.jobId || c.videoId));
        let added = 0;
        for (const j of jobs) {
          if (have.has(j.id) || (j.project_id && j.project_id !== this.project.id)) continue;
          await this.upsertClip({ jobId: j.id, prompt: j.prompt, engine: j.engine, seconds: j.params?.seconds, ratio: j.params?.ratio, status: j.status, url: j.result_url, error: j.error, at: Date.parse(j.created_at) || Date.now() });
          added++;
        }
        for (const j of legacy.jobs || []) {
          if (have.has(j.video_id) || jobs.some(x => x.params && x.prompt === j.prompt && j.status === x.status)) continue;
          if (j.project_id && j.project_id !== this.project.id) continue;
          await this.upsertClip({ videoId: j.video_id, prompt: j.prompt || "(earlier NOVA video)", seconds: j.seconds, ratio: j.aspect_ratio, status: j.status || "processing", url: j.url, at: Date.parse(j.created_at) || Date.now() });
          added++;
        }
        toast(added ? `Added ${added} earlier clip(s).` : "All your clips are already here.");
      } catch (e) {
        toast(e.message, "bad");
      }
    },

    /* ================================================================== */
    /* Lifecycle                                                            */
    /* ================================================================== */
    async load(p) {
      this.project = p;
      this.lastRender = null;
      const d = p?.data || {};
      const f = d.film || {};
      const o = f.options || {};
      this.story.value = f.story || f.concept || d.seed || "";
      if (o.length) this.length.value = o.length;
      if (o.ratio) this.ratio.value = o.ratio;
      if (o.style) this.style.value = o.style;
      if (o.engine && SA.engine("video", o.engine)?.status === "ready") this.engineSel.value = o.engine;
      this.narration.value = o.narration ?? "";
      this.music.value = o.music || "ai";
      this.musicAssetId = o.musicAssetId || null;
      this.consistent.checked = o.consistent !== false;
      this.subs.checked = o.subtitles !== false;
      this.keepSound.checked = o.keepSound !== false;
      this.cPrompt.value = d.prompt || "";
      this.stepState = {};
      if (f.scenes?.length) {
        const ready = f.scenes.filter(s => s.clipStatus === "completed").length;
        this.stepState = { plan: { s: "done", d: `${f.scenes.length} shots` }, clips: { s: ready === f.scenes.length ? "done" : "wait", d: `${ready}/${f.scenes.length} ready` }, render: f.lastRender ? { s: "done", d: "Rendered " + new Date(f.lastRender.at).toLocaleString() } : { s: "wait" } };
      }
      this.renderSteps();
      this.progress(f.lastRender ? 1 : 0, "");
      this.onMusicChoice();
      this.renderResult();
      this.renderScenes();
      this.renderClips();
      for (const c of d.clips || []) if (!["completed", "failed", "expired", "timeout"].includes(c.status)) this.pollClip(c);
    },
    context(p) {
      const f = p.data?.film || {};
      return `Video project “${f.title || p.title}”. Story: ${(f.story || "").slice(0, 1500)}\nCharacters: ${(f.characters || []).map(c => c.name + " (" + c.look + ")").join("; ")}\nShots:\n${(f.scenes || []).map((s, i) => `${i + 1}. ${s.title} [${s.seconds}s, ${s.clipStatus || "no clip"}] ${s.prompt.slice(0, 140)}${s.narration ? ' — "' + s.narration + '"' : ""}`).join("\n")}`;
    }
  });
})();
