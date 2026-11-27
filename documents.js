/* Success AI — Document Studio */
(() => {
  "use strict";
  const { h, studio, projects, toast, esc, sanitizeHTML } = SA;

  function htmlToMarkdown(html) {
    const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild;
    const walk = (node, ctx = {}) => {
      if (node.nodeType === 3) return node.textContent.replace(/\s+/g, " ");
      if (node.nodeType !== 1) return "";
      const kids = (c = ctx) => [...node.childNodes].map(n => walk(n, c)).join("");
      switch (node.tagName) {
        case "H1": return `\n# ${kids().trim()}\n\n`;
        case "H2": return `\n## ${kids().trim()}\n\n`;
        case "H3": case "H4": return `\n### ${kids().trim()}\n\n`;
        case "P": case "DIV": return `${kids().trim()}\n\n`;
        case "BR": return "  \n";
        case "B": case "STRONG": return `**${kids()}**`;
        case "I": case "EM": return `*${kids()}*`;
        case "S": return `~~${kids()}~~`;
        case "CODE": return "`" + node.textContent + "`";
        case "PRE": return "\n```\n" + node.textContent + "\n```\n\n";
        case "BLOCKQUOTE": return kids().trim().split("\n").map(l => "> " + l).join("\n") + "\n\n";
        case "A": return `[${kids()}](${node.getAttribute("href") || ""})`;
        case "HR": return "\n---\n\n";
        case "UL": case "OL": {
          let i = 0;
          return [...node.children].map(li => (node.tagName === "OL" ? `${++i}. ` : "- ") + walk(li, ctx).trim()).join("\n") + "\n\n";
        }
        case "LI": return kids();
        case "TABLE": {
          const rows = [...node.querySelectorAll("tr")].map(tr => [...tr.children].map(td => td.textContent.trim().replace(/\|/g, "\\|")));
          if (!rows.length) return "";
          const head = `| ${rows[0].join(" | ")} |\n| ${rows[0].map(() => "---").join(" | ")} |\n`;
          return "\n" + head + rows.slice(1).map(r => `| ${r.join(" | ")} |`).join("\n") + "\n\n";
        }
        default: return kids();
      }
    };
    return walk(root).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  const DOC_TEMPLATES = Object.fromEntries((SA.TEMPLATES || []).filter(t => t.type === "document").map(t => [t.title, t.html]));

  studio({
    id: "documents",
    title: "Document Studio",
    kicker: "WRITE · EDIT · EXPORT",
    projectType: "document",
    project: null,

    mount(el) {
      this.titleInput = h("input", { class: "input", style: { fontWeight: 700, fontSize: "16px" }, placeholder: "Untitled document", maxlength: 160 });
      this.saveState = h("span", { class: "small faint" });
      this.wordCount = h("span", { class: "small faint" });
      this.page = h("div", { class: "doc-page", contenteditable: "true", spellcheck: "true", "aria-label": "Document" });
      const exec = (cmd, val = null) => () => {
        this.page.focus();
        document.execCommand(cmd, false, val);
        this.changed();
      };
      const blockSel = h("select", { class: "select", style: { width: "auto" }, onchange: e => { exec("formatBlock", e.target.value)(); e.target.value = ""; } },
        h("option", { value: "" }, "Style…"), h("option", { value: "P" }, "Paragraph"), h("option", { value: "H1" }, "Title (H1)"), h("option", { value: "H2" }, "Heading (H2)"), h("option", { value: "H3" }, "Subheading (H3)"), h("option", { value: "BLOCKQUOTE" }, "Quote"), h("option", { value: "PRE" }, "Code"));
      const tb = (label, title, fn) => h("button", { class: "btn sm ghost", title, type: "button", onmousedown: e => e.preventDefault(), onclick: fn }, label);
      const toolbar = h("div", { class: "doc-toolbar" },
        blockSel,
        tb(h("b", {}, "B"), "Bold (Ctrl+B)", exec("bold")), tb(h("i", {}, "I"), "Italic (Ctrl+I)", exec("italic")), tb(h("u", {}, "U"), "Underline (Ctrl+U)", exec("underline")), tb(h("s", {}, "S"), "Strikethrough", exec("strikeThrough")),
        tb("• List", "Bulleted list", exec("insertUnorderedList")), tb("1. List", "Numbered list", exec("insertOrderedList")),
        tb("⊞ Table", "Insert table", () => this.insertTable()), tb("🔗", "Link", async () => { const sel = this.saveSelection(); const url = await SA.prompt("Insert link", { label: "URL (https://…)" }); if (!url || !/^https?:\/\//.test(url)) return; this.restoreSelection(sel); exec("createLink", url)(); }),
        tb("―", "Divider", exec("insertHorizontalRule")),
        tb("↶", "Undo", exec("undo")), tb("↷", "Redo", exec("redo")), tb("⌫ Format", "Clear formatting", exec("removeFormat")),
        tb("🔍 Find", "Find & replace", () => this.findReplace())
      );

      // AI panel
      this.aiInput = h("textarea", { class: "textarea", placeholder: "Tell Success AI what to write or change…\ne.g. Write a one-page business proposal for a coffee shop in Pokhara" });
      this.aiStatus = h("div", { class: "status-line" });
      this.aiResult = h("div", { class: "card", hidden: true, style: { background: "var(--panel2)", maxHeight: "50vh", overflow: "auto" } });
      this.lang = h("input", { class: "input", value: "Nepali", style: { maxWidth: "140px" } });
      const act = (label, fn, kind = "") => h("button", { class: "btn sm " + kind, onclick: fn }, label);

      el.append(
        h("div", { class: "split wide-left" },
          h("div", { class: "stack" },
            h("div", { class: "row nowrap" }, this.titleInput, this.saveState),
            h("div", {}, toolbar, this.page),
            h("div", { class: "row" }, this.wordCount, h("div", { class: "grow" }),
              h("button", { class: "btn sm", onclick: () => this.importFile() }, "⇧ Import"),
              h("button", { class: "btn sm", onclick: () => this.project && SA.ui.showVersions(this.project) }, "🕘 Versions"),
              h("button", { class: "btn sm", onclick: () => this.exportPDF() }, "PDF"),
              h("button", { class: "btn sm", onclick: () => this.exportWord() }, "Word"),
              h("button", { class: "btn sm", onclick: () => this.exportAs("html") }, "HTML"),
              h("button", { class: "btn sm", onclick: () => this.exportAs("md") }, "Markdown"),
              h("button", { class: "btn sm", onclick: () => this.exportAs("txt") }, "TXT"))
          ),
          h("div", { class: "card stack", style: { position: "sticky", top: "76px" } },
            h("h2", {}, "✦ Writing assistant"),
            this.aiInput,
            h("div", { class: "row" }, act("Write draft", () => this.ai("draft"), "primary"), act("Continue", () => this.ai("continue"))),
            h("div", { class: "small muted" }, "Works on your selected text, or the whole document if nothing is selected:"),
            h("div", { class: "row" },
              act("Rewrite", () => this.ai("rewrite")), act("Proofread", () => this.ai("proofread")), act("Summarize", () => this.ai("summarize")),
              act("Expand", () => this.ai("expand")), act("Simplify", () => this.ai("simplify")), act("More formal", () => this.ai("formal"))),
            h("div", { class: "row nowrap" }, act("Translate to", () => this.ai("translate")), this.lang),
            h("label", { class: "lbl" }, "Start from a template"),
            h("select", { class: "select", onchange: async e => { const html = DOC_TEMPLATES[e.target.value]; e.target.value = ""; if (!html) return; if (this.page.textContent.trim() && !(await SA.confirm("Replace document?", "Your current content will be replaced by the template."))) return; this.page.innerHTML = html; this.changed(); } },
              h("option", { value: "" }, "Choose…"), ...Object.keys(DOC_TEMPLATES).map(k => h("option", { value: k }, k))),
            this.aiStatus,
            this.aiResult
          )
        )
      );
      this.page.addEventListener("input", () => this.changed());
      this.page.addEventListener("paste", e => {
        const html = e.clipboardData.getData("text/html");
        if (!html) return;
        e.preventDefault();
        document.execCommand("insertHTML", false, sanitizeHTML(html));
      });
      this.titleInput.addEventListener("input", () => this.changed());
      this.autosave = SA.debounce(() => this.save(), 900);
      this.renderEmptyHint();
    },

    renderEmptyHint() {
      if (!this.page.innerHTML.trim()) this.page.innerHTML = "<p><br></p>";
    },

    changed() {
      const words = (this.page.innerText.match(/\S+/g) || []).length;
      this.wordCount.textContent = `${words} words · ~${Math.max(1, Math.round(words / 230))} min read`;
      this.saveState.textContent = "Unsaved…";
      this.autosave();
    },

    async save() {
      const text = this.page.innerText.trim();
      if (!this.project) {
        if (!text && !this.titleInput.value.trim()) return;
        await projects.ensure("document", this.titleInput.value || this.page.querySelector("h1,h2,h3,p,li")?.textContent.trim() || "Untitled document");
        this.project = projects.active;
      }
      const html = sanitizeHTML(this.page.innerHTML);
      const title = this.titleInput.value.trim() || this.project.title;
      this.project = await projects.patch(this.project.id, { html, title }, { title });
      this.saveState.textContent = SA.state.user ? "Saved · syncing" : "Saved on this device";
    },

    async load(p) {
      this.project = p;
      const d = p?.data || {};
      this.titleInput.value = d.title || p?.title || "";
      this.page.innerHTML = d.html ? sanitizeHTML(d.html) : d.content ? esc(d.content).replace(/\n/g, "<br>") : "";
      if (!d.html && d.seed) this.aiInput.value = d.seed;
      this.renderEmptyHint();
      this.changed();
      this.saveState.textContent = p ? "Saved" : "";
    },

    onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        this.autosave.flush();
        toast("Saved.", "good");
        return true;
      }
      return false;
    },

    /* ---------- selection helpers ---------- */
    saveSelection() {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      return this.page.contains(r.commonAncestorContainer) ? r.cloneRange() : null;
    },
    restoreSelection(range) {
      if (!range) return;
      this.page.focus();
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },

    insertTable() {
      const rows = 3,
        cols = 3;
      const html = "<table><tr>" + "<th>Heading</th>".repeat(cols) + "</tr>" + ("<tr>" + "<td>&nbsp;</td>".repeat(cols) + "</tr>").repeat(rows - 1) + "</table><p><br></p>";
      this.page.focus();
      document.execCommand("insertHTML", false, html);
      this.changed();
    },

    async findReplace() {
      const find = h("input", { class: "input", placeholder: "Find" });
      const repl = h("input", { class: "input", placeholder: "Replace with" });
      const matchCase = h("input", { type: "checkbox" });
      const r = await SA.modal({
        title: "Find & replace",
        body: h("div", { class: "stack" }, find, repl, h("label", { class: "row small muted" }, matchCase, "Match case")),
        actions: [{ label: "Cancel", value: null }, { label: "Replace all", kind: "primary", onClick: () => ({ f: find.value, r: repl.value, c: matchCase.checked }) }]
      });
      if (!r || !r.f) return;
      const walker = document.createTreeWalker(this.page, NodeFilter.SHOW_TEXT);
      const re = new RegExp(r.f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), r.c ? "g" : "gi");
      let count = 0,
        n;
      while ((n = walker.nextNode())) {
        const m = n.textContent.match(re);
        if (m) {
          count += m.length;
          n.textContent = n.textContent.replace(re, r.r);
        }
      }
      this.changed();
      toast(count ? `Replaced ${count} occurrence(s).` : "No matches found.");
    },

    /* ---------- AI ---------- */
    async ai(mode) {
      const range = this.saveSelection();
      const selectedText = range && !range.collapsed ? range.toString() : "";
      const docText = this.page.innerText.trim();
      const target = selectedText || docText;
      const instruction = this.aiInput.value.trim();
      const prompts = {
        draft: () => (instruction ? `Write a complete, well-structured document: ${instruction}` : null),
        continue: () => (docText ? `Continue this document naturally from where it ends${instruction ? " (" + instruction + ")" : ""}. Return only the new content.\n\n${docText.slice(-6000)}` : null),
        rewrite: () => target && `Rewrite this to be clearer and stronger${instruction ? " — " + instruction : ""}:\n\n${target}`,
        proofread: () => target && `Proofread and correct spelling, grammar and punctuation. Keep wording and structure otherwise unchanged:\n\n${target}`,
        summarize: () => target && `Summarize this concisely with a short heading and bullet points:\n\n${target}`,
        expand: () => target && `Expand this with more detail, examples and depth${instruction ? " — " + instruction : ""}:\n\n${target}`,
        simplify: () => target && `Rewrite this in simple, plain language anyone can understand:\n\n${target}`,
        formal: () => target && `Rewrite this in a polished, formal, professional tone:\n\n${target}`,
        translate: () => target && `Translate this into ${this.lang.value}, preserving structure:\n\n${target}`
      };
      const body = prompts[mode]();
      if (!body) {
        this.aiStatus.className = "status-line bad";
        this.aiStatus.textContent = mode === "draft" ? "Describe what to write in the box above." : "Write something in the document first.";
        return;
      }
      this.aiStatus.className = "status-line";
      this.aiStatus.textContent = "Writing…";
      this.aiResult.hidden = true;
      try {
        const reply = await SA.ai("document", body + "\n\nReturn clean semantic HTML only (h1-h3, p, ul, ol, li, strong, em, table). No <html>, <head>, <body>, scripts, styles or Markdown fences.", { maxTokens: mode === "draft" ? 5000 : 3500 });
        let html = reply.replace(/^```(?:html)?\s*|```\s*$/g, "").trim();
        if (!/<[a-z][\s\S]*>/i.test(html)) html = SA.renderMarkdown(html);
        html = sanitizeHTML(html);
        this.showResult(mode, html, range, !!selectedText);
        this.aiStatus.textContent = "Review the result below before applying it.";
        SA.history.add({ kind: "document", title: `AI ${mode}: ` + (this.titleInput.value || "document"), projectId: this.project?.id });
      } catch (e) {
        this.aiStatus.className = "status-line bad";
        this.aiStatus.textContent = e.message;
      }
    },

    showResult(mode, html, range, hasSelection) {
      const apply = async how => {
        if (how === "replace-doc") {
          if (this.page.innerText.trim() && !(await SA.confirm("Replace the whole document?", "Your current text will be replaced. You can undo with Ctrl+Z or restore from version history."))) return;
          this.page.innerHTML = html;
        } else if (how === "replace-sel" && range) {
          this.restoreSelection(range);
          document.execCommand("insertHTML", false, html);
        } else if (how === "insert" && range) {
          range.collapse(false);
          this.restoreSelection(range);
          document.execCommand("insertHTML", false, html);
        } else {
          this.page.insertAdjacentHTML("beforeend", html);
        }
        this.aiResult.hidden = true;
        this.changed();
      };
      const docEmpty = !this.page.innerText.trim();
      this.aiResult.replaceChildren(
        h("div", { class: "doc-page", style: { minHeight: "0", padding: "18px", borderRadius: "10px", fontSize: "14px" }, html }),
        h("div", { class: "row", style: { marginTop: "10px" } },
          hasSelection ? h("button", { class: "btn sm primary", onclick: () => apply("replace-sel") }, "Replace selection") : "",
          !hasSelection && ["rewrite", "proofread", "simplify", "formal", "translate", "expand"].includes(mode) || docEmpty ? h("button", { class: "btn sm primary", onclick: () => apply("replace-doc") }, docEmpty ? "Use as document" : "Replace document") : "",
          range && !docEmpty ? h("button", { class: "btn sm", onclick: () => apply("insert") }, "Insert at cursor") : "",
          !docEmpty ? h("button", { class: "btn sm", onclick: () => apply("append") }, "Append to end") : "",
          h("button", { class: "btn sm", onclick: () => SA.copyText(h("div", { html }).innerText) }, "Copy"),
          h("button", { class: "btn sm ghost", onclick: () => (this.aiResult.hidden = true) }, "Discard")
        )
      );
      this.aiResult.hidden = false;
    },

    /* ---------- import / export ---------- */
    async importFile() {
      const f = await SA.pickFile(".txt,.md,.markdown,.html,.htm,.docx,.pdf");
      if (!f) return;
      if (/\.(docx|pdf)$/i.test(f.name)) return toast("Word and PDF import aren't available yet. Copy the text from the file and paste it here — formatting is kept.", "bad");
      const text = await SA.readText(f);
      const html = /\.html?$/i.test(f.name) ? sanitizeHTML(new DOMParser().parseFromString(text, "text/html").body.innerHTML) : /\.(md|markdown)$/i.test(f.name) ? sanitizeHTML(SA.renderMarkdown(text)) : text.split(/\n{2,}/).map(p => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");
      if (this.page.innerText.trim() && !(await SA.confirm("Replace document?", `Replace the current content with "${f.name}"?`))) return;
      this.page.innerHTML = html;
      if (!this.titleInput.value) this.titleInput.value = f.name.replace(/\.\w+$/, "");
      this.changed();
    },
    fileBase() {
      return (this.titleInput.value || "document").replace(/[^\w-]+/g, "-");
    },
    standalone() {
      const title = esc(this.titleInput.value || "Document");
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.7 Georgia,serif;max-width:780px;margin:40px auto;padding:0 24px;color:#1b1f2b}h1,h2,h3{font-family:-apple-system,Segoe UI,sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c8cdd8;padding:6px 9px}th{background:#f1f3f8}@page{margin:2cm}</style></head><body>${sanitizeHTML(this.page.innerHTML)}</body></html>`;
    },
    exportAs(kind) {
      if (kind === "html") SA.download(this.standalone(), this.fileBase() + ".html", "text/html");
      if (kind === "md") SA.download(htmlToMarkdown(this.page.innerHTML), this.fileBase() + ".md", "text/markdown");
      if (kind === "txt") SA.download(this.page.innerText, this.fileBase() + ".txt", "text/plain");
    },
    exportWord() {
      // Word opens HTML saved with the Office namespace; this is a real .doc file Word, Pages and LibreOffice can open and re-save as .docx.
      const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(this.titleInput.value)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}</style></head><body>${sanitizeHTML(this.page.innerHTML)}</body></html>`;
      SA.download(new Blob(["﻿", doc], { type: "application/msword" }), this.fileBase() + ".doc");
      toast("Downloaded a Word-compatible .doc — open it in Word and use Save As → .docx if you need that format.");
    },
    exportPDF() {
      const w = window.open("", "_blank");
      if (!w) return toast("Allow pop-ups to export PDF.", "bad");
      w.document.write(this.standalone().replace("</body>", "<script>onload=()=>{print()}<\/script></body>"));
      w.document.close();
      toast("Choose “Save as PDF” in the print dialog.");
    },
    context(p) {
      const d = p.data || {};
      const text = new DOMParser().parseFromString(d.html || "", "text/html").body.innerText || d.content || "";
      return `Document "${d.title || p.title}":\n${text.slice(0, 6000)}`;
    }
  });
  SA.htmlToMarkdown = htmlToMarkdown;
})();
