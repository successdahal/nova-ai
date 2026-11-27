/* Success AI — Image Studio */
(() => {
  "use strict";
  const { h, $, studio, store, projects, toast, assets } = SA;

  const STYLES = {
    "": "No preset",
    photo: "photorealistic photograph, natural light, high detail, 50mm lens",
    cinematic: "cinematic film still, dramatic lighting, anamorphic, color graded",
    illustration: "detailed digital illustration, clean lines, vibrant colors",
    anime: "anime style key visual, cel shading, expressive",
    watercolor: "soft watercolor painting, paper texture, gentle washes",
    "3d": "3D render, octane, soft global illumination, studio lighting",
    product: "professional studio product photography, seamless background, softbox lighting",
    logo: "minimal flat vector logo design, simple shapes, centered, plain background"
  };
  const PRESETS = [
    ["Remove background", "Remove the background completely and place the subject on a clean pure white background. Keep the subject exactly the same."],
    ["Replace background…", null, "Describe the new background"],
    ["Remove object…", null, "What should be removed?"],
    ["Replace object…", null, "What should be replaced, and with what?"],
    ["Enhance quality", "Enhance this image: sharpen details, improve lighting and color balance, reduce noise. Do not change the content or composition."],
    ["Restore old photo", "Restore this old photograph: remove scratches, dust and fading, repair damage, gently colorize if black and white. Keep faces identical."],
    ["Change style…", null, "Which style? (e.g. oil painting, anime, pencil sketch)"]
  ];

  studio({
    id: "image",
    title: "Image Studio",
    kicker: "CREATE · EDIT · EXPORT",
    projectType: "image",
    project: null,
    versions: [], // {src, label, assetId, parent}
    index: -1,
    zoom: 1,
    pan: { x: 0, y: 0 },

    mount(el) {
      // ---------- controls ----------
      this.prompt = h("textarea", { class: "textarea", maxlength: 1800, placeholder: "Describe the image you want…\nExample: A cinematic photograph of a quiet Himalayan village at sunrise" });
      this.style = h("select", { class: "select" }, ...Object.entries(STYLES).map(([k, v]) => h("option", { value: k }, k ? k[0].toUpperCase() + k.slice(1) : v)));
      this.aspect = h("select", { class: "select" }, ...[["1:1", "Square 1:1"], ["16:9", "Landscape 16:9"], ["9:16", "Portrait 9:16"], ["4:3", "Landscape 4:3"], ["3:4", "Portrait 3:4"]].map(([v, l]) => h("option", { value: v }, l)));
      this.count = h("select", { class: "select" }, ...[1, 2, 3, 4].map(n => h("option", { value: n }, n + (n === 1 ? " image" : " variations"))));
      this.negative = h("input", { class: "input", placeholder: "e.g. text, watermark, blurry" });
      this.resolution = h("select", { class: "select" }, h("option", { value: "1K" }, "1K"));
      this.engineSel = SA.engineSelect("image", { onChange: e => {
        if (!e || !this.resolution) return;
        const cur = this.resolution.value;
        this.resolution.replaceChildren(...(e.resolutions || ["1K"]).map(r => h("option", { value: r }, r === "1K" ? "1K (standard)" : r === "2K" ? "2K (sharp)" : r === "4K" ? "4K (print)" : r)));
        if ((e.resolutions || []).includes(cur)) this.resolution.value = cur;
      } });
      this.character = h("select", { class: "select" });
      this.genBtn = h("button", { class: "btn primary", onclick: () => this.generate() }, "Generate");
      this.status = h("div", { class: "status-line" });
      this.progress = h("div", { class: "progress indeterminate", hidden: true }, h("i"));

      this.editPrompt = h("textarea", { class: "textarea", maxlength: 1800, placeholder: "Describe the change… e.g. make it night time with glowing lanterns" });
      this.preserve = h("input", { type: "checkbox", checked: true });
      this.editBtn = h("button", { class: "btn primary", onclick: () => this.edit(this.editPrompt.value) }, "Apply AI edit");

      const generatePanel = h("div", { class: "stack" },
        h("div", {}, h("label", { class: "lbl" }, "Prompt"), this.prompt,
          h("div", { class: "row", style: { marginTop: "6px" } }, h("button", { class: "btn sm", onclick: () => this.enhance() }, "✨ Enhance prompt"), h("span", { class: "small faint" }, "Ctrl/⌘+Enter to generate"))),
        h("div", { class: "grid g2" }, h("div", {}, h("label", { class: "lbl" }, "Engine"), this.engineSel), h("div", {}, h("label", { class: "lbl" }, "Resolution"), this.resolution)),
        h("div", { class: "grid g2" }, h("div", {}, h("label", { class: "lbl" }, "Style"), this.style), h("div", {}, h("label", { class: "lbl" }, "Aspect ratio"), this.aspect)),
        h("div", { class: "grid g2" }, h("div", {}, h("label", { class: "lbl" }, "Variations"), this.count), h("div", {}, h("label", { class: "lbl" }, "Character"), this.character)),
        h("div", {}, h("label", { class: "lbl" }, "Avoid (negative prompt)"), this.negative, h("div", { class: "small faint" }, "Added to the prompt as an instruction to avoid these things.")),
        h("div", { class: "row" }, this.genBtn, h("button", { class: "btn", onclick: () => this.upload() }, "⇧ Upload image"))
      );
      const editPanel = h("div", { class: "stack" },
        h("div", { class: "small muted" }, "AI edits apply to the image on the canvas. Your original is always kept as the first version."),
        h("div", {}, h("label", { class: "lbl" }, "Edit instruction"), this.editPrompt),
        h("label", { class: "row small muted" }, this.preserve, "Preserve people's faces and identity"),
        this.editBtn,
        h("label", { class: "lbl" }, "Quick edits"),
        h("div", { class: "row" }, ...PRESETS.map(([label, instruction, ask]) => h("button", { class: "btn sm", onclick: async () => {
          let text = instruction;
          if (!text) {
            const v = await SA.prompt(label.replace("…", ""), { label: ask });
            if (!v) return;
            text = label.startsWith("Replace background") ? `Replace the background with: ${v}. Keep the subject exactly the same.` : label.startsWith("Remove object") ? `Remove ${v} from the image and fill the area naturally so it looks untouched.` : label.startsWith("Replace object") ? `Replace ${v}. Keep everything else the same.` : `Redraw this image in the style of ${v}, keeping the same composition and subject.`;
          }
          this.edit(text);
        } }, label))),
        h("button", { class: "btn", onclick: () => this.outpaint() }, "⤢ Expand canvas (outpaint 25%)"),
        h("div", { class: "small faint" }, "Edits use the engine chosen on the Generate tab. Describe the area you want changed in words.")
      );
      // Local adjustments (done in your browser, no AI)
      this.bright = h("input", { type: "range", min: 50, max: 150, value: 100 });
      this.contrast = h("input", { type: "range", min: 50, max: 150, value: 100 });
      this.saturate = h("input", { type: "range", min: 0, max: 200, value: 100 });
      this.resizeTo = h("input", { class: "input", type: "number", min: 64, max: 4096, placeholder: "Longest side in px (e.g. 1080)" });
      const preview = () => {
        if (this.imgAfter) this.imgAfter.style.filter = `brightness(${this.bright.value}%) contrast(${this.contrast.value}%) saturate(${this.saturate.value}%)`;
      };
      [this.bright, this.contrast, this.saturate].forEach(r => r.addEventListener("input", preview));
      const adjustPanel = h("div", { class: "stack" },
        h("div", { class: "small muted" }, "Adjustments run in your browser and create a new version."),
        h("label", { class: "lbl" }, "Crop (centered)"),
        h("div", { class: "row" }, ...["1:1", "4:3", "3:4", "16:9", "9:16"].map(r => h("button", { class: "btn sm", onclick: () => this.transform({ crop: r }) }, r))),
        h("label", { class: "lbl" }, "Rotate & flip"),
        h("div", { class: "row" },
          h("button", { class: "btn sm", onclick: () => this.transform({ rotate: -90 }) }, "⟲ 90°"),
          h("button", { class: "btn sm", onclick: () => this.transform({ rotate: 90 }) }, "⟳ 90°"),
          h("button", { class: "btn sm", onclick: () => this.transform({ flipX: true }) }, "⇋ Flip H"),
          h("button", { class: "btn sm", onclick: () => this.transform({ flipY: true }) }, "⇵ Flip V")),
        h("label", { class: "lbl" }, "Resize"),
        h("div", { class: "row nowrap" }, this.resizeTo, h("button", { class: "btn sm", onclick: () => this.transform({ resize: Number(this.resizeTo.value) }) }, "Apply")),
        h("label", { class: "lbl" }, "Brightness"), this.bright,
        h("label", { class: "lbl" }, "Contrast"), this.contrast,
        h("label", { class: "lbl" }, "Saturation"), this.saturate,
        h("div", { class: "row" },
          h("button", { class: "btn primary", onclick: () => this.transform({ filter: true }) }, "Apply adjustments"),
          h("button", { class: "btn ghost", onclick: () => { this.bright.value = this.contrast.value = 100; this.saturate.value = 100; preview(); } }, "Reset"))
      );

      const tabs = h("div", { class: "tabs" });
      const panels = { Generate: generatePanel, "AI Edit": editPanel, Adjust: adjustPanel };
      const selectTab = name => {
        tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.textContent === name));
        Object.entries(panels).forEach(([k, p]) => (p.hidden = k !== name));
      };
      Object.keys(panels).forEach(name => tabs.append(h("button", { class: "tab", onclick: () => selectTab(name) }, name)));
      this.selectTab = selectTab;
      selectTab("Generate");

      // ---------- canvas ----------
      this.stage = h("div", { class: "canvas-stage" });
      this.wrap = h("div", { class: "canvas-wrap" }, this.stage, h("div", { class: "canvas-hint" }, "Scroll to zoom · drag to pan"));
      this.compareRange = h("input", { type: "range", min: 0, max: 100, value: 50, hidden: true, oninput: () => this.updateCompare() });
      this.compareBtn = h("button", { class: "btn sm", onclick: () => this.toggleCompare() }, "Before / after");
      this.undoBtn = h("button", { class: "btn sm", title: "Undo (Ctrl+Z)", onclick: () => this.step(-1) }, "↶ Undo");
      this.redoBtn = h("button", { class: "btn sm", title: "Redo (Ctrl+Y)", onclick: () => this.step(1) }, "↷ Redo");
      this.format = h("select", { class: "select", style: { width: "auto" } }, h("option", { value: "png" }, "PNG"), h("option", { value: "jpeg" }, "JPG"), h("option", { value: "webp" }, "WebP"));
      this.versionLabel = h("span", { class: "small muted grow", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" } });
      this.strip = h("div", { class: "strip" });
      this.gallery = h("div", { class: "strip" });

      el.append(
        h("div", { class: "split" },
          h("div", { class: "card" }, tabs, generatePanel, editPanel, adjustPanel, h("div", { style: { marginTop: "12px" } }, this.progress, this.status)),
          h("div", { class: "stack" },
            h("div", { class: "row" },
              this.undoBtn, this.redoBtn, this.compareBtn,
              h("button", { class: "btn sm", onclick: () => this.setZoom(this.zoom * 1.25) }, "＋"),
              h("button", { class: "btn sm", onclick: () => this.setZoom(this.zoom / 1.25) }, "－"),
              h("button", { class: "btn sm", onclick: () => this.fit() }, "Fit"),
              this.versionLabel,
              this.format,
              h("button", { class: "btn sm", onclick: () => this.exportImage() }, "⇩ Download"),
              h("button", { class: "btn sm primary", onclick: () => this.saveCurrent() }, "Save to library")
            ),
            this.wrap,
            this.compareRange,
            h("div", { class: "small muted" }, "Versions in this session"), this.strip,
            h("div", { class: "row" }, h("span", { class: "small muted grow" }, "Saved in this project"), h("button", { class: "btn sm ghost", onclick: () => this.useAsCharacter() }, "☺ Use as character reference")), this.gallery
          )
        )
      );

      this.prompt.addEventListener("keydown", e => e.key === "Enter" && (e.ctrlKey || e.metaKey) && this.generate());
      const autosave = SA.debounce(() => this.project && projects.patch(this.project.id, { engine: this.engineSel.value, prompt: this.prompt.value, style: this.style.value, aspect: this.aspect.value, negative: this.negative.value }), 800);
      [this.prompt, this.negative].forEach(i => i.addEventListener("input", autosave));
      [this.style, this.aspect, this.engineSel].forEach(i => i.addEventListener("change", autosave));
      this.bindViewer();
      this.renderCanvas();
      SA.on("change:characters", () => this.fillCharacters());
    },

    async show(opts = {}) {
      await this.fillCharacters();
      if (opts.editAsset) {
        const { dataUrl, asset } = await assets.get(opts.editAsset);
        this.versions = [];
        this.pushVersion({ src: dataUrl, label: "Original: " + (asset.name || "asset"), assetId: asset.id });
        this.selectTab("AI Edit");
      }
      if (opts.character) this.character.value = opts.character;
    },

    async load(p) {
      this.project = p;
      this.versions = [];
      this.index = -1;
      const d = p?.data || {};
      this.prompt.value = d.prompt || d.seed || "";
      this.style.value = d.style || "";
      if (d.engine && SA.engine("image", d.engine)?.status === "ready") this.engineSel.value = d.engine;
      this.aspect.value = d.aspect || "1:1";
      this.negative.value = d.negative || "";
      this.renderCanvas();
      await this.renderGallery();
      const last = (d.gallery || []).at(-1);
      if (last) {
        try {
          const { dataUrl } = await assets.get(last.assetId);
          this.pushVersion({ src: dataUrl, label: "Last saved", assetId: last.assetId }, false);
        } catch {
          /* asset may have been deleted */
        }
      }
    },

    context(p) {
      const d = p.data || {};
      const g = (d.gallery || []).slice(-6).map(x => `- ${x.kind}: ${x.prompt}`).join("\n");
      return `Image project. Current prompt: ${d.prompt || "(none)"}. Style: ${d.style || "none"}. Aspect: ${d.aspect || "1:1"}.\nRecent images:\n${g || "(none yet)"}`;
    },

    async fillCharacters() {
      const list = await store.list("characters");
      const cur = this.character.value;
      this.character.replaceChildren(h("option", { value: "" }, "None"), ...list.map(c => h("option", { value: c.id }, c.title)));
      this.character.value = list.some(c => c.id === cur) ? cur : "";
    },

    /* ---------- state helpers ---------- */
    busy(on, message = "") {
      this.genBtn.disabled = this.editBtn.disabled = on;
      this.progress.hidden = !on;
      this.status.className = "status-line";
      this.status.textContent = message;
    },
    fail(e) {
      this.busy(false);
      this.status.className = "status-line bad";
      this.status.textContent = e.message || String(e);
    },
    current() {
      return this.versions[this.index] || null;
    },
    pushVersion(v, select = true) {
      this.versions = this.versions.slice(0, select ? this.index + 1 : this.versions.length).concat(v);
      if (select || this.index < 0) this.index = this.versions.length - 1;
      this.renderCanvas();
      this.renderStrip();
    },
    step(d) {
      const n = this.index + d;
      if (n < 0 || n >= this.versions.length) return;
      this.index = n;
      this.renderCanvas();
      this.renderStrip();
    },

    /* ---------- AI ---------- */
    async enhance() {
      const text = this.prompt.value.trim();
      if (!text) return this.prompt.focus();
      this.busy(true, "Improving your prompt…");
      try {
        this.prompt.value = (await SA.ai("prompt", "Improve this image prompt: " + text, { maxTokens: 400 })).trim().replace(/^["']|["']$/g, "");
        this.busy(false, "Prompt enhanced — edit it or generate.");
      } catch (e) {
        this.fail(e);
      }
    },

    async characterPayload() {
      if (!this.character.value) return { text: "", refs: [] };
      const c = await store.get("characters", this.character.value);
      if (!c) return { text: "", refs: [] };
      const d = c.data || {};
      const text = `Character "${c.title}": ${[d.description, d.appearance, d.clothing].filter(Boolean).join(". ")}`;
      const refs = [];
      for (const id of (d.referenceAssetIds || []).slice(0, 2)) {
        try {
          const { dataUrl } = await assets.get(id);
          if (dataUrl?.startsWith("data:image/")) refs.push(await SA.encodeImage(dataUrl, { maxSide: 1024, type: "image/jpeg", quality: 0.9 }));
        } catch {
          /* missing reference */
        }
      }
      return { text, refs };
    },

    async generate() {
      const base = this.prompt.value.trim();
      if (!base) {
        this.status.textContent = "Write a prompt first.";
        return this.prompt.focus();
      }
      const n = Number(this.count.value);
      this.busy(true, "Preparing…");
      try {
        const p = await projects.ensure("image", base);
        this.project = p;
        const ch = await this.characterPayload();
        const prompt = [ch.text, base, STYLES[this.style.value]].filter(Boolean).join("\n\n").slice(0, 1800);
        for (let i = 0; i < n; i++) {
          this.status.textContent = `Generating image ${i + 1} of ${n}… (usually 5–20 seconds)`;
          const res = await SA.api("image_generate", { engine: this.engineSel.value, prompt: prompt + (n > 1 ? `\n\n(Variation ${i + 1})` : ""), aspectRatio: this.aspect.value, resolution: this.resolution.value, negativePrompt: this.negative.value, images: ch.refs }, { timeout: 360000 });
          const assetId = await this.persistResult(res.imageData, base, "generate");
          this.pushVersion({ src: res.imageData, label: "Generated " + (i + 1), assetId });
        }
        this.busy(false, n > 1 ? `Done — ${n} variations saved to this project and your Asset Library.` : "Done — saved to this project and your Asset Library.");
        SA.history.add({ kind: "image", title: "Generated image: " + base.slice(0, 80), projectId: this.project.id });
        if (SA.engine("image", this.engineSel.value)?.tier === "premium") SA.refreshCredits();
      } catch (e) {
        this.fail(e);
      }
    },

    async edit(instruction) {
      const cur = this.current();
      instruction = String(instruction || "").trim();
      if (!cur) return this.fail(new Error("Generate or upload an image first."));
      if (!instruction) return this.editPrompt.focus();
      this.busy(true, "Editing your image… (usually 10–30 seconds)");
      try {
        const p = await projects.ensure("image", "Edit: " + instruction);
        this.project = p;
        const ch = await this.characterPayload();
        const src = await SA.encodeImage(cur.src, { maxSide: 1536, type: "image/jpeg", quality: 0.92 });
        const res = await SA.api("image_generate", { engine: this.engineSel.value, mode: "edit", prompt: [instruction, ch.text].filter(Boolean).join("\n"), images: [src, ...ch.refs.slice(0, 1)], aspectRatio: this.aspect.value, resolution: this.resolution.value, preserveIdentity: this.preserve.checked }, { timeout: 360000 });
        const assetId = await this.persistResult(res.imageData, instruction, "edit", cur.assetId);
        this.pushVersion({ src: res.imageData, label: "Edit: " + instruction.slice(0, 30), assetId, parent: this.index });
        this.busy(false, "Edit applied. Use Before / after to compare, or Undo to go back.");
        SA.history.add({ kind: "image", title: "Edited image: " + instruction.slice(0, 80), projectId: this.project.id });
      } catch (e) {
        this.fail(e);
      }
    },

    async outpaint() {
      const cur = this.current();
      if (!cur) return this.fail(new Error("Generate or upload an image first."));
      const img = await SA.loadImage(cur.src);
      const pad = 0.25;
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * (1 + pad));
      c.height = Math.round(img.naturalHeight * (1 + pad));
      const ctx = c.getContext("2d");
      ctx.filter = "blur(24px)";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      ctx.filter = "none";
      ctx.drawImage(img, (c.width - img.naturalWidth) / 2, (c.height - img.naturalHeight) / 2);
      this.pushVersion({ src: c.toDataURL("image/jpeg", 0.92), label: "Expanded canvas", parent: this.index });
      await this.edit("The outer blurry border is empty canvas. Extend the scene naturally into the borders so the whole image is sharp and seamless. Keep the sharp center exactly as it is.");
    },

    async transform(op) {
      const cur = this.current();
      if (!cur) return this.fail(new Error("Generate or upload an image first."));
      const img = await SA.loadImage(cur.src);
      let w = img.naturalWidth,
        hgt = img.naturalHeight,
        sx = 0,
        sy = 0,
        sw = w,
        sh = hgt;
      if (op.crop) {
        const [a, b] = op.crop.split(":").map(Number);
        const target = a / b;
        if (w / hgt > target) {
          sw = Math.round(hgt * target);
          sx = Math.round((w - sw) / 2);
        } else {
          sh = Math.round(w / target);
          sy = Math.round((hgt - sh) / 2);
        }
        w = sw;
        hgt = sh;
      }
      if (op.resize) {
        if (op.resize < 64 || op.resize > 4096) return this.fail(new Error("Resize must be between 64 and 4096 px."));
        const s = op.resize / Math.max(w, hgt);
        w = Math.round(w * s);
        hgt = Math.round(hgt * s);
      }
      const rot = op.rotate || 0;
      const c = document.createElement("canvas");
      c.width = Math.abs(rot) === 90 ? hgt : w;
      c.height = Math.abs(rot) === 90 ? w : hgt;
      const ctx = c.getContext("2d");
      if (op.filter) ctx.filter = `brightness(${this.bright.value}%) contrast(${this.contrast.value}%) saturate(${this.saturate.value}%)`;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(op.flipX ? -1 : 1, op.flipY ? -1 : 1);
      ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -hgt / 2, w, hgt);
      const label = op.crop ? "Crop " + op.crop : op.resize ? "Resize " + w + "×" + hgt : op.rotate ? "Rotate" : op.filter ? "Adjusted" : "Flip";
      if (op.filter) {
        this.bright.value = this.contrast.value = 100;
        this.saturate.value = 100;
      }
      this.pushVersion({ src: c.toDataURL("image/png"), label, parent: this.index });
      this.status.className = "status-line";
      this.status.textContent = label + " applied. Press “Save to library” to keep this version.";
    },

    async upload() {
      const f = await SA.pickFile("image/png,image/jpeg,image/webp");
      if (!f) return;
      if (f.size > 25 * 1024 * 1024) return this.fail(new Error("Choose an image smaller than 25 MB."));
      const src = await SA.encodeImage(URL.createObjectURL(f), { maxSide: 2048, type: f.type === "image/png" ? "image/png" : "image/jpeg", quality: 0.94 });
      await projects.ensure("image", "Edit " + f.name);
      this.project = projects.active;
      this.versions = [];
      this.index = -1;
      const assetId = await this.persistResult(src, "Uploaded " + f.name, "upload");
      this.pushVersion({ src, label: "Original upload", assetId });
      this.selectTab("AI Edit");
      this.status.textContent = "Original saved. Describe an edit or use a quick edit.";
    },

    /** Save an image as a library asset and record it in the project gallery. */
    async persistResult(dataUrl, prompt, kind, parentAssetId = null) {
      try {
        const compact = await SA.encodeImage(dataUrl, { maxSide: 1536, type: "image/webp", quality: 0.88 });
        const asset = await assets.save({ kind: "image", name: (prompt || "Image").slice(0, 60), dataUrl: compact, projectId: this.project?.id, tags: ["image-studio", kind] });
        if (this.project) {
          const fresh = await store.get("projects", this.project.id);
          const gallery = [...(fresh?.data?.gallery || []), { assetId: asset.id, prompt: String(prompt).slice(0, 300), kind, parentAssetId, at: Date.now() }].slice(-200);
          this.project = await projects.patch(this.project.id, { gallery });
          this.renderGallery();
        }
        return asset.id;
      } catch (e) {
        toast("Image created but not saved to the library: " + e.message, "bad");
        return null;
      }
    },

    async saveCurrent() {
      const cur = this.current();
      if (!cur) return toast("Nothing to save yet.");
      if (cur.assetId) return toast("This version is already in your library.");
      await projects.ensure("image", cur.label);
      this.project = projects.active;
      cur.assetId = await this.persistResult(cur.src, cur.label, "adjust");
      if (cur.assetId) toast("Saved to your Asset Library.", "good");
      this.renderStrip();
    },

    async exportImage() {
      const cur = this.current();
      if (!cur) return toast("Nothing to download yet.");
      const fmt = this.format.value;
      const img = await SA.loadImage(cur.src);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (fmt === "jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(img, 0, 0);
      c.toBlob(blob => {
        if (!blob) return toast("Your browser can't export this format. Try PNG.", "bad");
        SA.download(blob, "success-ai-image." + (fmt === "jpeg" ? "jpg" : fmt));
      }, "image/" + fmt, 0.95);
    },

    async useAsCharacter() {
      const cur = this.current();
      if (!cur) return toast("Generate or upload an image first.");
      if (!cur.assetId) await this.saveCurrent();
      if (cur.assetId) SA.library.editCharacter(null, { referenceAssetIds: [cur.assetId], description: this.prompt.value.slice(0, 400) });
    },

    /* ---------- rendering ---------- */
    renderCanvas() {
      const cur = this.current();
      this.stage.replaceChildren();
      this.imgAfter = null;
      if (!cur) {
        this.stage.append(h("div", { class: "empty", style: { background: "var(--panel)" } }, "Your image appears here.", h("br"), h("small", {}, "Generate from a prompt, or upload an image to edit.")));
      } else {
        this.imgAfter = h("img", { src: cur.src, alt: cur.label, draggable: "false" });
        this.imgAfter.onload = () => this.fit();
        this.stage.append(this.imgAfter);
        const parent = this.versions[cur.parent ?? this.index - 1];
        if (this.comparing && parent) {
          const before = h("img", { src: parent.src, alt: "Before", draggable: "false" });
          this.compareTop = h("div", { class: "compare-top" }, before);
          this.stage.append(this.compareTop);
          this.imgAfter.addEventListener("load", () => {
            before.style.width = this.imgAfter.naturalWidth + "px";
            before.style.height = this.imgAfter.naturalHeight + "px";
            before.style.objectFit = "fill";
            this.updateCompare();
          });
        }
      }
      this.undoBtn.disabled = this.index <= 0;
      this.redoBtn.disabled = this.index >= this.versions.length - 1;
      this.versionLabel.textContent = cur ? `${cur.label} · version ${this.index + 1}/${this.versions.length}${cur.assetId ? "" : " · not saved"}` : "";
    },
    toggleCompare() {
      if (!this.current() || this.index < 1) return toast("Make an edit first, then compare it with the previous version.");
      this.comparing = !this.comparing;
      this.compareRange.hidden = !this.comparing;
      this.compareBtn.classList.toggle("active", this.comparing);
      this.renderCanvas();
    },
    updateCompare() {
      if (this.compareTop) this.compareTop.style.width = this.compareRange.value + "%";
    },
    renderStrip() {
      this.strip.replaceChildren(...this.versions.map((v, i) => h("button", { class: "thumb" + (i === this.index ? " active" : ""), title: v.label, onclick: () => { this.index = i; this.renderCanvas(); this.renderStrip(); } }, h("img", { src: v.src, alt: v.label }))));
    },
    async renderGallery() {
      const g = (this.project?.data?.gallery || []).slice().reverse().slice(0, 30);
      this.gallery.replaceChildren(...(g.length ? [] : [h("div", { class: "small faint" }, "Nothing saved in this project yet.")]));
      for (const item of g) {
        const btn = h("button", { class: "thumb", title: item.prompt, onclick: async () => {
          try {
            const { dataUrl } = await assets.get(item.assetId);
            this.pushVersion({ src: dataUrl, label: item.prompt.slice(0, 30), assetId: item.assetId });
          } catch (e) {
            toast("That image is no longer available: " + e.message, "bad");
          }
        } }, "…");
        this.gallery.append(btn);
        assets.get(item.assetId).then(({ dataUrl }) => btn.replaceChildren(h("img", { src: dataUrl, alt: item.prompt, loading: "lazy" }))).catch(() => (btn.textContent = "✕"));
      }
    },

    /* ---------- zoom & pan ---------- */
    applyTransform() {
      this.stage.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    },
    setZoom(z) {
      this.zoom = Math.max(0.05, Math.min(8, z));
      this.applyTransform();
    },
    fit() {
      const img = this.imgAfter;
      if (!img || !img.naturalWidth) return;
      const r = this.wrap.getBoundingClientRect();
      this.zoom = Math.min((r.width - 24) / img.naturalWidth, (r.height - 24) / img.naturalHeight, 1);
      this.pan = { x: 0, y: 0 };
      this.applyTransform();
    },
    bindViewer() {
      this.wrap.addEventListener("wheel", e => {
        if (!this.imgAfter) return;
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      }, { passive: false });
      let drag = null;
      this.wrap.addEventListener("pointerdown", e => {
        if (!this.imgAfter || e.target.closest("button")) return;
        drag = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
        this.wrap.setPointerCapture(e.pointerId);
        this.wrap.classList.add("dragging");
      });
      this.wrap.addEventListener("pointermove", e => {
        if (!drag) return;
        this.pan = { x: e.clientX - drag.x, y: e.clientY - drag.y };
        this.applyTransform();
      });
      const end = () => {
        drag = null;
        this.wrap.classList.remove("dragging");
      };
      this.wrap.addEventListener("pointerup", end);
      this.wrap.addEventListener("pointercancel", end);
    },
    onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return false;
      if (e.key.toLowerCase() === "z") return this.step(e.shiftKey ? 1 : -1), true;
      if (e.key.toLowerCase() === "y") return this.step(1), true;
      if (e.key.toLowerCase() === "s") return this.saveCurrent(), true;
      return false;
    }
  });
})();
