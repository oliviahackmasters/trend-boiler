(() => {
  const STORAGE_KEY = "hm_meta_agent_selected_project";
  const API_BASE = window.HM_META_AGENT_API_BASE || "";

  const state = {
    projects: [],
    selectedProject: null,
    memory: [],
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else node.setAttribute(key, value);
    });
    children.forEach((child) => node.appendChild(child));
    return node;
  }

  function loadStoredProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function storeSelectedProject(project) {
    state.selectedProject = project || null;
    if (project) localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function getProjectPayload() {
    const project = state.selectedProject || loadStoredProject();
    if (!project?.id) return {};
    return {
      projectId: project.id,
      projectName: project.name || project.id,
      useProjectMemory: true,
      saveToProjectMemory: true,
    };
  }

  function patchFetchToAttachProject() {
    if (window.__hmProjectMemoryFetchPatched) return;
    window.__hmProjectMemoryFetchPatched = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      try {
        const url = typeof input === "string" ? input : input?.url || "";
        const isMetaRequest = /\/api\/(meta-cognition|meta-llm)(\?|$)/.test(url);
        const method = String(init?.method || "GET").toUpperCase();
        const payload = getProjectPayload();

        if (isMetaRequest && method === "POST" && payload.projectId && init?.body) {
          const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
          const nextBody = { ...body, ...payload };
          init = {
            ...init,
            headers: { ...(init.headers || {}), "Content-Type": "application/json" },
            body: JSON.stringify(nextBody),
          };
        }
      } catch (err) {
        console.warn("Project memory fetch patch skipped:", err);
      }

      return originalFetch(input, init);
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.details || response.statusText);
    return data;
  }

  async function loadProjects() {
    const data = await api("/api/projects");
    state.projects = data.projects || [];

    const stored = loadStoredProject();
    if (stored?.id) {
      const fresh = state.projects.find((p) => p.id === stored.id) || stored;
      storeSelectedProject(fresh);
    } else if (state.projects.length && !state.selectedProject) {
      storeSelectedProject(state.projects[0]);
    }

    renderProjectSelect();
    await loadMemory();
  }

  async function createProject(name) {
    const data = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    storeSelectedProject(data.project);
    await loadProjects();
  }

  async function loadMemory() {
    if (!state.selectedProject?.id) {
      state.memory = [];
      renderMemoryPanel();
      return;
    }

    const data = await api(`/api/projects?projectId=${encodeURIComponent(state.selectedProject.id)}`);
    state.memory = data.memory || [];
    renderMemoryPanel();
  }

  function renderProjectSelect() {
    const select = qs("#hm-project-select");
    const label = qs("#hm-project-current");
    if (!select) return;

    select.innerHTML = "";
    select.appendChild(el("option", { value: "", text: "No project selected" }));

    state.projects.forEach((project) => {
      const option = el("option", { value: project.id, text: project.name || project.id });
      if (state.selectedProject?.id === project.id) option.selected = true;
      select.appendChild(option);
    });

    if (label) {
      label.textContent = state.selectedProject?.name
        ? `Using project: ${state.selectedProject.name}`
        : "No project selected. Outputs will not be saved to project memory.";
    }
  }

  function renderMemoryPanel() {
    const panel = qs("#hm-project-memory-list");
    const count = qs("#hm-project-memory-count");
    if (!panel) return;

    if (count) count.textContent = `${state.memory.length} item${state.memory.length === 1 ? "" : "s"}`;
    panel.innerHTML = "";

    if (!state.selectedProject?.id) {
      panel.appendChild(el("p", { class: "hm-project-empty", text: "Select or create a project to view memory." }));
      return;
    }

    if (!state.memory.length) {
      panel.appendChild(el("p", { class: "hm-project-empty", text: "No memory saved yet. Run Meta Cognition in this project to start building context." }));
      return;
    }

    state.memory.forEach((item) => {
      const title = item.title || item.summary || "Untitled memory item";
      const meta = [item.toolName || item.tool_name, item.type, item.createdAt || item.created_at]
        .filter(Boolean)
        .join(" · ");
      const body = item.summary || item.content || "";

      panel.appendChild(
        el("article", { class: "hm-memory-item" }, [
          el("h4", { text: title }),
          el("small", { text: meta }),
          el("p", { text: String(body).slice(0, 500) }),
        ])
      );
    });
  }

  function injectStyles() {
    if (qs("#hm-project-memory-styles")) return;
    document.head.appendChild(el("style", { id: "hm-project-memory-styles", text: `
      .hm-project-bar{border:1px solid rgba(209,128,87,.45);padding:12px;margin:10px 0 14px 0;background:rgba(0,0,0,.35);color:#fff;font-family:Montserrat,system-ui,sans-serif}
      .hm-project-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .hm-project-row input,.hm-project-row select{background:#111;color:#fff;border:1px solid rgba(255,255,255,.25);padding:8px;min-height:36px}
      .hm-project-row button{background:#D18057;color:#000;border:0;padding:8px 12px;min-height:36px;cursor:pointer;font-weight:700}
      .hm-project-current{font-size:13px;opacity:.85;margin-top:8px}
      .hm-memory-toggle{background:transparent!important;color:#D18057!important;border:1px solid #D18057!important}
      .hm-project-memory-panel{display:none;margin-top:10px;border-top:1px solid rgba(255,255,255,.15);padding-top:10px;max-height:260px;overflow:auto}
      .hm-project-memory-panel.is-open{display:block}
      .hm-project-memory-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;opacity:.9}
      .hm-memory-item{border:1px solid rgba(255,255,255,.12);padding:8px;margin:8px 0;background:rgba(255,255,255,.04)}
      .hm-memory-item h4{margin:0 0 4px 0;font-size:14px;color:#fff}
      .hm-memory-item small{display:block;opacity:.65;margin-bottom:6px}
      .hm-memory-item p,.hm-project-empty{margin:0;font-size:13px;line-height:1.35;opacity:.85}
    ` }));
  }

  function injectUI() {
    if (qs("#hm-project-memory-ui")) return;

    const target = qs("#hmMetaCog .hm-sub") || qs("#hmMetaCog") || qs(".hm-wrap") || document.body;
    const bar = el("section", { id: "hm-project-memory-ui", class: "hm-project-bar" }, [
      el("div", { class: "hm-project-row" }, [
        el("select", { id: "hm-project-select", "aria-label": "Select project" }),
        el("input", { id: "hm-project-name", type: "text", placeholder: "New project name" }),
        el("button", { id: "hm-project-create", type: "button", text: "Create project" }),
        el("button", { id: "hm-project-refresh", type: "button", text: "Refresh" }),
        el("button", { id: "hm-project-memory-toggle", type: "button", class: "hm-memory-toggle", text: "View memory" }),
      ]),
      el("div", { id: "hm-project-current", class: "hm-project-current", text: "Loading projects..." }),
      el("div", { id: "hm-project-memory-panel", class: "hm-project-memory-panel" }, [
        el("div", { class: "hm-project-memory-head" }, [
          el("strong", { text: "Project memory" }),
          el("span", { id: "hm-project-memory-count", text: "0 items" }),
        ]),
        el("div", { id: "hm-project-memory-list" }),
      ]),
    ]);

    if (target.id === "hmMetaCog" || target.classList?.contains("hm-wrap")) {
      target.prepend(bar);
    } else {
      target.insertAdjacentElement("afterend", bar);
    }

    qs("#hm-project-select")?.addEventListener("change", async (event) => {
      const project = state.projects.find((p) => p.id === event.target.value) || null;
      storeSelectedProject(project);
      renderProjectSelect();
      await loadMemory();
    });

    qs("#hm-project-create")?.addEventListener("click", async () => {
      const input = qs("#hm-project-name");
      const name = input?.value?.trim();
      if (!name) return alert("Enter a project name first.");
      await createProject(name);
      input.value = "";
    });

    qs("#hm-project-refresh")?.addEventListener("click", loadProjects);

    qs("#hm-project-memory-toggle")?.addEventListener("click", async () => {
      await loadMemory();
      qs("#hm-project-memory-panel")?.classList.toggle("is-open");
    });
  }

  async function init() {
    patchFetchToAttachProject();
    injectStyles();
    injectUI();

    try {
      await loadProjects();
    } catch (err) {
      const label = qs("#hm-project-current");
      if (label) label.textContent = `Project memory unavailable: ${err.message}`;
      console.warn("Project memory unavailable:", err);
    }
  }

  window.HMProjectMemory = {
    init,
    getSelectedProject: () => state.selectedProject || loadStoredProject(),
    getProjectPayload,
    loadProjects,
    loadMemory,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
