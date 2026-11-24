/* Success AI — AI Chat (central intelligence) */
(() => {
  "use strict";
  const { h, $, studio, store, projects, toast, fmtDate, uid, renderMarkdown, TYPES } = SA;
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|js|mjs|ts|tsx|jsx|html?|css|py|java|c|cpp|h|cs|go|rs|rb|php|sql|xml|yml|yaml|toml|ini|sh|swift|kt|dart|vue|svelte|log)$/i;

  studio({
    id: "chat",
    title: "AI Chat",
    kicker: "CENTRAL INTELLIGENCE",
    conv: null,
    attachments: [],
    busy: false,

    mount(el) {
      this.search = h("input", { class: "input", placeholder: "Search chats…", oninput: SA.debounce(() => this.renderList(), 150) });
      this.listEl = h("div", { class: "list" });
      this.titleEl = h("b", { class: "grow", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "New chat");
      this.ctxSelect = h("select", { class: "select", style: { width: "auto", maxWidth: "260px" }, title: "Project context", onchange: () => this.onContextChange() });
      this.messagesEl = h("div", { class: "chat-messages", "aria-live": "polite" });
      this.input = h("textarea", { class: "textarea", placeholder: "Message Success AI…  (Enter to send, Shift+Enter for a new line)", "aria-label": "Message" });
      this.input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          this.send();
        }
      });
      this.input.addEventListener("input", () => {
        this.input.style.height = "auto";
        this.input.style.height = Math.min(240, this.input.scrollHeight) + "px";
      });
      this.attachRow = h("div", { class: "row", style: { marginBottom: "6px" } });
      this.sendBtn = h("button", { class: "btn primary", onclick: () => this.send() }, "Send");
      this.status = h("div", { class: "status-line" });

      el.append(
        h("div", { class: "chat-layout" },
          h("div", { class: "chat-list" },
            h("button", { class: "btn primary", onclick: () => this.newChat() }, "＋ New chat"),
            this.search,
            this.listEl
          ),
          h("div", { class: "chat-main" },
            h("div", { class: "row", style: { padding: "10px 14px", borderBottom: "1px solid var(--line)" } },
              this.titleEl,
              this.ctxSelect,
              h("button", { class: "btn sm ghost", title: "Rename", onclick: () => this.rename() }, "✎"),
              h("button", { class: "btn sm ghost", title: "Export as Markdown", onclick: () => this.exportChat() }, "⇩"),
              h("button", { class: "btn sm ghost", title: "Delete chat", onclick: () => this.deleteChat() }, "🗑")
            ),
            this.messagesEl,
            h("div", { class: "chat-input" },
              this.attachRow,
              this.input,
              h("div", { class: "row", style: { marginTop: "8px" } },
                h("button", { class: "btn sm", onclick: () => this.attach() }, "📎 Attach file"),
                this.status,
                h("div", { class: "grow" }),
                this.sendBtn
              )
            )
          )
        )
      );
      SA.on("change:conversations", SA.debounce(() => this.renderList(), 200));
      SA.on("remote-update", async ({ col, id }) => {
        if (col === "conversations" && this.conv?.id === id && !this.busy) {
          this.conv = await store.get("conversations", id);
          this.renderMessages();
        }
      });
    },

    async show(opts = {}) {
      await this.fillContextSelect();
      await this.renderList();
      if (opts.send) {
        await this.newChat();
        this.input.value = opts.send;
        return this.send();
      }
      if (!this.conv) {
        const list = await store.list("conversations");
        const p = projects.active;
        const forProject = p ? list.find(c => c.projectId === p.id) : null;
        if (forProject) await this.openChat(forProject.id);
        else if (p?.kind === "chat" && !forProject) await this.newChat();
        else if (list[0]) await this.openChat(list[0].id);
        else this.renderMessages();
      }
      this.input.focus();
    },

    /* ---------- conversations ---------- */
    async renderList() {
      const q = this.search.value.trim().toLowerCase();
      const all = await store.list("conversations");
      const items = all.filter(c => !q || (c.title + " " + (c.data?.messages || []).map(m => m.content).join(" ")).toLowerCase().includes(q));
      this.listEl.replaceChildren(
        ...(items.length
          ? items.map(c =>
              h("button", { class: "conv" + (this.conv?.id === c.id ? " active" : ""), onclick: () => this.openChat(c.id), title: c.title },
                c.projectId ? h("span", { style: { flex: "none" }, title: "Linked to a project" }, "▣") : "",
                h("span", {}, c.title),
                h("small", { class: "faint", style: { flex: "none" } }, fmtDate(c.updatedAt))
              )
            )
          : [h("div", { class: "small muted", style: { padding: "8px" } }, q ? "No chats match." : "No chats yet.")])
      );
    },

    async newChat() {
      this.conv = null;
      this.attachments = [];
      this.renderAttachments();
      this.titleEl.textContent = "New chat";
      this.renderMessages();
      this.renderList();
      this.input.focus();
    },

    async openChat(id) {
      this.conv = await store.get("conversations", id);
      if (!this.conv) return this.newChat();
      this.titleEl.textContent = this.conv.title;
      if (this.conv.projectId) this.ctxSelect.value = this.conv.projectId;
      this.renderMessages();
      this.renderList();
    },

    async ensureConv(firstText) {
      if (this.conv) return this.conv;
      const ctx = this.ctxSelect.value || null;
      const title = firstText.replace(/\s+/g, " ").slice(0, 48) + (firstText.length > 48 ? "…" : "");
      this.conv = await store.save("conversations", { id: uid("conv"), kind: "chat", title: title || "New chat", projectId: ctx, data: { messages: [] } });
      this.titleEl.textContent = this.conv.title;
      return this.conv;
    },

    async persist() {
      this.conv = await store.save("conversations", { ...this.conv, data: { ...this.conv.data, messages: this.conv.data.messages.slice(-300) } });
    },

    async rename() {
      if (!this.conv) return;
      const t = await SA.prompt("Rename chat", { value: this.conv.title });
      if (!t || !t.trim()) return;
      this.conv.title = t.trim();
      this.titleEl.textContent = this.conv.title;
      await this.persist();
    },

    async deleteChat() {
      if (!this.conv) return;
      if (!(await SA.confirm("Delete chat?", `"${this.conv.title}" will be deleted from all your devices.`, { danger: true, ok: "Delete" }))) return;
      await store.remove("conversations", this.conv.id);
      this.newChat();
    },

    exportChat() {
      if (!this.conv) return toast("Nothing to export yet.");
      const md = `# ${this.conv.title}\n\n` + this.conv.data.messages.map(m => `**${m.role === "user" ? "You" : "Success AI"}** (${new Date(m.at).toLocaleString()}):\n\n${m.content}\n${(m.attachments || []).map(a => `\n_Attached: ${a.name}_`).join("")}\n`).join("\n---\n\n");
      SA.download(md, this.conv.title.replace(/[^\w-]+/g, "-") + ".md", "text/markdown");
    },

    /* ---------- project context ---------- */
    async fillContextSelect() {
      const list = await projects.list({ includeArchived: false });
      const current = this.conv?.projectId || this.ctxSelect.value || (projects.active ? projects.active.id : "");
      this.ctxSelect.replaceChildren(h("option", { value: "" }, "No project context"), ...list.map(p => h("option", { value: p.id }, (TYPES[p.kind]?.icon || "") + " " + p.title.slice(0, 40))));
      this.ctxSelect.value = list.some(p => p.id === current) ? current : "";
    },

    async onContextChange() {
      if (this.conv) {
        this.conv.projectId = this.ctxSelect.value || null;
        await this.persist();
      }
      const p = this.ctxSelect.value ? await store.get("projects", this.ctxSelect.value) : null;
      if (p) toast(`Success AI will use "${p.title}" as context.`);
    },

    /* ---------- attachments ---------- */
    async attach() {
      const files = await SA.pickFile("*/*", true);
      for (const f of files || []) {
        if (f.type.startsWith("image/")) {
          toast(`"${f.name}": image understanding isn't available with the connected chat model yet. Use Image Studio to edit images.`, "bad");
          continue;
        }
        if (!(f.type.startsWith("text/") || TEXT_EXT.test(f.name) || f.type === "application/json")) {
          toast(`"${f.name}": only text, code and data files can be read in chat right now (PDF/Word reading is not connected).`, "bad");
          continue;
        }
        if (f.size > 400000) {
          toast(`"${f.name}" is larger than 400 KB — paste the relevant part instead.`, "bad");
          continue;
        }
        this.attachments.push({ name: f.name, text: (await SA.readText(f)).slice(0, 60000) });
      }
      this.renderAttachments();
    },

    renderAttachments() {
      this.attachRow.replaceChildren(...this.attachments.map((a, i) => h("span", { class: "attach-chip" }, "📄 " + a.name, h("button", { class: "btn ghost sm", style: { padding: "0 4px" }, onclick: () => { this.attachments.splice(i, 1); this.renderAttachments(); } }, "×"))));
      this.attachRow.hidden = !this.attachments.length;
    },

    /* ---------- messages ---------- */
    renderMessages() {
      const msgs = this.conv?.data?.messages || [];
      this.messagesEl.replaceChildren();
      if (!msgs.length) {
        const p = this.ctxSelect.value;
        this.messagesEl.append(
          h("div", { class: "empty", style: { margin: "auto", maxWidth: "520px" } },
            h("div", { style: { fontSize: "30px" } }, "✦"),
            h("h3", {}, "How can Success AI help?"),
            h("p", { class: "small" }, p ? "This chat uses your selected project as context — ask for changes, ideas or reviews." : "Ask anything, or pick a project above so Success AI understands what you're working on."),
            h("div", { class: "row", style: { justifyContent: "center" } },
              ...["Brainstorm 5 film ideas set in Nepal", "Write a cover letter for a web developer job", "Explain how cloud sync works", "Plan a marketing launch week"].map(s => h("button", { class: "btn sm", onclick: () => { this.input.value = s; this.send(); } }, s))
            )
          )
        );
        return;
      }
      msgs.forEach((m, i) => this.messagesEl.append(this.renderMessage(m, i, msgs.length)));
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    },

    renderMessage(m, i, total) {
      const isUser = m.role === "user";
      const body = isUser ? h("div", { class: "body" }, m.content) : h("div", { class: "body md", html: renderMarkdown(m.content) });
      if (!isUser) {
        body.querySelectorAll("pre").forEach(pre => {
          const b = h("button", { class: "btn sm", style: { position: "absolute", top: "6px", right: "6px" }, onclick: () => SA.copyText(pre.innerText) }, "Copy");
          pre.append(b);
        });
      }
      const tools = h("div", { class: "tools" });
      tools.append(h("button", { class: "btn ghost sm", title: "Copy", onclick: () => SA.copyText(m.content) }, "⧉"));
      if (isUser) tools.append(h("button", { class: "btn ghost sm", title: "Edit and resend", onclick: () => this.editMessage(i) }, "✎"));
      else {
        if (i === total - 1) tools.append(h("button", { class: "btn ghost sm", title: "Regenerate", onclick: () => this.regenerate() }, "↻"));
        tools.append(
          h("button", { class: "btn ghost sm" + (m.feedback === "up" ? " active" : ""), title: "Good response", onclick: () => this.feedback(i, "up") }, "👍"),
          h("button", { class: "btn ghost sm" + (m.feedback === "down" ? " active" : ""), title: "Bad response", onclick: () => this.feedback(i, "down") }, "👎"),
          h("button", { class: "btn ghost sm", title: "Send to a new document", onclick: () => this.toDocument(m) }, "→ Doc")
        );
      }
      return h("div", { class: "msg " + (isUser ? "user" : "assistant") },
        h("div", { class: "who" }, isUser ? "YOU" : "SUCCESS AI"),
        body,
        (m.attachments || []).length ? h("div", { class: "row", style: { marginTop: "6px" } }, ...m.attachments.map(a => h("span", { class: "attach-chip" }, "📄 " + a.name))) : "",
        tools
      );
    },

    toApiMessages(msgs) {
      return msgs.map(m => ({
        role: m.role,
        content: m.content + (m.attachments || []).map(a => `\n\n[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``).join("")
      }));
    },

    async send() {
      if (this.busy) return;
      const text = this.input.value.trim();
      if (!text && !this.attachments.length) return this.input.focus();
      if (text.length > 20000) return toast("Please keep a message under 20,000 characters (attach long text as a file).", "bad");
      await this.ensureConv(text || this.attachments[0].name);
      this.conv.data.messages.push({ role: "user", content: text || "(see attached file)", attachments: this.attachments, at: Date.now() });
      this.input.value = "";
      this.input.style.height = "";
      this.attachments = [];
      this.renderAttachments();
      await this.persist();
      this.renderMessages();
      await this.complete();
    },

    async complete() {
      this.busy = true;
      this.sendBtn.disabled = true;
      const started = Date.now();
      const thinking = h("div", { class: "msg assistant" }, h("div", { class: "who" }, "SUCCESS AI"), h("div", { class: "body row" }, h("span", { class: "spinner" }), h("span", { class: "muted" }, "Thinking…")));
      this.messagesEl.append(thinking);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      const timer = setInterval(() => (thinking.querySelector(".muted").textContent = "Thinking… " + Math.round((Date.now() - started) / 1000) + "s"), 1000);
      try {
        const ctxId = this.conv.projectId || this.ctxSelect.value;
        const ctxProject = ctxId ? await store.get("projects", ctxId) : null;
        const res = await SA.api("chat", {
          messages: this.toApiMessages(this.conv.data.messages.slice(-20)),
          projectContext: ctxProject ? projects.context(ctxProject) : "",
          maxTokens: 3000
        }, { timeout: 180000 });
        const reply = res.reply || "";
        this.conv.data.messages.push({ role: "assistant", content: reply, at: Date.now() });
        if (res.savedMemory) toast("Saved to memory: " + res.savedMemory.content, "good");
        await this.persist();
        this.status.textContent = "";
        SA.history.add({ kind: "chat", title: "Chat: " + this.conv.title, projectId: ctxId || null });
      } catch (e) {
        this.status.className = "status-line bad";
        this.status.textContent = e.message;
        this.conv.data.messages.push({ role: "assistant", content: "⚠️ I couldn't get a reply: " + e.message + "\n\nPress ↻ to try again.", at: Date.now(), error: true });
        await this.persist();
      } finally {
        clearInterval(timer);
        this.busy = false;
        this.sendBtn.disabled = false;
        this.renderMessages();
        this.renderList();
      }
    },

    async regenerate() {
      if (this.busy || !this.conv) return;
      const msgs = this.conv.data.messages;
      if (msgs.at(-1)?.role === "assistant") msgs.pop();
      if (!msgs.length || msgs.at(-1).role !== "user") return;
      this.renderMessages();
      await this.complete();
    },

    async editMessage(i) {
      const m = this.conv.data.messages[i];
      const text = await SA.prompt("Edit message", { value: m.content, multiline: true, ok: "Resend" });
      if (text === null || !text.trim()) return;
      if (i < this.conv.data.messages.length - 1 && !(await SA.confirm("Resend from here?", "Messages after this one will be replaced by a new reply."))) return;
      this.conv.data.messages = this.conv.data.messages.slice(0, i);
      this.conv.data.messages.push({ ...m, content: text.trim(), at: Date.now() });
      await this.persist();
      this.renderMessages();
      await this.complete();
    },

    async feedback(i, value) {
      const m = this.conv.data.messages[i];
      m.feedback = m.feedback === value ? null : value;
      await this.persist();
      this.renderMessages();
    },

    async toDocument(m) {
      const html = SA.sanitizeHTML(renderMarkdown(m.content));
      await projects.create("document", "From chat: " + this.conv.title.slice(0, 40), { html });
    }
  });
})();
