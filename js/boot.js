/* Success AI — boot: navigation, shortcuts, sync indicator, startup */
(async () => {
  "use strict";
  const { $, $$, h } = SA;

  // Navigation
  $$(".nav-item[data-view]").forEach(b => b.addEventListener("click", () => SA.go(b.dataset.view)));
  $("#nav-new-project").addEventListener("click", () => SA.projects.newWithPicker());
  $("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#project-chip").addEventListener("click", () => {
    const p = SA.projects.active;
    if (p && SA.studios[SA.state.view]?.projectType !== p.kind) SA.projects.open(p.id);
    else SA.go("projects");
  });
  $("#account-btn").addEventListener("click", () => SA.go("settings", { tab: "account" }));
  $("#sync-pill").addEventListener("click", () => (SA.state.user ? SA.sync.run() : SA.go("settings", { tab: "account" })));
  document.addEventListener("click", e => {
    const sb = $("#sidebar");
    if (sb.classList.contains("open") && !sb.contains(e.target) && e.target !== $("#menu-btn")) sb.classList.remove("open");
  });
  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (v && v !== SA.state.view && SA.studios[v]) SA.go(v);
  });

  // Account button + sync indicator
  function renderAccount() {
    const u = SA.state.user;
    $("#account-btn").textContent = u ? "👤 " + (u.name || u.email.split("@")[0]) : "Sign in";
  }
  function renderSync() {
    const s = SA.sync.state;
    const map = {
      guest: ["", "Guest · saved on this device"],
      syncing: ["warn", "Syncing…"],
      synced: ["good", "Synced " + (SA.sync.lastSync ? SA.sync.lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "")],
      offline: ["warn", "Offline · changes saved locally"],
      error: ["bad", "Sync error · tap to retry"],
      conflict: ["warn", "Resolve sync conflict"],
      idle: ["", "Ready"]
    };
    const [cls, text] = map[s] || map.idle;
    $("#sync-dot").className = "dot " + cls;
    $("#sync-text").textContent = text;
    $("#sync-pill").title = SA.sync.detail || text;
  }
  let lastOwner = SA.owner();
  SA.on("auth", async () => {
    renderAccount();
    if (SA.owner() === lastOwner) return;
    lastOwner = SA.owner();
    SA.sync.run();
    // Account changed: reload the visible studio so it shows this account's data.
    const stillMine = SA.projects.activeId ? await SA.store.get("projects", SA.projects.activeId) : null;
    SA.projects.setActive(stillMine);
    Object.values(SA.studios).forEach(d => (d._loadedId = undefined));
    if (booted) SA.go(SA.state.view);
  });
  let booted = false;
  SA.on("sync", renderSync);
  SA.on("remote-update", async ({ col, id }) => {
    if (col === "projects" && SA.projects.activeId === id) {
      const p = await SA.store.get("projects", id);
      const def = SA.studios[SA.state.view];
      if (p && def?.projectType === p.kind && def._loadedId === id) {
        SA.projects.active = p;
        await def.load(p);
        SA.toast(`“${p.title}” was updated from another device.`);
      }
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      SA.go("chat");
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      SA.projects.newWithPicker();
      return;
    }
    const def = SA.studios[SA.state.view];
    if (def?.onKey && def.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      SA.sync.run();
      SA.toast(SA.state.user ? "All changes are saved automatically — syncing now." : "All changes are saved automatically on this device.");
      return;
    }
    if (e.key === "?" && !typing) SA.go("settings", { tab: "appearance" });
  });

  // Warn before closing with unsynced work while online & signed in.
  window.addEventListener("beforeunload", e => {
    if (SA.state.user && SA.sync.state === "syncing") {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Startup
  renderAccount();
  renderSync();
  SA.serverStatus();
  await SA.migrateLegacy();
  await SA.auth.refresh();
  if (SA.projects.activeId) SA.projects.active = await SA.store.get("projects", SA.projects.activeId);
  const start = location.hash.slice(1);
  await SA.go(SA.studios[start] ? start : "home");
  booted = true;
  SA.sync.run();

  // PWA install support (works on Android, Windows, macOS, Linux, ChromeOS; iOS via Share → Add to Home Screen)
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker not registered", err));
  }
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    installEvent = e;
    const btn = h("button", { class: "btn sm", style: { width: "100%", marginBottom: "8px" }, onclick: async () => { installEvent.prompt(); await installEvent.userChoice; btn.remove(); } }, "⬇ Install Success AI app");
    $(".sidebar-foot").prepend(btn);
  });
})();
