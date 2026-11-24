/* Success AI — Music Studio: songwriting, voice, audio editor */
(() => {
  "use strict";
  const { h, studio, store, projects, toast, assets, uid } = SA;

  let audioCtx;
  const ctx = () => (audioCtx ||= new (window.AudioContext || window.webkitAudioContext)());

  /* ---------- audio helpers ---------- */
  function encodeWAV(buffer) {
    const ch = buffer.numberOfChannels,
      rate = buffer.sampleRate,
      len = buffer.length;
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    data.setUint32(4, 36 + len * ch * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, ch, true);
    data.setUint32(24, rate, true);
    data.setUint32(28, rate * ch * 2, true);
    data.setUint16(32, ch * 2, true);
    data.setUint16(34, 16, true);
    str(36, "data");
    data.setUint32(40, len * ch * 2, true);
    const chans = [...Array(ch)].map((_, i) => buffer.getChannelData(i));
    let o = 44;
    for (let i = 0; i < len; i++)
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    return new Blob([data], { type: "audio/wav" });
  }

  async function processClip(clip) {
    const b = clip.buffer;
    const start = Math.max(0, Math.min(clip.trimStart, b.duration));
    const end = Math.max(start + 0.05, Math.min(clip.trimEnd ?? b.duration, b.duration));
    const dur = end - start;
    const off = new OfflineAudioContext(Math.max(1, b.numberOfChannels), Math.ceil(dur * b.sampleRate), b.sampleRate);
    const src = off.createBufferSource();
    src.buffer = b;
    const g = off.createGain();
    const vol = clip.gain;
    g.gain.setValueAtTime(clip.fadeIn > 0 ? 0 : vol, 0);
    if (clip.fadeIn > 0) g.gain.linearRampToValueAtTime(vol, Math.min(clip.fadeIn, dur));
    if (clip.fadeOut > 0) {
      g.gain.setValueAtTime(vol, Math.max(0, dur - clip.fadeOut));
      g.gain.linearRampToValueAtTime(0, dur);
    }
    src.connect(g).connect(off.destination);
    src.start(0, start, dur);
    return off.startRendering();
  }

  function concatBuffers(buffers, gap = 0) {
    const rate = buffers[0].sampleRate;
    const ch = Math.max(...buffers.map(b => b.numberOfChannels));
    const gapSamples = Math.round(gap * rate);
    const total = buffers.reduce((n, b) => n + b.length, 0) + gapSamples * (buffers.length - 1);
    const out = ctx().createBuffer(ch, total, rate);
    let offset = 0;
    for (const b of buffers) {
      for (let c = 0; c < ch; c++) out.getChannelData(c).set(b.getChannelData(Math.min(c, b.numberOfChannels - 1)), offset);
      offset += b.length + gapSamples;
    }
    return out;
  }

  function drawWave(canvas, clip) {
    const c2 = canvas.getContext("2d");
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio || 600);
    const hgt = (canvas.height = 110 * devicePixelRatio);
    c2.clearRect(0, 0, w, hgt);
    if (!clip) return;
    const data = clip.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const dur = clip.buffer.duration;
    const x0 = (clip.trimStart / dur) * w;
    const x1 = ((clip.trimEnd ?? dur) / dur) * w;
    c2.fillStyle = "#f5b34222";
    c2.fillRect(x0, 0, x1 - x0, hgt);
    c2.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#f5b342";
    for (let x = 0; x < w; x++) {
      let min = 1,
        max = -1;
      for (let i = 0; i < step; i++) {
        const v = data[x * step + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      c2.globalAlpha = x >= x0 && x <= x1 ? 1 : 0.3;
      c2.fillRect(x, ((1 + min) / 2) * hgt, 1, Math.max(1, ((max - min) / 2) * hgt));
    }
    c2.globalAlpha = 1;
  }

  studio({
    id: "music",
    title: "Music Studio",
    kicker: "SONGWRITING · VOICE · AUDIO",
    projectType: "music",
    project: null,
    clips: [],
    selected: null,

    mount(el) {
      const tabs = h("div", { class: "tabs" });
      this.panels = { song: h("div"), write: h("div"), voice: h("div"), edit: h("div") };
      const sel = name => {
        tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        Object.entries(this.panels).forEach(([k, p]) => (p.hidden = k !== name));
        if (name === "edit") this.renderEditor();
        if (name === "song") this.renderSongs();
      };
      [["song", "🎵 Create song"], ["write", "Songwriting"], ["voice", "Voice & recording"], ["edit", "Audio editor"]].forEach(([k, l]) => tabs.append(h("button", { class: "tab", "data-tab": k, onclick: () => sel(k) }, l)));
      this.selectTab = sel;
      el.append(tabs, ...Object.values(this.panels));
      this.buildWrite();
      this.buildSong();
      this.buildVoice();
      this.buildEditor();
      sel("song");
    },

    /* ================= Create song (AI music generation) ================= */
    buildSong() {
      this.sEngine = SA.engineSelect("music", { onChange: e => this.syncSong(e) });
      this.sPrompt = h("textarea", { class: "textarea", maxlength: 2000, placeholder: "Describe the song: genre, mood, instruments, voice, story…\nExample: Emotional Nepali pop ballad, female vocals, piano and madal, about returning home to the mountains" });
      this.sVocals = h("select", { class: "select" }, h("option", { value: "auto" }, "Vocals — AI writes the lyrics"), h("option", { value: "mine" }, "Vocals — use my lyrics (Songwriting tab)"), h("option", { value: "inst" }, "Instrumental (no vocals)"));
      this.sBtn = h("button", { class: "btn primary", style: { fontSize: "15px", padding: "11px 18px" }, onclick: () => this.makeSong() }, "🎵 Create song");
      this.sStatus = h("div", { class: "status-line" });
      this.sNote = h("div", { class: "small faint" });
      this.sList = h("div", { class: "stack" });
      this.sUnavailable = h("div", { class: "notice", hidden: true });
      this.panels.song.append(
        h("div", { class: "split" },
          h("div", { class: "card stack" },
            h("h2", {}, "Make a full song"),
            this.sPrompt,
            h("button", { class: "btn sm", style: { alignSelf: "flex-start" }, onclick: () => { this.sPrompt.value = [this.genre.value, this.mood.value.toLowerCase(), this.tempo.value + " BPM", this.lang.value + " lyrics", this.concept.value].filter(Boolean).join(", "); } }, "Use Songwriting settings"),
            h("div", {}, h("label", { class: "lbl" }, "Engine"), this.sEngine),
            this.sNote,
            h("div", {}, h("label", { class: "lbl" }, "Vocals"), this.sVocals),
            this.sBtn, this.sStatus, this.sUnavailable
          ),
          h("div", { class: "card stack" }, h("h2", {}, "Songs in this project"), this.sList)
        )
      );
      this.syncSong(SA.engine("music", this.sEngine.value));
      SA.on("credits", () => this.syncSong(SA.engine("music", this.sEngine.value)));
      SA.on("auth", () => this.syncSong(SA.engine("music", this.sEngine.value)));
    },
    syncSong(e) {
      if (!this.sNote) return;
      const ready = SA.readyEngines("music");
      this.sUnavailable.hidden = ready.length > 0;
      this.sBtn.disabled = !ready.length;
      this.sUnavailable.textContent = SA.state.user ? "Song generation isn't switched on for this site yet. Songwriting, voice and the audio editor are free." : "Songs with real singing use Pro credits. Create a free account to buy credits — songwriting, voice and the audio editor are free.";
      const cost = e ? SA.creditCost(e.id, 1) : 0;
      this.sNote.dataset.quota = cost ? ` Costs ${cost} Pro credits per song (you have ${SA.state.credits?.balance ?? 0}).` : "";
      if (e) this.sNote.textContent = (e.id === "minimax-music" ? "Full songs with real singing. Uses your lyrics or writes its own." : e.id === "lyria-3" ? "30-second tracks — great for intros, ads and video soundtracks." : "Full-length songs; lyrics are passed as guidance.") + (this.sNote.dataset.quota || "");
      if (e && !e.lyrics && this.sVocals.value === "mine") this.sVocals.value = "auto";
    },
    async makeSong() {
      const prompt = this.sPrompt.value.trim();
      if (!prompt) return this.sPrompt.focus();
      const mode = this.sVocals.value;
      if (mode === "mine" && !this.lyrics.value.trim()) return toast("Write or generate lyrics in the Songwriting tab first.", "bad");
      this.sBtn.disabled = true;
      this.sStatus.className = "status-line";
      const t0 = Date.now();
      const timer = setInterval(() => (this.sStatus.textContent = `Composing your song… ${Math.round((Date.now() - t0) / 1000)}s (usually 1–3 minutes)`), 1000);
      try {
        await projects.ensure("music", prompt);
        this.project = projects.active;
        const res = await SA.api("music_generate", { engine: this.sEngine.value, prompt, instrumental: mode === "inst", lyrics: mode === "mine" ? this.lyrics.value : "", projectId: this.project.id }, { timeout: 12 * 60000 });
        const song = { id: uid("song"), url: res.url || null, audioData: res.audioData && res.audioData.length < 400000 ? res.audioData : null, prompt, engine: res.engine, vocals: mode, at: Date.now() };
        if (res.url) {
          const asset = await assets.save({ kind: "audio", name: prompt.slice(0, 60), url: res.url, projectId: this.project.id, tags: ["song", res.engine] }).catch(() => null);
          if (asset) song.assetId = asset.id;
        } else if (res.audioData) {
          const asset = await assets.save({ kind: "audio", name: prompt.slice(0, 60), dataUrl: res.audioData, projectId: this.project.id, tags: ["song", res.engine] }).catch(() => null);
          if (asset) song.assetId = asset.id;
        }
        const fresh = await store.get("projects", this.project.id);
        this.project = await projects.patch(this.project.id, { songs: [...(fresh.data.songs || []), song].slice(-40) });
        this.sStatus.textContent = "Your song is ready! It's also saved in your Asset Library.";
        SA.refreshCredits();
        SA.history.add({ kind: "music", title: "Created song: " + prompt.slice(0, 70), projectId: this.project.id });
        this.renderSongs();
      } catch (e) {
        this.sStatus.className = "status-line bad";
        this.sStatus.textContent = e.message;
      } finally {
        clearInterval(timer);
        this.sBtn.disabled = !SA.readyEngines("music").length;
      }
    },
    async songBlob(song) {
      if (song.audioData) return SA.dataUrlToBlob(song.audioData);
      if (song.url) {
        try {
          return await SA.fetchResult(song.url);
        } catch (e) {
          if (!song.assetId) throw e;
        }
      }
      const { dataUrl } = await assets.get(song.assetId);
      return SA.fetchResult(dataUrl);
    },
    renderSongs() {
      if (!this.sList) return;
      const songs = (this.project?.data?.songs || []).slice().reverse();
      this.sList.replaceChildren(...(songs.length ? songs.map(song => {
        const player = h("audio", { controls: true, style: { width: "100%" }, preload: "none" });
        const load = h("button", { class: "btn sm primary", onclick: async () => { load.disabled = true; try { player.src = URL.createObjectURL(await this.songBlob(song)); player.play(); load.remove(); } catch (e) { toast(e.message, "bad"); load.disabled = false; } } }, "▶ Load & play");
        return h("div", { class: "item-card" },
          h("div", { class: "row" }, h("b", { class: "grow" }, song.prompt.slice(0, 80)), h("span", { class: "badge" }, song.vocals === "inst" ? "instrumental" : "vocals")),
          h("div", { class: "meta" }, (SA.engine("music", song.engine)?.label || song.engine) + " · " + new Date(song.at).toLocaleString()),
          player,
          h("div", { class: "actions" }, load,
            h("button", { class: "btn sm", onclick: async () => { try { SA.download(await this.songBlob(song), song.prompt.slice(0, 40).replace(/[^\w-]+/g, "-") + ".mp3"); } catch (e) { toast(e.message, "bad"); } } }, "⇩ MP3"),
            h("button", { class: "btn sm", onclick: async () => { try { await this.addClipFromBlob(await this.songBlob(song), song.prompt.slice(0, 40)); this.selectTab("edit"); } catch (e) { toast(e.message, "bad"); } } }, "Edit audio"))
        );
      }) : [h("div", { class: "empty" }, "Your generated songs appear here. Each one is also saved to the Asset Library, where Video Studio can use it as a soundtrack.")]));
    },

    /* ================= Songwriting ================= */
    buildWrite() {
      const opt = (arr) => arr.map(v => h("option", { value: v }, v));
      this.genre = h("select", { class: "select" }, ...opt(["Pop", "Rock", "Hip-hop", "R&B", "Folk", "Lok Dohori", "Adhunik", "EDM", "Jazz", "Country", "Classical", "Lo-fi", "Ballad", "Indie"]));
      this.mood = h("select", { class: "select" }, ...opt(["Uplifting", "Romantic", "Sad", "Nostalgic", "Energetic", "Dark", "Peaceful", "Angry", "Hopeful", "Playful"]));
      this.tempo = h("input", { class: "input", type: "number", min: 40, max: 220, value: 100 });
      this.lang = h("input", { class: "input", value: "English", placeholder: "e.g. Nepali, English, Hindi" });
      this.concept = h("textarea", { class: "textarea", placeholder: "What's the song about? Story, feelings, images, instruments…" });
      this.lyrics = h("textarea", { class: "textarea", style: { minHeight: "380px", fontSize: "15px", lineHeight: "1.8" }, placeholder: "[Verse 1]\nWrite or generate lyrics here…" });
      this.notes = h("textarea", { class: "textarea", placeholder: "Production notes: chords, instruments, arrangement, vocal style…" });
      this.writeStatus = h("div", { class: "status-line" });
      const sectionBtn = (label, what) => h("button", { class: "btn sm", onclick: () => this.writeSection(label, what) }, label);
      this.panels.write.append(
        h("div", { class: "split" },
          h("div", { class: "card stack" },
            h("div", { class: "grid g2" }, h("div", {}, h("label", { class: "lbl" }, "Genre"), this.genre), h("div", {}, h("label", { class: "lbl" }, "Mood"), this.mood)),
            h("div", { class: "grid g2" }, h("div", {}, h("label", { class: "lbl" }, "Tempo (BPM)"), this.tempo), h("div", {}, h("label", { class: "lbl" }, "Language(s)"), this.lang)),
            h("div", {}, h("label", { class: "lbl" }, "Song concept"), this.concept),
            h("button", { class: "btn primary", onclick: () => this.writeSong() }, "Write complete song"),
            h("div", { class: "row" }, sectionBtn("Verse", "a new verse"), sectionBtn("Pre-chorus", "a pre-chorus"), sectionBtn("Chorus", "a catchy chorus/hook"), sectionBtn("Bridge", "a bridge that shifts perspective"), sectionBtn("Outro", "an outro")),
            h("div", { class: "row" },
              h("button", { class: "btn sm", onclick: () => this.improve() }, "Polish lyrics"),
              h("button", { class: "btn sm", onclick: () => this.rhymes() }, "Find rhymes"),
              h("button", { class: "btn sm", onclick: () => this.production() }, "Production plan"),
              h("button", { class: "btn sm", onclick: () => this.translateLyrics() }, "Translate")
            ),
            this.writeStatus
          ),
          h("div", { class: "stack" },
            h("div", { class: "card stack" }, h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Lyrics"),
              h("button", { class: "btn sm", onclick: () => SA.download(this.lyrics.value, (this.project?.title || "lyrics").replace(/[^\w-]+/g, "-") + ".txt", "text/plain") }, "⇩ .txt"),
              h("button", { class: "btn sm", onclick: () => this.toVoice() }, "→ Voice"),
              h("button", { class: "btn sm", onclick: () => projects.create("document", (this.project?.title || "Song") + " — lyrics", { html: "<h1>" + SA.esc(this.project?.title || "Song") + "</h1>" + this.lyrics.value.split("\n").map(l => "<p>" + SA.esc(l) + "</p>").join("") }) }, "→ Document")),
              this.lyrics),
            h("div", { class: "card stack" }, h("h2", {}, "Production notes"), this.notes)
          )
        )
      );
      const save = SA.debounce(() => this.saveData(), 800);
      [this.lyrics, this.notes, this.concept, this.lang, this.tempo].forEach(i => i.addEventListener("input", save));
      [this.genre, this.mood].forEach(i => i.addEventListener("change", save));
    },

    async saveData() {
      if (!this.project) {
        if (!this.lyrics.value.trim() && !this.concept.value.trim()) return;
        await projects.ensure("music", this.concept.value || "Untitled song");
        this.project = projects.active;
      }
      this.project = await projects.patch(this.project.id, { genre: this.genre.value, mood: this.mood.value, tempo: this.tempo.value, language: this.lang.value, brief: this.concept.value, lyrics: this.lyrics.value, notes: this.notes.value });
    },

    brief() {
      return `Genre: ${this.genre.value}. Mood: ${this.mood.value}. Tempo: ${this.tempo.value} BPM. Language(s): ${this.lang.value}.\nConcept: ${this.concept.value || "(open)"}`;
    },
    async run(label, fn) {
      this.writeStatus.className = "status-line";
      this.writeStatus.textContent = label + "…";
      try {
        await fn();
        this.writeStatus.textContent = "Done.";
        await this.saveData();
      } catch (e) {
        this.writeStatus.className = "status-line bad";
        this.writeStatus.textContent = e.message;
      }
    },
    async writeSong() {
      if (this.lyrics.value.trim() && !(await SA.confirm("Replace lyrics?", "The current lyrics will be replaced. (They stay in version history once synced.)"))) return;
      await this.run("Writing your song", async () => {
        this.lyrics.value = await SA.ai("music", `Write complete original song lyrics with section labels like [Verse 1], [Chorus], [Bridge].\n${this.brief()}\nReturn only the lyrics.`, { maxTokens: 2000 });
        SA.history.add({ kind: "music", title: "Wrote song lyrics", projectId: this.project?.id });
      });
    },
    async writeSection(label, what) {
      await this.run("Writing " + label.toLowerCase(), async () => {
        const out = await SA.ai("music", `Write ${what} for this song. Match the existing lyrics' voice and rhyme scheme.\n${this.brief()}\nExisting lyrics:\n${this.lyrics.value || "(none yet)"}\nReturn only the new section text, without a label.`, { maxTokens: 700 });
        this.lyrics.value = (this.lyrics.value.trim() ? this.lyrics.value.trim() + "\n\n" : "") + `[${label}]\n` + out.trim().replace(/^\[.*?\]\s*/, "");
      });
    },
    async improve() {
      if (!this.lyrics.value.trim()) return toast("Write or generate lyrics first.");
      const original = this.lyrics.value;
      await this.run("Polishing", async () => {
        const out = await SA.ai("music", `Polish these lyrics: improve imagery, rhythm and rhymes while keeping the meaning and section labels.\n${this.brief()}\n\n${original}\n\nReturn only the revised lyrics.`, { maxTokens: 2000 });
        const ok = await SA.modal({ title: "Review polished lyrics", wide: true, body: SA.renderDiff(original, out).el, actions: [{ label: "Keep original", value: false }, { label: "Use polished version", kind: "primary", value: true }] });
        if (ok) this.lyrics.value = out;
      });
    },
    async rhymes() {
      const word = await SA.prompt("Find rhymes", { label: "Word or phrase" });
      if (!word) return;
      await this.run("Finding rhymes", async () => {
        const out = await SA.ai("music", `List perfect rhymes, near rhymes and multi-syllable rhymes for "${word}" in ${this.lang.value}. Short grouped lists.`, { maxTokens: 500 });
        await SA.modal({ title: "Rhymes for “" + word + "”", body: h("div", { class: "md", html: SA.renderMarkdown(out) }) });
      });
    },
    async production() {
      await this.run("Planning production", async () => {
        this.notes.value = await SA.ai("music", `Create a concise production plan for this song: key, chord progression per section, instrumentation, arrangement timeline, vocal direction, mix notes.\n${this.brief()}\nLyrics:\n${this.lyrics.value.slice(0, 4000)}`, { maxTokens: 1500 });
      });
    },
    async translateLyrics() {
      const lang = await SA.prompt("Translate lyrics", { label: "Into which language?", value: "Nepali" });
      if (!lang) return;
      await this.run("Translating", async () => {
        const out = await SA.ai("music", `Translate these song lyrics into ${lang}, keeping them singable (rhythm, rhyme) and keeping section labels.\n\n${this.lyrics.value}`, { maxTokens: 2000 });
        this.lyrics.value += `\n\n--- ${lang} version ---\n` + out;
      });
    },
    toVoice() {
      this.ttsText.value = this.lyrics.value.replace(/\[.*?\]/g, "").trim().slice(0, 1500);
      this.selectTab("voice");
    },

    /* ================= Voice ================= */
    buildVoice() {
      this.ttsText = h("textarea", { class: "textarea", maxlength: 1500, placeholder: "Text to speak (narration, voiceover, demo vocal guide)…" });
      this.ttsLang = h("select", { class: "select", style: { width: "auto" } }, ...[["en", "English"], ["es", "Spanish"], ["fr", "French"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"]].map(([v, l]) => h("option", { value: v }, l)));
      this.ttsStatus = h("div", { class: "status-line" });
      this.ttsAudio = h("audio", { controls: true, style: { width: "100%", display: "none" } });
      this.recBtn = h("button", { class: "btn primary", onclick: () => this.toggleRecord() }, "● Start recording");
      this.recStatus = h("div", { class: "status-line" });
      this.recAudio = h("audio", { controls: true, style: { width: "100%", display: "none" } });
      this.panels.voice.append(
        h("div", { class: "grid g2" },
          h("div", { class: "card stack" },
            h("h2", {}, "Text to speech"),
            h("p", { class: "small muted" }, "Spoken narration voice (MeloTTS). For singing, use Create song."),
            this.ttsText,
            h("div", { class: "row" }, this.ttsLang, h("button", { class: "btn primary", onclick: () => this.speak() }, "Generate speech")),
            this.ttsStatus, this.ttsAudio
          ),
          h("div", { class: "card stack" },
            h("h2", {}, "Record your voice"),
            h("p", { class: "small muted" }, "Record vocals, ideas or narration with your microphone. Your browser will ask for permission."),
            this.recBtn, this.recStatus, this.recAudio
          )
        )
      );
    },
    async speak() {
      const text = this.ttsText.value.trim();
      if (!text) return this.ttsText.focus();
      this.ttsStatus.className = "status-line";
      this.ttsStatus.textContent = "Generating voice…";
      try {
        const { audioData } = await SA.api("tts", { text, lang: this.ttsLang.value });
        this.ttsAudio.src = audioData;
        this.ttsAudio.style.display = "block";
        this.ttsStatus.textContent = "Ready. Added to the audio editor.";
        await this.addClipFromDataUrl(audioData, "Voice: " + text.slice(0, 30));
        await projects.ensure("music", "Voice: " + text);
        this.project = projects.active;
        await assets.save({ kind: "audio", name: "Voice: " + text.slice(0, 50), dataUrl: audioData, projectId: this.project.id, tags: ["tts"] }).catch(e => toast("Not saved to library: " + e.message, "bad"));
        SA.history.add({ kind: "music", title: "Generated voice clip", projectId: this.project.id });
      } catch (e) {
        this.ttsStatus.className = "status-line bad";
        this.ttsStatus.textContent = e.message;
      }
    },
    async toggleRecord() {
      if (this.recorder?.state === "recording") {
        this.recorder.stop();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Recording isn't supported in this browser.", "bad");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        this.recorder = new MediaRecorder(stream);
        this.recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        this.recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          clearInterval(this.recTimer);
          this.recBtn.textContent = "● Start recording";
          const blob = new Blob(chunks, { type: this.recorder.mimeType || "audio/webm" });
          this.recAudio.src = URL.createObjectURL(blob);
          this.recAudio.style.display = "block";
          this.recStatus.textContent = "Recording added to the audio editor.";
          await this.addClipFromBlob(blob, "Recording " + new Date().toLocaleTimeString());
        };
        this.recorder.start();
        const t0 = Date.now();
        this.recBtn.textContent = "■ Stop recording";
        this.recTimer = setInterval(() => (this.recStatus.textContent = "Recording… " + Math.round((Date.now() - t0) / 1000) + "s"), 500);
      } catch (e) {
        toast("Microphone unavailable: " + e.message, "bad");
      }
    },

    /* ================= Audio editor ================= */
    buildEditor() {
      this.clipList = h("div", { class: "stack" });
      this.wave = h("canvas", { class: "waveform" });
      this.ctrl = h("div", { class: "stack" });
      this.mixAudio = h("audio", { controls: true, style: { width: "100%", display: "none" } });
      this.mixStatus = h("div", { class: "status-line" });
      this.mixActions = h("div");
      this.panels.edit.append(
        h("div", { class: "split" },
          h("div", { class: "card stack" },
            h("div", { class: "row" }, h("h2", { class: "grow", style: { margin: 0 } }, "Tracks"), h("button", { class: "btn sm primary", onclick: () => this.uploadAudio() }, "⇧ Add audio")),
            h("p", { class: "small muted" }, "Clips play one after another in this order when you render. Clips stay in this session; rendered mixes are saved to your library."),
            this.clipList
          ),
          h("div", { class: "stack" },
            h("div", { class: "card stack" }, this.wave, this.ctrl),
            h("div", { class: "card stack" },
              h("h2", {}, "Render arrangement"),
              h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => this.renderMix() }, "Render mix (WAV)"), this.mixStatus),
              this.mixAudio,
              this.mixActions,
              h("div", { class: "small faint" }, "Exports lossless WAV. MP3 export needs an encoder that isn't bundled yet.")
            )
          )
        )
      );
      window.addEventListener("resize", SA.debounce(() => this.selected && drawWave(this.wave, this.selected), 200));
    },
    async addClipFromBlob(blob, name) {
      try {
        const buffer = await ctx().decodeAudioData(await blob.arrayBuffer());
        const clip = { id: uid("clip"), name, buffer, trimStart: 0, trimEnd: buffer.duration, gain: 1, fadeIn: 0, fadeOut: 0 };
        this.clips.push(clip);
        this.selected = clip;
        this.renderEditor();
        return clip;
      } catch {
        toast(`Couldn't decode "${name}". Try MP3, WAV, OGG or M4A.`, "bad");
      }
    },
    addClipFromDataUrl(dataUrl, name) {
      return this.addClipFromBlob(SA.dataUrlToBlob(dataUrl), name);
    },
    async uploadAudio() {
      const files = await SA.pickFile("audio/*", true);
      for (const f of files || []) {
        if (f.size > 80 * 1024 * 1024) {
          toast(f.name + " is over 80 MB.", "bad");
          continue;
        }
        await this.addClipFromBlob(f, f.name);
      }
    },
    renderEditor() {
      this.clipList.replaceChildren(...(this.clips.length ? this.clips.map((c, i) => h("div", { class: "row item-card", style: { flexDirection: "row", borderColor: c === this.selected ? "var(--accent)" : "" } },
        h("button", { class: "btn ghost grow", style: { justifyContent: "flex-start", overflow: "hidden" }, onclick: () => { this.selected = c; this.renderEditor(); } }, (i + 1) + ". " + c.name, h("span", { class: "faint small" }, " · " + ((c.trimEnd - c.trimStart) || 0).toFixed(1) + "s")),
        h("button", { class: "btn sm ghost", disabled: i === 0, onclick: () => { [this.clips[i - 1], this.clips[i]] = [this.clips[i], this.clips[i - 1]]; this.renderEditor(); } }, "↑"),
        h("button", { class: "btn sm ghost", onclick: () => { const b = this.clips[i]; this.clips.splice(i + 1, 0, { ...b, id: uid("clip"), name: b.name + " (copy)" }); this.renderEditor(); } }, "⧉"),
        h("button", { class: "btn sm ghost", onclick: () => { this.clips.splice(i, 1); if (this.selected === c) this.selected = this.clips[0] || null; this.renderEditor(); } }, "✕")
      )) : [h("div", { class: "empty small" }, "Add audio files, record your voice, or generate speech.")]));

      const c = this.selected;
      this.ctrl.replaceChildren();
      drawWave(this.wave, c);
      if (!c) return;
      const dur = c.buffer.duration;
      const num = (label, key, min, max, step) => {
        const input = h("input", { class: "input", type: "number", min, max, step, value: Number(c[key]).toFixed(2) });
        input.addEventListener("change", () => {
          c[key] = Math.max(min, Math.min(max, Number(input.value) || 0));
          if (c.trimEnd <= c.trimStart) c.trimEnd = Math.min(dur, c.trimStart + 0.1);
          this.renderEditor();
        });
        return h("div", {}, h("label", { class: "lbl" }, label), input);
      };
      this.ctrl.append(
        h("div", { class: "row" }, h("b", { class: "grow" }, c.name), h("span", { class: "small muted" }, dur.toFixed(2) + "s · " + c.buffer.sampleRate + " Hz · " + c.buffer.numberOfChannels + " ch")),
        h("div", { class: "grid g3" }, num("Trim start (s)", "trimStart", 0, dur, 0.01), num("Trim end (s)", "trimEnd", 0, dur, 0.01), num("Volume (×)", "gain", 0, 4, 0.05)),
        h("div", { class: "grid g3" }, num("Fade in (s)", "fadeIn", 0, dur, 0.1), num("Fade out (s)", "fadeOut", 0, dur, 0.1),
          h("div", {}, h("label", { class: "lbl" }, "Split at (s)"), h("div", { class: "row nowrap" }, (this.splitAt = h("input", { class: "input", type: "number", min: 0, max: dur, step: 0.01, value: (dur / 2).toFixed(2) })), h("button", { class: "btn sm", onclick: () => this.split(c) }, "Split")))),
        h("div", { class: "row" },
          h("button", { class: "btn primary", onclick: () => this.preview(c) }, "▶ Preview clip"),
          h("button", { class: "btn", onclick: () => this.stopPreview() }, "■ Stop"),
          h("button", { class: "btn", onclick: async () => SA.download(encodeWAV(await processClip(c)), c.name.replace(/[^\w-]+/g, "-") + ".wav") }, "⇩ Export clip")
        )
      );
    },
    split(c) {
      const at = Number(this.splitAt.value);
      if (!(at > c.trimStart && at < c.trimEnd)) return toast("Split point must be inside the trimmed region.", "bad");
      const i = this.clips.indexOf(c);
      const a = { ...c, id: uid("clip"), name: c.name + " (A)", trimEnd: at, fadeOut: 0 };
      const b = { ...c, id: uid("clip"), name: c.name + " (B)", trimStart: at, fadeIn: 0 };
      this.clips.splice(i, 1, a, b);
      this.selected = a;
      this.renderEditor();
    },
    async preview(c) {
      this.stopPreview();
      const buf = await processClip(c);
      this.player = ctx().createBufferSource();
      this.player.buffer = buf;
      this.player.connect(ctx().destination);
      await ctx().resume();
      this.player.start();
    },
    stopPreview() {
      try {
        this.player?.stop();
      } catch {
        /* not playing */
      }
    },
    async renderMix() {
      if (!this.clips.length) return toast("Add at least one clip.");
      this.mixStatus.textContent = "Rendering…";
      try {
        const rates = new Set(this.clips.map(c => c.buffer.sampleRate));
        if (rates.size > 1) throw new Error("Clips have different sample rates; re-add them in this session so they share one rate.");
        const processed = [];
        for (const c of this.clips) processed.push(await processClip(c));
        const mix = concatBuffers(processed);
        const wav = encodeWAV(mix);
        this.mixAudio.src = URL.createObjectURL(wav);
        this.mixAudio.style.display = "block";
        this.mixStatus.textContent = `Rendered ${mix.duration.toFixed(1)}s (${SA.fmtBytes(wav.size)}).`;
        const actions = h("div", { class: "row" },
          h("button", { class: "btn sm", onclick: () => SA.download(wav, (this.project?.title || "success-ai-mix").replace(/[^\w-]+/g, "-") + ".wav") }, "⇩ Download WAV"),
          h("button", { class: "btn sm", onclick: async () => {
            await projects.ensure("music", "Audio mix");
            this.project = projects.active;
            await assets.save({ kind: "audio", name: (this.project.title || "Mix") + " — mix", dataUrl: await SA.blobToDataUrl(wav), projectId: this.project.id, tags: ["mix"] });
            toast("Mix saved to Asset Library.", "good");
            SA.history.add({ kind: "music", title: "Rendered audio mix", projectId: this.project.id });
          } }, "Save to library")
        );
        this.mixActions.replaceChildren(actions);
      } catch (e) {
        this.mixStatus.textContent = e.message;
      }
    },

    /* ================= lifecycle ================= */
    async load(p) {
      this.project = p;
      const d = p?.data || {};
      this.genre.value = d.genre || "Pop";
      this.mood.value = d.mood || "Uplifting";
      this.tempo.value = d.tempo || 100;
      this.lang.value = d.language || "English";
      this.concept.value = d.brief || d.seed || "";
      this.lyrics.value = d.lyrics || "";
      this.notes.value = d.notes || "";
      if (!this.sPrompt.value || p) this.sPrompt.value = d.songPrompt || d.brief || d.seed || "";
      this.renderSongs();
    },
    show(opts = {}) {
      if (opts.addAudioAsset) {
        assets.get(opts.addAudioAsset).then(({ dataUrl, asset }) => {
          this.addClipFromDataUrl(dataUrl, asset.name || "Library audio");
          this.selectTab("edit");
        }).catch(e => toast(e.message, "bad"));
      }
    },
    context(p) {
      const d = p.data || {};
      return `Music project. Genre ${d.genre || "?"}, mood ${d.mood || "?"}, ${d.tempo || "?"} BPM, language ${d.language || "?"}.\nConcept: ${d.brief || ""}\nLyrics:\n${(d.lyrics || "").slice(0, 3000)}\nNotes: ${(d.notes || "").slice(0, 800)}`;
    }
  });
})();
