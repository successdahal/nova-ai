/* Success AI — Character Library & Asset Library */
(() => {
  "use strict";
  const { h, $, studio, store, projects, toast, assets, uid, fmtDate, fmtBytes, TYPES } = SA;
  const KIND_ICON = { image: "▧", video: "▶", audio: "♫", document: "▤", code: "⟨⟩", other: "◇" };

  /* ---------------------------------------------------------------- */
  /* Asset tiles & preview                                             */
  /* ---------------------------------------------------------------- */
  function lazyThumb(a) {
    const box = h("div", { class: "thumb" }, KIND_ICON[a.kind] || "◇");
    if (a.kind === "image") {
      assets.get(a.id).then(({ dataUrl }) => dataUrl && box.replaceChildren(h("img", { src: dataUrl, alt: a.name, loading: "lazy" }))).catch(() => {});
    } else if (a.kind === "video" && a.url) {
      box.replaceChildren(h("video", { src: a.url, muted: true, preload: "metadata", playsinline: true }));
    }
    return box;
  }

  function assetTile(a, { compact = false, onChange, pick } = {}) {
    const loc = a.location === "cloud" ? h("span", { class: "badge good" }, "cloud") : h("span", { class: "badge" + (a.location === "device" ? " warn" : "") }, a.location === "device" ? "this device" : "local");
    const card = h("div", { class: "item-card" },
      h("button", { class: "btn ghost", style: { padding: 0, border: 0 }, onclick: () => (pick ? pick(a) : previewAsset(a)) }, lazyThumb(a)),
      h("div", { class: "title", title: a.name }, (a.favorite ? "★ " : "") + a.name),
      compact ? "" : h("div", { class: "meta row" }, h("span", { class: "badge" }, a.kind), loc, a.folder ? h("span", { class: "badge" }, "📁 " + a.folder) : "", h("span", {}, fmtBytes(a.size)), h("span", {}, fmtDate(a.updatedAt || a.createdAt))),
      compact || pick ? "" : h("div", { class: "actions" },
        h("button", { class: "btn sm", onclick: () => previewAsset(a) }, "Open"),
        h("button", { class: "btn sm", onclick: () => downloadAsset(a) }, "⇩"),
        h("button", { class: "btn sm", onclick: async () => { await assets.update(a.id, { favorite: !a.favorite }); onChange?.(); } }, a.favorite ? "★" : "☆"),
        h("button", { class: "btn sm", onclick: () => assetMenu(a, onChange) }, "More…"))
    );
    return card;
  }

  async function downloadAsset(a) {
    try {
      const { dataUrl } = await assets.get(a.id);
      if (!dataUrl) return toast("No file data.", "bad");
      if (dataUrl.startsWith("data:")) {
        const ext = (dataUrl.match(/^data:[^/]+\/([\w.+-]+)/) || [])[1]?.replace("jpeg", "jpg").replace("mpeg", "mp3").replace("svg+xml", "svg") || "bin";
        SA.download(dataUrl, a.name.replace(/[^\w-]+/g, "-") + "." + ext);
      } else window.open(dataUrl, "_blank", "noopener");
    } catch (e) {
      toast(e.message, "bad");
    }
  }

  async function previewAsset(a) {
    const body = h("div", { class: "stack" }, h("div", { class: "row" }, h("span", { class: "spinner" }), "Loading…"));
    const m = SA.modal({ title: a.name, wide: true, body, actions: [{ label: "Download", onClick: () => (downloadAsset(a), false) }, { label: "Close", kind: "primary", value: null }] });
    try {
      const { dataUrl } = await assets.get(a.id);
      body.replaceChildren();
      if (a.kind === "image") body.append(h("img", { src: dataUrl, alt: a.name, style: { maxHeight: "65vh", objectFit: "contain", borderRadius: "10px" } }));
      else if (a.kind === "video") body.append(h("video", { src: dataUrl, controls: true, style: { maxHeight: "65vh", width: "100%" } }));
      else if (a.kind === "audio") body.append(h("audio", { src: dataUrl, controls: true, style: { width: "100%" } }));
      else if (dataUrl?.startsWith("data:text") || /json|javascript|xml/.test(a.mime || "")) body.append(h("pre", { class: "console", style: { maxHeight: "60vh" } }, new TextDecoder().decode(await SA.dataUrlToBlob(dataUrl).arrayBuffer()).slice(0, 200000)));
      else body.append(h("p", { class: "muted" }, "No preview for this file type. Use Download."));
      body.append(h("div", { class: "small muted" }, `${a.kind} · ${a.mime || ""} · ${fmtBytes(a.size)} · ${fmtDate(a.createdAt)}${a.tags?.length ? " · tags: " + a.tags.join(", ") : ""}`));
      const use = useInButtons(a);
      if (use) body.append(use);
    } catch (e) {
      body.replaceChildren(h("div", { class: "notice bad" }, e.message));
    }
    return m;
  }

  function useInButtons(a) {
    const close = () => $(".modal-back")?.remove();
    if (a.kind === "image")
      return h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => { close(); SA.go("image", { editAsset: a.id }); } }, "Edit in Image Studio"),
        h("button", { class: "btn", onclick: () => { close(); editCharacter(null, { referenceAssetIds: [a.id] }); } }, "Create character from this"));
    if (a.kind === "audio") return h("div", { class: "row" }, h("button", { class: "btn", onclick: () => { close(); SA.go("music", { addAudioAsset: a.id }); } }, "Open in audio editor"));
    return null;
  }

  async function assetMenu(a, onChange) {
    const act = (label, fn, kind = "") => h("button", { class: "btn " + kind, style: { justifyContent: "flex-start" }, onclick: async () => { $(".modal-back")?.remove(); try { await fn(); onChange?.(); } catch (e) { toast(e.message, "bad"); } } }, label);
    const list = await projects.list({ includeArchived: false });
    await SA.modal({
      title: a.name,
      body: h("div", { class: "stack" },
        act("✎ Rename", async () => { const v = await SA.prompt("Rename asset", { value: a.name }); if (v?.trim()) await assets.update(a.id, { name: v.trim() }); }),
        act("📁 Move to folder", async () => { const v = await SA.prompt("Move to folder", { label: "Folder name (empty = no folder)", value: a.folder || "" }); if (v !== null) await assets.update(a.id, { folder: v.trim() }); }),
        act("🏷 Edit tags", async () => { const v = await SA.prompt("Tags", { label: "Comma-separated", value: (a.tags || []).join(", ") }); if (v !== null) await assets.update(a.id, { tags: v.split(",").map(t => t.trim()).filter(Boolean) }); }),
        act("▣ Assign to project", async () => {
          const sel = h("select", { class: "select" }, h("option", { value: "" }, "No project"), ...list.map(p => h("option", { value: p.id }, TYPES[p.kind]?.icon + " " + p.title)));
          sel.value = a.projectId || "";
          const v = await SA.modal({ title: "Assign to project", body: sel, actions: [{ label: "Cancel", value: null }, { label: "Save", kind: "primary", onClick: () => sel.value || "none" }] });
          if (v) await assets.update(a.id, { projectId: v === "none" ? null : v });
        }),
        act("⧉ Duplicate", () => assets.duplicate(a.id)),
        act("🗑 Delete", async () => { if (await SA.confirm("Delete asset?", `"${a.name}" will be permanently deleted. Projects that use it will show it as missing.`, { danger: true, ok: "Delete" })) await assets.remove(a.id); }, "danger")
      )
    });
  }

  /** Let the user choose assets from the library. Resolves to an array of asset records. */
  async function pickAssets({ kind = "image", multiple = true } = {}) {
    const chosen = new Map();
    const grid = h("div", { class: "auto-grid" }, h("div", { class: "muted" }, "Loading…"));
    const items = await assets.list({ kind });
    grid.replaceChildren(...(items.length ? items.map(a => {
      const tile = assetTile(a, { compact: true, pick: x => {
        if (chosen.has(x.id)) chosen.delete(x.id);
        else {
          if (!multiple) chosen.clear();
          chosen.set(x.id, x);
        }
        grid.querySelectorAll(".item-card").forEach(c => (c.style.borderColor = ""));
        [...chosen.keys()].forEach(id => (grid.querySelector(`[data-id="${id}"]`).style.borderColor = "var(--accent)"));
      } });
      tile.dataset.id = a.id;
      return tile;
    }) : [h("div", { class: "empty" }, "No " + kind + " assets yet.")]));
    const ok = await SA.modal({ title: "Choose from Asset Library", wide: true, body: grid, actions: [{ label: "Cancel", value: false }, { label: "Use selected", kind: "primary", value: true }] });
    return ok ? [...chosen.values()] : [];
  }

  /* ---------------------------------------------------------------- */
  /* Characters                                                        */
  /* ---------------------------------------------------------------- */
  function characterTile(c, { compact = false, onChange } = {}) {
    const d = c.data || {};
    const thumb = h("div", { class: "thumb" }, "☺");
    const ref = (d.referenceAssetIds || [])[0];
    if (ref) assets.get(ref).then(({ dataUrl }) => thumb.replaceChildren(h("img", { src: dataUrl, alt: c.title }))).catch(() => {});
    return h("div", { class: "item-card" },
      h("button", { class: "btn ghost", style: { padding: 0, border: 0 }, onclick: () => editCharacter(c) }, thumb),
      h("div", { class: "title" }, c.title),
      compact ? "" : h("div", { class: "meta" }, (d.description || "No description").slice(0, 120)),
      compact ? "" : h("div", { class: "row" }, ...(d.tags || []).slice(0, 4).map(t => h("span", { class: "badge" }, t))),
      compact ? "" : h("div", { class: "actions" },
        h("button", { class: "btn sm primary", onclick: () => SA.go("image", { character: c.id }) }, "Use in images"),
        h("button", { class: "btn sm", onclick: () => editCharacter(c) }, "Edit"),
        h("button", { class: "btn sm", onclick: () => generateConcept(c).then(() => onChange?.()) }, "✨ Concept"),
        h("button", { class: "btn sm", onclick: async () => { await store.save("characters", { ...c, id: uid("char"), title: c.title + " (copy)", version: 0, createdAt: new Date().toISOString() }); onChange?.(); } }, "⧉"),
        h("button", { class: "btn sm danger", onclick: async () => { if (await SA.confirm("Delete character?", `"${c.title}" will be deleted. Reference images stay in your Asset Library.`, { danger: true, ok: "Delete" })) { await store.remove("characters", c.id); onChange?.(); } } }, "🗑"))
    );
  }

  async function generateConcept(c) {
    const d = c.data || {};
    const desc = [d.description, d.appearance, d.clothing].filter(Boolean).join(". ");
    if (!desc) return toast("Add a description or appearance first.", "bad");
    toast("Generating concept art for " + c.title + "…");
    try {
      const refs = [];
      for (const id of (d.referenceAssetIds || []).slice(0, 1)) {
        const { dataUrl } = await assets.get(id);
        if (dataUrl?.startsWith("data:image")) refs.push(await SA.encodeImage(dataUrl, { maxSide: 1024, type: "image/jpeg" }));
      }
      const res = await SA.api("generate_image", { prompt: `Character concept art, full body, neutral background, character sheet style. ${c.title}: ${desc}`.slice(0, 1800), aspectRatio: "3:4", referenceImages: refs }, { timeout: 150000 });
      const compact = await SA.encodeImage(res.imageData, { maxSide: 1280, type: "image/webp", quality: 0.88 });
      const asset = await assets.save({ kind: "image", name: c.title + " — concept", dataUrl: compact, tags: ["character", c.title] });
      const fresh = await store.get("characters", c.id);
      const fd = fresh.data || {};
      const refsNow = fd.referenceAssetIds || [];
      await store.save("characters", { id: c.id, data: { ...fd, referenceAssetIds: refsNow.length < 3 ? [...refsNow, asset.id] : refsNow, variations: [...(fd.variations || []), asset.id].slice(-30) } });
      toast("Concept art saved to " + c.title + ".", "good");
      SA.history.add({ kind: "image", title: "Character concept: " + c.title });
    } catch (e) {
      toast("Concept failed: " + e.message, "bad");
    }
  }

  async function editCharacter(c, preset = {}) {
    const d = { ...(c?.data || {}), ...preset };
    const name = h("input", { class: "input", value: c?.title || "", placeholder: "Character name" });
    const desc = h("textarea", { class: "textarea", placeholder: "Who they are: role, age range, personality, backstory" }, d.description || "");
    const appearance = h("textarea", { class: "textarea", style: { minHeight: "70px" }, placeholder: "Face, hair, eyes, skin tone, build, distinguishing features" }, d.appearance || "");
    const clothing = h("input", { class: "input", value: d.clothing || "", placeholder: "Signature outfit / clothing references" });
    const tags = h("input", { class: "input", value: (d.tags || []).join(", "), placeholder: "Tags, comma-separated" });
    let refIds = [...(d.referenceAssetIds || [])];
    const refsBox = h("div", { class: "row" });
    const drawRefs = () => {
      refsBox.replaceChildren(
        ...refIds.map(id => {
          const t = h("div", { class: "thumb", style: { width: "90px", position: "relative" } }, "…");
          assets.get(id).then(({ dataUrl }) => t.replaceChildren(h("img", { src: dataUrl, alt: "Reference" }), h("button", { class: "btn sm", style: { position: "absolute", top: "4px", right: "4px", padding: "0 6px" }, onclick: () => { refIds = refIds.filter(x => x !== id); drawRefs(); } }, "×"))).catch(() => (t.textContent = "missing"));
          return t;
        }),
        refIds.length < 3 ? h("button", { class: "btn sm", onclick: async () => {
          const f = await SA.pickFile("image/png,image/jpeg,image/webp");
          if (!f) return;
          const src = await SA.encodeImage(URL.createObjectURL(f), { maxSide: 1280, type: "image/webp", quality: 0.88 });
          const a = await assets.save({ kind: "image", name: (name.value || "Character") + " reference", dataUrl: src, tags: ["character-reference"] });
          refIds.push(a.id);
          drawRefs();
        } }, "⇧ Upload") : "",
        refIds.length < 3 ? h("button", { class: "btn sm", onclick: async () => {
          const picked = await pickAssets({ kind: "image" });
          refIds = [...new Set([...refIds, ...picked.map(p => p.id)])].slice(0, 3);
          drawRefs();
        } }, "From library") : ""
      );
    };
    drawRefs();
    const list = await projects.list({ includeArchived: false });
    const assigned = new Set(d.projectIds || []);
    const projBox = h("div", { class: "row" }, ...list.filter(p => ["image", "video"].includes(p.kind)).map(p => h("label", { class: "attach-chip" }, h("input", { type: "checkbox", checked: assigned.has(p.id), onchange: e => (e.target.checked ? assigned.add(p.id) : assigned.delete(p.id)) }), TYPES[p.kind].icon + " " + p.title)));
    const saved = await SA.modal({
      title: c ? "Edit character" : "New character",
      wide: true,
      body: h("div", { class: "grid g2" },
        h("div", { class: "stack" }, h("label", { class: "lbl" }, "Name"), name, h("label", { class: "lbl" }, "Description"), desc, h("label", { class: "lbl" }, "Appearance"), appearance, h("label", { class: "lbl" }, "Clothing"), clothing, h("label", { class: "lbl" }, "Tags"), tags),
        h("div", { class: "stack" }, h("label", { class: "lbl" }, "Reference images (up to 3) — used to keep the character consistent"), refsBox, h("div", { class: "small faint" }, "Consistency depends on the model; clear, front-facing references work best."), h("label", { class: "lbl" }, "Assigned projects"), projBox.childNodes.length ? projBox : h("div", { class: "small faint" }, "No image or video projects yet."))
      ),
      actions: [{ label: "Cancel", value: null }, { label: "Save character", kind: "primary", onClick: () => {
        if (!name.value.trim()) {
          toast("Give the character a name.", "bad");
          return false;
        }
        return true;
      } }]
    });
    if (!saved) return null;
    const rec = await store.save("characters", {
      id: c?.id || uid("char"),
      kind: "character",
      title: name.value.trim(),
      data: { ...(c?.data || {}), description: desc.value.trim(), appearance: appearance.value.trim(), clothing: clothing.value.trim(), tags: tags.value.split(",").map(t => t.trim()).filter(Boolean), referenceAssetIds: refIds, projectIds: [...assigned] }
    });
    toast("Character saved.", "good");
    return rec;
  }

  SA.library = { assetTile, characterTile, editCharacter, pickAssets, previewAsset };

  studio({
    id: "characters",
    title: "Character Library",
    kicker: "REUSABLE CHARACTERS",
    mount(el) {
      this.q = h("input", { class: "input", placeholder: "Search characters…", style: { maxWidth: "300px" }, oninput: SA.debounce(() => this.show(), 150) });
      this.grid = h("div", { class: "auto-grid" });
      el.append(h("div", { class: "row", style: { marginBottom: "16px" } }, this.q, h("div", { class: "grow" }), h("button", { class: "btn primary", onclick: async () => { await editCharacter(null); this.show(); } }, "＋ New character")), this.grid);
      SA.on("change:characters", SA.debounce(() => SA.state.view === "characters" && this.show(), 200));
    },
    async show() {
      const q = this.q.value.trim().toLowerCase();
      const items = (await store.list("characters")).filter(c => !q || (c.title + " " + JSON.stringify(c.data)).toLowerCase().includes(q));
      this.grid.replaceChildren(...(items.length ? items.map(c => characterTile(c, { onChange: () => this.show() })) : [h("div", { class: "empty" }, q ? "No characters match." : "Create characters once and reuse them across images and films — name, look, outfit and reference images.")]));
    }
  });

  studio({
    id: "assets",
    title: "Asset Library",
    kicker: "ALL YOUR FILES",
    mount(el) {
      this.q = h("input", { class: "input", placeholder: "Search name, tags, folder…", style: { maxWidth: "280px" }, oninput: SA.debounce(() => this.show(), 250) });
      this.kind = h("select", { class: "select", style: { width: "auto" }, onchange: () => this.show() }, h("option", { value: "" }, "All types"), ...Object.keys(KIND_ICON).map(k => h("option", { value: k }, k)));
      this.folder = h("select", { class: "select", style: { width: "auto" }, onchange: () => this.show() });
      this.fav = h("input", { type: "checkbox", onchange: () => this.show() });
      this.grid = h("div", { class: "auto-grid" });
      this.note = h("div");
      el.append(
        h("div", { class: "row", style: { marginBottom: "12px" } }, this.q, this.kind, this.folder, h("label", { class: "row small muted" }, this.fav, "Favorites"), h("div", { class: "grow" }), h("button", { class: "btn primary", onclick: () => this.upload() }, "⇧ Upload files")),
        this.note, this.grid
      );
      el.addEventListener("dragover", e => e.preventDefault());
      el.addEventListener("drop", e => {
        e.preventDefault();
        if (e.dataTransfer.files.length) this.upload([...e.dataTransfer.files]);
      });
      SA.on("change:assets", SA.debounce(() => SA.state.view === "assets" && this.show(), 300));
    },
    async show() {
      this.note.replaceChildren(SA.state.serverStatus?.largeFileStorage && SA.state.serverStatus.largeFileStorage !== "r2" && SA.state.user ? h("div", { class: "notice small", style: { marginBottom: "12px" } }, "Cloud storage currently holds files up to ~700 KB (no R2 bucket configured). Larger files are kept on this device and marked “this device”.") : "");
      try {
        let items = await assets.list({ kind: this.kind.value || undefined, q: this.q.value.trim() || undefined });
        const folders = [...new Set(items.map(a => a.folder).filter(Boolean))].sort();
        const cur = this.folder.value;
        this.folder.replaceChildren(h("option", { value: "" }, "All folders"), ...folders.map(f => h("option", { value: f }, "📁 " + f)));
        this.folder.value = folders.includes(cur) ? cur : "";
        if (this.folder.value) items = items.filter(a => a.folder === this.folder.value);
        if (this.fav.checked) items = items.filter(a => a.favorite);
        this.grid.replaceChildren(...(items.length ? items.map(a => assetTile(a, { onChange: () => this.show() })) : [h("div", { class: "empty" }, "No assets yet. Everything you generate is saved here automatically — or drop files onto this page.")]));
      } catch (e) {
        this.grid.replaceChildren(h("div", { class: "notice bad" }, e.message));
      }
    },
    async upload(files) {
      files = files || (await SA.pickFile("*/*", true));
      let ok = 0;
      for (const f of files || []) {
        if (f.size > 30 * 1024 * 1024) {
          toast(f.name + " is larger than 30 MB.", "bad");
          continue;
        }
        const kind = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : /\.(js|ts|py|html|css|json|java|c|cpp|go|rs)$/i.test(f.name) ? "code" : /\.(pdf|docx?|txt|md|rtf|odt)$/i.test(f.name) ? "document" : "other";
        try {
          let dataUrl = await SA.blobToDataUrl(f);
          if (dataUrl.startsWith("data:;")) dataUrl = dataUrl.replace("data:;", "data:application/octet-stream;");
          await assets.save({ kind, name: f.name, dataUrl, tags: ["upload"] });
          ok++;
        } catch (e) {
          toast(f.name + ": " + e.message, "bad");
        }
      }
      if (ok) {
        toast(`Uploaded ${ok} file(s).`, "good");
        SA.history.add({ kind: "asset", title: `Uploaded ${ok} file(s) to the Asset Library` });
      }
      this.show();
    }
  });
})();
