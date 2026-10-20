import type {Comment, Status, Ticket} from "../types.ts";
import {STATUS_LABEL} from "../types.ts";
import {h, type Child} from "./dom.ts";
import {ApiError, api, apiText, setUnauthorizedHandler, uiToken, type ArchiveInfo, type ArchiveSnapshot, type LiveState, type RunView} from "./api.ts";
import {renderMarkdown} from "./markdown.ts";

// ---------------------------------------------------------------- types/state

type Tab = "comments" | "runs" | "history";
type View = {kind: "live"} | {kind: "archives"} | {kind: "archive"; snap: ArchiveSnapshot};
type Data = Pick<LiveState, "tickets" | "comments" | "runs" | "history">;

interface Index {
  byN: Map<number, Ticket>;
  bugs: Map<number, number>;
  passed: Map<number, boolean>;
  runs: Map<number, RunView[]>;
  comments: Map<number, Comment[]>;
}

const STATUSES: Status[] = ["todo", "in_progress", "testing", "done"];
const TABS: [Tab, string][] = [["comments", "Comments"], ["runs", "Agent runs"], ["history", "History"]];
const ASSIGNEE_LABEL = {none: "Unassigned", user: "You", agent: "Agent"};

let view: View = {kind: "live"};
let live: LiveState | null = null;
let archives: ArchiveInfo[] = [];
let connected = false;
let restarted = false;
let dragN: number | null = null;
let dragging = false;
let renderPending = false;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let indexCache: {d: Data; ix: Index} | null = null;

const drafts = new Map<string, string>();
const openReply = new Set<string>();

// ---------------------------------------------------------------- shell

const topbar = h("header", {class: "topbar"});
const banners = h("div");
const mainEl = h("main");
const drawerHost = h("div");
const modalHost = h("div");
const toasts = h("div", {class: "toasts", role: "status", "aria-live": "polite"});
document.getElementById("app")!.append(topbar, banners, mainEl, drawerHost, modalHost, toasts);

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toast(message: string, info = false): void {
  const el = h("div", {class: info ? "toast info" : "toast"}, message);
  toasts.append(el);
  setTimeout(() => el.remove(), 4500);
}

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  if (s < 30 * 86400) return Math.round(s / 86400) + "d ago";
  return new Date(ms).toLocaleDateString();
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
}

function parseTicketNumbers(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[\s,]+/)) {
    if (tok === "") continue;
    const m = /^(?:T-|#)?(\d+)$/i.exec(tok);
    if (!m) throw new Error("Invalid ticket number: " + tok);
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function push<T>(m: Map<number, T[]>, k: number, v: T): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function mdEl(src: string): HTMLElement {
  const el = h("div", {class: "md"});
  el.innerHTML = renderMarkdown(src);
  return el;
}

function none(): HTMLElement {
  return h("span", {class: "muted"}, "None");
}

// ---------------------------------------------------------------- data

function data(): Data | null {
  if (view.kind === "archive") return view.snap.state;
  return view.kind === "live" ? live : null;
}

function ticketNow(n: number): Ticket | undefined {
  return data()?.tickets.find((t) => t.n === n);
}

function index(d: Data): Index {
  if (indexCache?.d === d) return indexCache.ix;
  const ix: Index = {byN: new Map(), bugs: new Map(), passed: new Map(), runs: new Map(), comments: new Map()};
  for (const t of d.tickets) ix.byN.set(t.n, t);
  for (const c of [...d.comments].sort((a, b) => a.id - b.id)) {
    push(ix.comments, c.ticket, c);
    if (c.kind === "bug" && c.bugStatus === "open") ix.bugs.set(c.ticket, (ix.bugs.get(c.ticket) ?? 0) + 1);
    if (c.kind === "test_run") ix.passed.set(c.ticket, c.passed === true);
  }
  for (const r of d.runs) push(ix.runs, r.ticket, r);
  indexCache = {d, ix};
  return ix;
}

async function load(): Promise<void> {
  try {
    const s = await api<LiveState>("GET", "/api/state");
    if (live && s.rev < live.rev) return;
    const changed = !live || s.rev !== live.rev;
    live = s;
    if (changed) renderAll();
  } catch {
    // 401 is surfaced through the unauthorized handler; other failures show as Reconnecting
  }
}

function scheduleLoad(): void {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => void load(), 100);
}

/** Runs a mutation, reloads state, and toasts the server's message on failure. */
async function act(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) toast(errMsg(e));
    renderAll();
    return false;
  }
  await load();
  return true;
}

function connect(): void {
  const es = new EventSource("/api/events?token=" + encodeURIComponent(uiToken));
  es.onopen = () => {
    connected = true;
    renderTop();
  };
  es.addEventListener("hello", scheduleLoad);
  es.addEventListener("change", scheduleLoad);
  es.onerror = () => {
    connected = false;
    renderTop();
    if (es.readyState !== EventSource.CLOSED) return;
    es.close();
    void load();
    setTimeout(() => {
      if (!restarted) connect();
    }, 2000);
  };
}

// ---------------------------------------------------------------- modals/toasts

interface ModalEntry {
  overlay: HTMLElement;
  prev: Element | null;
  onClose?: () => void;
  close(): void;
}
const modals: ModalEntry[] = [];
let modalSeq = 0;

function openModal(title: string, body: Node, actions: Child, opts: {wide?: boolean; onClose?: () => void} = {}): () => void {
  const tid = "modal-title-" + ++modalSeq;
  const dialog = h(
    "div",
    {class: opts.wide ? "modal wide" : "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": tid},
    h("h2", {id: tid}, title),
    h("div", {class: "modal-body"}, body),
    h("div", {class: "modal-actions"}, actions),
  );
  const overlay = h("div", {class: "overlay", onmousedown: (e: MouseEvent) => e.target === overlay && entry.close()}, dialog);
  const entry: ModalEntry = {
    overlay,
    prev: document.activeElement,
    onClose: opts.onClose,
    close() {
      const i = modals.indexOf(entry);
      if (i < 0) return;
      modals.splice(i, 1);
      overlay.remove();
      entry.onClose?.();
      if (entry.prev instanceof HTMLElement && entry.prev.isConnected) entry.prev.focus();
    },
  };
  modals.push(entry);
  modalHost.append(overlay);
  dialog.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button")?.focus();
  return () => entry.close();
}

function confirmDialog(message: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h("button", {class: danger ? "btn danger" : "btn primary", onclick: () => ((answer = true), close())}, okLabel);
    const cancel = h("button", {class: "btn", onclick: () => close()}, "Cancel");
    const close = openModal("Confirm", h("p", null, message), [cancel, ok], {onClose: () => resolve(answer)});
  });
}

document.addEventListener("keydown", (e) => {
  const top = modals.at(-1);
  if (e.key === "Escape") {
    if (top) top.close();
    else if (drawer) closeDrawer();
    return;
  }
  if (e.key !== "Tab" || !top) return;
  const focusable = [...top.overlay.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (!(active instanceof Node) || !top.overlay.contains(active) || (e.shiftKey && active === first)) {
    e.preventDefault();
    (e.shiftKey && active === first ? last : first).focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});

// ---------------------------------------------------------------- top bar and banners

function renderTop(): void {
  topbar.replaceChildren(
    h("div", {class: "brand"}, h("span", {class: "mark"}, "slimstack"), h("span", {class: "project"}, live?.project ?? "")),
    h("div", {class: "spacer"}),
    h("span", {class: connected ? "pill live" : "pill warn", role: "status"}, h("span", {class: "dot"}), connected ? "Live" : "Reconnecting..."),
    h("button", {class: "btn primary", disabled: view.kind !== "live", onclick: openNewTicket}, "New ticket"),
    h("button", {class: "btn", onclick: () => void showArchives()}, "Archives"),
  );
}

function renderBanners(): void {
  const out: HTMLElement[] = [];
  if (restarted) {
    out.push(h("div", {class: "banner danger", role: "alert"}, h("span", {class: "grow"}, "The board restarted. Reload to continue."), h("button", {class: "btn", onclick: () => location.reload()}, "Reload")));
  }
  if (view.kind === "archive") {
    out.push(h("div", {class: "banner"}, h("span", {class: "grow"}, `Archived board - ${view.snap.title} - ${new Date(view.snap.archivedAt).toLocaleString()}`), h("button", {class: "btn", onclick: backToLive}, "Back to live board")));
  } else if (view.kind === "live" && live && live.tickets.length > 0 && live.tickets.every((t) => t.status === "done")) {
    const busy = live.runs.some((r) => r.status === "pending" || r.status === "running");
    out.push(
      h(
        "div",
        {class: "banner"},
        h("span", {class: "grow"}, `All ${live.tickets.length} tickets are Done.`),
        busy ? h("span", {class: "note"}, "Agent runs still finishing") : null,
        h("button", {class: "btn primary", disabled: busy, onclick: () => void archiveBoard()}, "Archive board"),
        h("button", {class: "btn danger", disabled: busy, onclick: () => void clearBoard()}, "Clear board"),
      ),
    );
  }
  banners.replaceChildren(...out);
}

async function archiveBoard(): Promise<void> {
  if (await act(() => api("POST", "/api/board/archive", {}))) toast("Board archived.", true);
}

async function clearBoard(): Promise<void> {
  if (!(await confirmDialog("Clear removes all tickets, comments, and history. This cannot be undone.", "Clear board", true))) return;
  if (await act(() => api("POST", "/api/board/clear", {}))) toast("Board cleared.", true);
}

async function showArchives(): Promise<void> {
  closeDrawer();
  try {
    archives = await api<ArchiveInfo[]>("GET", "/api/archives");
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) toast(errMsg(e));
    return;
  }
  view = {kind: "archives"};
  renderAll();
}

async function openArchive(id: string): Promise<void> {
  try {
    const snap = await api<ArchiveSnapshot>("GET", "/api/archives/" + encodeURIComponent(id));
    view = {kind: "archive", snap};
    renderAll();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) toast(errMsg(e));
  }
}

function backToLive(): void {
  closeDrawer();
  view = {kind: "live"};
  renderAll();
  void load();
}

// ---------------------------------------------------------------- board

function badge(kind: string, text: string, dot = false): HTMLElement {
  return h("span", {class: kind ? "badge " + kind : "badge"}, dot ? h("span", {class: "dot"}) : null, text);
}

function badgesFor(t: Ticket, ix: Index): HTMLElement[] {
  const out: HTMLElement[] = [];
  const blockers = t.blockedBy.filter((b) => ix.byN.get(b)?.status !== "done");
  if (blockers.length) out.push(badge("warn", "Blocked by " + blockers.map((b) => "T-" + b).join(", ")));
  const bugs = ix.bugs.get(t.n) ?? 0;
  if (bugs) out.push(badge("danger", `${bugs} open bug${bugs === 1 ? "" : "s"}`));
  const runs = ix.runs.get(t.n) ?? [];
  if (runs.some((r) => r.status === "running")) out.push(badge("accent", "Agent working", true));
  const pending = runs.filter((r) => r.status === "pending");
  if (pending.length) {
    const waiting = [...new Set(pending.flatMap((r) => r.waitingFor))];
    out.push(badge("", waiting.length ? "Queued - waiting for " + waiting.map((b) => "T-" + b).join(", ") : "Queued"));
  }
  if ((t.status === "testing" || t.status === "done") && ix.passed.get(t.n)) out.push(badge("ok", "Tests passed"));
  return out;
}

function assigneeLabel(a: Ticket["assignee"]): string {
  return ASSIGNEE_LABEL[a ?? "none"];
}

function endDrag(): void {
  dragN = null;
  dragging = false;
  for (const c of mainEl.querySelectorAll(".column.drop")) c.classList.remove("drop");
  if (renderPending) {
    renderPending = false;
    renderAll();
  }
}

function cardEl(t: Ticket, ix: Index, ro: boolean): HTMLElement {
  const open = () => {
    location.hash = "T-" + t.n;
  };
  const el = h(
    "div",
    {
      class: "card",
      tabindex: 0,
      role: "button",
      draggable: !ro,
      onclick: open,
      onkeydown: (e: KeyboardEvent) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === el) {
          e.preventDefault();
          open();
        }
      },
      ondragstart: (e: DragEvent) => {
        dragN = t.n;
        dragging = true;
        el.classList.add("dragging");
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", "T-" + t.n);
          e.dataTransfer.effectAllowed = "move";
        }
      },
      ondragend: () => {
        el.classList.remove("dragging");
        endDrag();
      },
    },
    h("div", {class: "card-top"}, h("span", {class: "tid"}, "T-" + t.n), h("span", {class: t.assignee ? "chip assignee-" + t.assignee : "chip"}, assigneeLabel(t.assignee))),
    h("div", {class: "card-title"}, t.title),
    h("div", {class: "badges"}, badgesFor(t, ix)),
  );
  return el;
}

function columnEl(s: Status, tickets: Ticket[], ix: Index, ro: boolean): HTMLElement {
  const col = h(
    "section",
    {class: "column", "aria-label": STATUS_LABEL[s]},
    h("div", {class: "column-head"}, h("span", null, STATUS_LABEL[s]), h("span", {class: "count"}, tickets.length)),
    h("div", {class: "column-body"}, tickets.length ? tickets.map((t) => cardEl(t, ix, ro)) : h("div", {class: "empty"}, "No tickets")),
  );
  if (ro) return col;
  col.addEventListener("dragover", (e) => {
    if (dragN === null) return;
    e.preventDefault();
    col.classList.add("drop");
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });
  col.addEventListener("dragleave", (e) => {
    if (!(e.relatedTarget instanceof Node) || !col.contains(e.relatedTarget)) col.classList.remove("drop");
  });
  col.addEventListener("drop", (e) => {
    e.preventDefault();
    const n = dragN;
    endDrag();
    if (n !== null) void moveTicketUi(n, s);
  });
  return col;
}

async function moveTicketUi(n: number, to: Status): Promise<boolean> {
  const d = data();
  const t = d ? ticketNow(n) : undefined;
  if (!d || !t || t.status === to) return false;
  const ix = index(d);
  const bugs = ix.bugs.get(n) ?? 0;
  if (to === "done" && bugs > 0 && !(await confirmDialog(`T-${n} has ${bugs} open bug${bugs === 1 ? "" : "s"}. Move to Done anyway?`, "Move to Done"))) return false;
  if (t.status === "todo") {
    const open = t.blockedBy.filter((b) => ix.byN.get(b)?.status !== "done");
    const names = open.map((b) => `T-${b} (${STATUS_LABEL[ix.byN.get(b)?.status ?? "todo"]})`).join(", ");
    if (open.length && !(await confirmDialog(`T-${n} is blocked by ${names}. Move anyway?`, "Move anyway"))) return false;
  }
  return act(() => api("POST", `/api/tickets/${n}/move`, {to}));
}

function renderMain(): void {
  if (view.kind === "archives") {
    mainEl.replaceChildren(
      h("div", {class: "archives-head"}, h("h2", null, "Archives"), h("button", {class: "btn", onclick: backToLive}, "Back to live board")),
      h(
        "div",
        {class: "archives"},
        archives.length
          ? archives.map((a) =>
              h("button", {class: "archive-card", onclick: () => void openArchive(a.id)}, h("strong", null, a.title), h("span", {class: "meta"}, new Date(a.archivedAt).toLocaleString()), h("span", {class: "meta"}, `${a.ticketCount} ticket${a.ticketCount === 1 ? "" : "s"}`)),
            )
          : h("div", {class: "empty"}, "No archived boards yet."),
      ),
    );
    return;
  }
  const d = data();
  if (!d) {
    mainEl.replaceChildren(h("div", {class: "empty"}, "Loading..."));
    return;
  }
  const ix = index(d);
  const ro = view.kind === "archive";
  const scrollLeft = mainEl.querySelector(".board")?.scrollLeft ?? 0;
  const tops = [...mainEl.querySelectorAll(".column-body")].map((c) => c.scrollTop);
  const board = h(
    "div",
    {class: "board"},
    STATUSES.map((s) =>
      columnEl(
        s,
        d.tickets.filter((t) => t.status === s).sort((a, b) => a.n - b.n),
        ix,
        ro,
      ),
    ),
  );
  mainEl.replaceChildren(board);
  board.scrollLeft = scrollLeft;
  board.querySelectorAll(".column-body").forEach((c, i) => (c.scrollTop = tops[i] ?? 0));
}

function renderAll(): void {
  if (dragging) {
    renderPending = true;
    return;
  }
  renderTop();
  renderBanners();
  renderMain();
  syncHash();
}

// ---------------------------------------------------------------- new ticket modal

function openNewTicket(): void {
  const title = h("input", {type: "text", maxLength: 200, "data-autofocus": "1"});
  const instructions = h("textarea", {rows: 6});
  const pseudocode = h("textarea", {rows: 4});
  const criteria = h("textarea", {rows: 4});
  const blocked = h("input", {type: "text", placeholder: "e.g. 1, 2"});
  const error = h("div", {class: "form-error", role: "alert"});
  const field = (label: string, control: Node) => h("label", {class: "field"}, h("span", null, label), control);
  const body = h("div", null, field("Title", title), field("Instructions", instructions), field("Pseudocode", pseudocode), field("Acceptance criteria (one per line)", criteria), field("Blocked by (comma-separated ticket numbers)", blocked), error);
  const cancel = h("button", {class: "btn", onclick: () => close()}, "Cancel");
  const create = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        error.textContent = "";
        create.disabled = true;
        try {
          await api("POST", "/api/tickets", {
            title: title.value.trim(),
            instructions: instructions.value,
            pseudocode: pseudocode.value,
            acceptanceCriteria: criteria.value.split("\n").map((s) => s.trim()).filter(Boolean),
            blockedBy: parseTicketNumbers(blocked.value),
          });
          close();
          await load();
        } catch (e) {
          error.textContent = errMsg(e);
        } finally {
          create.disabled = false;
        }
      },
    },
    "Create ticket",
  );
  const close = openModal("New ticket", body, [cancel, create]);
}

// ---------------------------------------------------------------- drawer

interface Sec {
  el: HTMLElement;
  refresh(t: Ticket): void;
}

interface SecSpec {
  label: string;
  rows: number;
  hint?: string;
  view(t: Ticket): Node;
  initial(t: Ticket): string;
  save(text: string): Promise<unknown>;
}

interface Drawer {
  n: number;
  el: HTMLElement;
  backdrop: HTMLElement;
  panel: HTMLElement;
  tabsEl: HTMLElement;
  tab: Tab;
  refreshHead(t: Ticket): void;
  secs: Sec[];
  prev: Element | null;
}
let drawer: Drawer | null = null;

function makeSection(spec: SecSpec, ro: boolean): Sec {
  let editing = false;
  let current: Ticket | null = null;
  const body = h("div", {class: "sec-body"});
  const editBtn = h("button", {class: "btn small", hidden: ro, onclick: () => ((editing = true), render())}, "Edit");
  const el = h("section", {class: "section"}, h("div", {class: "sec-head"}, h("h3", null, spec.label), editBtn), body);

  function render(): void {
    if (!current) return;
    body.replaceChildren();
    editBtn.hidden = ro || editing;
    if (!editing) {
      body.append(spec.view(current));
      return;
    }
    const field = spec.rows > 1 ? h("textarea", {rows: spec.rows, "aria-label": spec.label}) : h("input", {type: "text", "aria-label": spec.label});
    field.value = spec.initial(current);
    field.addEventListener("keydown", (e: Event) => {
      if ((e as KeyboardEvent).key !== "Escape") return;
      e.stopPropagation();
      editing = false;
      render();
    });
    const save = h(
      "button",
      {
        class: "btn primary small",
        onclick: async () => {
          save.disabled = true;
          const ok = await act(() => spec.save(field.value));
          save.disabled = false;
          if (ok) {
            editing = false;
            render();
          }
        },
      },
      "Save",
    );
    const cancel = h("button", {class: "btn small", onclick: () => ((editing = false), render())}, "Cancel");
    body.append(field, ...(spec.hint ? [h("div", {class: "muted"}, spec.hint)] : []), h("div", {class: "row"}, save, cancel));
    field.focus();
  }

  return {
    el,
    refresh(t) {
      current = t;
      if (!editing) render();
    },
  };
}

function sectionSpecs(n: number): SecSpec[] {
  const patch = (body: Record<string, unknown>) => api("PATCH", `/api/tickets/${n}`, body);
  return [
    {label: "Instructions", rows: 10, view: (t) => (t.instructions.trim() ? mdEl(t.instructions) : none()), initial: (t) => t.instructions, save: async (text) => patch({instructions: text})},
    {label: "Pseudocode", rows: 8, view: (t) => (t.pseudocode.trim() ? h("pre", {class: "pseudo"}, t.pseudocode) : none()), initial: (t) => t.pseudocode, save: async (text) => patch({pseudocode: text})},
    {
      label: "Acceptance criteria",
      rows: 5,
      hint: "One criterion per line",
      view: (t) => (t.acceptanceCriteria.length ? h("ol", {class: "criteria"}, t.acceptanceCriteria.map((c) => h("li", null, c))) : none()),
      initial: (t) => t.acceptanceCriteria.join("\n"),
      save: async (text) => patch({acceptanceCriteria: text.split("\n").map((s) => s.trim()).filter(Boolean)}),
    },
    {
      label: "Blocked by",
      rows: 1,
      hint: "Comma-separated ticket numbers",
      view: (t) => {
        const d = data();
        const ix = d ? index(d) : null;
        return t.blockedBy.length
          ? h(
              "div",
              {class: "chips"},
              t.blockedBy.map((b) => {
                const bt = ix?.byN.get(b);
                return h("button", {class: bt ? "chip s-" + bt.status : "chip", title: bt ? `${bt.title} (${STATUS_LABEL[bt.status]})` : "unknown ticket", onclick: () => (location.hash = "T-" + b)}, "T-" + b);
              }),
            )
          : none();
      },
      initial: (t) => t.blockedBy.join(", "),
      save: async (text) => patch({blockedBy: parseTicketNumbers(text)}),
    },
  ];
}

function showDrawer(n: number): void {
  if (drawer?.n === n) {
    updateDrawer();
    return;
  }
  removeDrawer(false);
  const ro = view.kind === "archive";
  const titleIn = h("input", {
    type: "text",
    class: "title-input",
    "aria-label": "Title",
    readOnly: ro,
    onblur: () => {
      const t = ticketNow(n);
      const v = titleIn.value.trim();
      if (!t) return;
      if (v === t.title) titleIn.value = t.title;
      else if (!ro) void act(() => api("PATCH", `/api/tickets/${n}`, {title: v}));
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") titleIn.blur();
      else if (e.key === "Escape") {
        e.stopPropagation();
        titleIn.value = ticketNow(n)?.title ?? titleIn.value;
        titleIn.blur();
      }
    },
  });
  const statusEl: HTMLElement = ro
    ? h("span", {class: "chip"})
    : h("select", {"aria-label": "Status", onchange: () => void moveTicketUi(n, statusEl instanceof HTMLSelectElement ? (statusEl.value as Status) : "todo").then((ok) => ok || updateDrawer())}, STATUSES.map((s) => h("option", {value: s}, STATUS_LABEL[s])));
  const assigneeEl: HTMLElement = ro
    ? h("span", {class: "chip"})
    : h(
        "select",
        {
          "aria-label": "Assignee",
          onchange: () => {
            const v = assigneeEl instanceof HTMLSelectElement ? assigneeEl.value : "";
            void act(() => api("PATCH", `/api/tickets/${n}`, {assignee: v === "" ? null : v}));
          },
        },
        h("option", {value: ""}, ASSIGNEE_LABEL.none),
        h("option", {value: "user"}, ASSIGNEE_LABEL.user),
        h("option", {value: "agent"}, ASSIGNEE_LABEL.agent),
      );
  const secs = sectionSpecs(n).map((s) => makeSection(s, ro));
  const panel = h("div", {class: "panel", role: "tabpanel"});
  const tabsEl = h("div", {class: "tabs", role: "tablist"});
  const closeBtn = h("button", {class: "btn small", "aria-label": "Close", onclick: closeDrawer}, "Close");
  const backdrop = h("div", {class: "backdrop", onclick: closeDrawer});
  const el = h(
    "aside",
    {class: "drawer", role: "dialog", "aria-label": "Ticket T-" + n},
    h(
      "div",
      {class: "drawer-head"},
      h("div", {class: "drawer-row"}, h("span", {class: "tid"}, "T-" + n), titleIn, closeBtn),
      h("div", {class: "drawer-row"}, h("label", null, "Status", statusEl), h("label", null, "Assignee", assigneeEl)),
    ),
    h("div", {class: "drawer-body"}, secs.map((s) => s.el), tabsEl, panel),
  );
  const dr: Drawer = {
    n,
    el,
    backdrop,
    panel,
    tabsEl,
    tab: "comments",
    secs,
    prev: document.activeElement,
    refreshHead(t) {
      if (document.activeElement !== titleIn) titleIn.value = t.title;
      if (statusEl instanceof HTMLSelectElement) statusEl.value = t.status;
      else statusEl.textContent = STATUS_LABEL[t.status];
      if (assigneeEl instanceof HTMLSelectElement) assigneeEl.value = t.assignee ?? "";
      else assigneeEl.textContent = assigneeLabel(t.assignee);
    },
  };
  for (const [id, label] of TABS) {
    tabsEl.append(
      h("button", {class: "tab", role: "tab", "data-tab": id, onclick: () => ((dr.tab = id), renderPanel())}, label),
    );
  }
  drawer = dr;
  drawerHost.append(backdrop, el);
  void el.offsetWidth; // commit the closed position so the slide-in transition runs
  el.classList.add("open");
  updateDrawer();
}

function removeDrawer(restoreFocus: boolean): void {
  const dr = drawer;
  if (!dr) return;
  drawer = null;
  dr.el.remove();
  dr.backdrop.remove();
  if (restoreFocus && dr.prev instanceof HTMLElement && dr.prev.isConnected) dr.prev.focus();
}

function closeDrawer(): void {
  removeDrawer(true);
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function syncHash(): void {
  const m = /^#T-(\d+)$/.exec(location.hash);
  if (!m) {
    removeDrawer(false);
    return;
  }
  const d = data();
  if (!d) return;
  const n = Number(m[1]);
  if (!d.tickets.some((t) => t.n === n)) closeDrawer();
  else showDrawer(n);
}

function updateDrawer(): void {
  const dr = drawer;
  if (!dr || !data()) return;
  const t = ticketNow(dr.n);
  if (!t) {
    closeDrawer();
    return;
  }
  dr.refreshHead(t);
  for (const s of dr.secs) s.refresh(t);
  renderPanel();
}

function renderPanel(): void {
  const dr = drawer;
  const d = data();
  if (!dr || !d) return;
  const ix = index(d);
  const ro = view.kind === "archive";
  const active = document.activeElement;
  let focusKey: string | undefined;
  let selStart = 0;
  let selEnd = 0;
  if (active instanceof HTMLTextAreaElement && dr.panel.contains(active) && active.dataset.draft) {
    focusKey = active.dataset.draft;
    selStart = active.selectionStart;
    selEnd = active.selectionEnd;
  }
  for (const b of dr.tabsEl.children) b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === dr.tab));
  dr.panel.replaceChildren(dr.tab === "comments" ? commentsPanel(dr.n, ix, ro) : dr.tab === "runs" ? runsPanel(dr.n, ix, ro) : historyPanel(dr.n, d));
  if (focusKey !== undefined) {
    const ta = focusDraft(focusKey);
    ta?.setSelectionRange(selStart, selEnd);
  }
}

function focusDraft(key: string): HTMLTextAreaElement | null {
  for (const ta of drawer?.panel.querySelectorAll("textarea") ?? []) {
    if (ta.dataset.draft === key) {
      ta.focus();
      return ta;
    }
  }
  return null;
}

// ---------------------------------------------------------------- comments tab

function authorLabel(c: Comment): string {
  if (c.author === "user") return "You";
  if (c.author === "system") return "Board";
  return c.role ? "Agent - " + c.role : "Agent";
}

function commentEl(c: Comment): HTMLElement {
  const pills: HTMLElement[] = [];
  if (c.kind === "bug" && c.bugStatus) {
    const kind = c.bugStatus === "open" ? "danger" : c.bugStatus === "fixed" ? "ok" : "";
    pills.push(h("span", {class: kind ? "pill " + kind : "pill"}, "Bug - " + c.bugStatus[0]!.toUpperCase() + c.bugStatus.slice(1)));
  }
  if (c.kind === "test_run") pills.push(h("span", {class: c.passed ? "pill ok" : "pill danger"}, c.passed ? "Tests passed" : "Tests failed"));
  return h(
    "div",
    {class: "comment" + (c.kind === "bug" ? " bug" : "") + (c.author === "system" ? " system" : "")},
    h("div", {class: "comment-head"}, h("span", {class: "who"}, authorLabel(c)), h("time", {title: new Date(c.createdAt).toLocaleString()}, relTime(c.createdAt)), pills),
    mdEl(c.body),
  );
}

function composer(key: string, placeholder: string, label: string, onSend: (body: string) => Promise<boolean>, onCancel?: () => void): HTMLElement {
  const ta = h("textarea", {rows: 3, placeholder, "aria-label": placeholder, "data-draft": key});
  ta.value = drafts.get(key) ?? "";
  ta.addEventListener("input", () => drafts.set(key, ta.value));
  const send = h("button", {class: "btn primary small", onclick: () => void submit()}, label);
  async function submit(): Promise<void> {
    const body = ta.value.trim();
    if (!body) return;
    send.disabled = true;
    drafts.delete(key);
    const ok = await onSend(body);
    send.disabled = false;
    if (!ok) {
      drafts.set(key, body);
      updateDrawer();
    }
  }
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });
  return h("div", {class: "composer"}, ta, h("div", {class: "row"}, send, onCancel ? h("button", {class: "btn small", onclick: onCancel}, "Cancel") : null, h("span", {class: "hint"}, "Ctrl+Enter sends")));
}

function postComment(n: number, body: string, replyTo?: number): Promise<boolean> {
  return act(() => api("POST", `/api/tickets/${n}/comments`, replyTo === undefined ? {body} : {body, replyTo}));
}

function commentsPanel(n: number, ix: Index, ro: boolean): HTMLElement {
  const list = ix.comments.get(n) ?? [];
  const ids = new Set(list.map((c) => c.id));
  const replies = new Map<number, Comment[]>();
  const roots: Comment[] = [];
  for (const c of list) {
    if (c.replyTo !== null && ids.has(c.replyTo)) push(replies, c.replyTo, c);
    else roots.push(c);
  }
  const threads = roots.map((r) => {
    const key = `${n}:${r.id}`;
    const reps = replies.get(r.id) ?? [];
    let actions: Node | null = null;
    if (!ro) {
      actions = openReply.has(key)
        ? composer(
            key,
            "Reply in this thread",
            "Reply",
            async (body) => {
              openReply.delete(key);
              const ok = await postComment(n, body, r.id);
              if (!ok) openReply.add(key);
              return ok;
            },
            () => {
              openReply.delete(key);
              renderPanel();
            },
          )
        : h(
            "button",
            {
              class: "btn link",
              onclick: () => {
                openReply.add(key);
                renderPanel();
                focusDraft(key);
              },
            },
            "Reply",
          );
    }
    return h("div", {class: "thread"}, commentEl(r), reps.length ? h("div", {class: "replies"}, reps.map(commentEl)) : null, actions ? h("div", {class: "thread-actions"}, actions) : null);
  });
  return h("div", null, threads.length ? threads : h("div", {class: "muted"}, "No comments yet."), ro ? null : composer(`${n}:new`, "Write a comment", "Comment", (body) => postComment(n, body)));
}

// ---------------------------------------------------------------- runs and history tabs

function openLog(run: RunView): void {
  const path = view.kind === "archive" ? `/api/archives/${encodeURIComponent(view.snap.id)}/runs/${encodeURIComponent(run.id)}/log` : `/api/runs/${encodeURIComponent(run.id)}/log`;
  const pre = h("pre", {class: "log"}, "Loading...");
  const refresh = async () => {
    try {
      pre.textContent = (await apiText(path)) || "(log is empty)";
      pre.scrollTop = pre.scrollHeight;
    } catch (e) {
      pre.textContent = errMsg(e);
    }
  };
  const close = openModal(`Log ${run.id}`, pre, [h("button", {class: "btn", onclick: () => void refresh()}, "Refresh"), h("button", {class: "btn primary", "data-autofocus": "1", onclick: () => close()}, "Close")], {wide: true});
  void refresh();
}

function runsPanel(n: number, ix: Index, ro: boolean): HTMLElement {
  const t = ix.byN.get(n);
  const runs = [...(ix.runs.get(n) ?? [])].sort((a, b) => Number(b.id.slice(2)) - Number(a.id.slice(2)));
  const busy = runs.some((r) => (r.role === "coder" || r.role === "tester") && (r.status === "pending" || r.status === "running"));
  const canRestart = !ro && !!t && !busy && (t.status === "testing" || ((t.status === "todo" || t.status === "in_progress") && t.assignee === "agent"));
  const rows = runs.map((r) => {
    const kind = r.status === "succeeded" ? "ok" : r.status === "failed" || r.status === "timeout" || r.status === "lost" ? "danger" : r.status === "running" ? "accent" : "";
    const dur = r.startedAt === null ? "not started" : fmtDur((r.endedAt ?? Date.now()) - r.startedAt);
    const active = r.status === "pending" || r.status === "running";
    return h(
      "div",
      {class: "run"},
      h(
        "div",
        {class: "run-top"},
        h("span", {class: "label"}, `${r.id} - ${r.role} - ${r.mode} - ${r.status} - ${dur}`),
        h("span", {class: kind ? "pill " + kind : "pill"}, r.status),
        h("button", {class: "btn small", onclick: () => openLog(r)}, "View log"),
        !ro && active ? h("button", {class: "btn small danger", onclick: () => void act(() => api("POST", `/api/runs/${encodeURIComponent(r.id)}/cancel`, {}))}, "Stop") : null,
      ),
      r.status === "pending" && r.waitingFor.length ? h("div", {class: "note"}, "waiting for " + r.waitingFor.map((b) => "T-" + b).join(", ")) : null,
      r.note ? h("div", {class: "note"}, r.note) : null,
    );
  });
  return h(
    "div",
    null,
    canRestart ? h("div", {class: "run"}, h("div", {class: "run-top"}, h("span", {class: "label"}, "No agent is working on this ticket."), h("button", {class: "btn small primary", onclick: () => void act(() => api("POST", `/api/tickets/${n}/restart`, {}))}, "Restart agent"))) : null,
    rows.length ? rows : h("div", {class: "muted"}, "No agent runs yet."),
  );
}

function historyPanel(n: number, d: Data): HTMLElement {
  const entries = d.history.filter((e) => e.ticket === n).reverse();
  if (!entries.length) return h("div", {class: "muted"}, "No history yet.");
  return h(
    "div",
    {class: "hist"},
    entries.map((e) => [
      h("span", {class: "t"}, new Date(e.at).toLocaleString()),
      h("span", {class: "a"}, e.actor === "user" ? "You" : e.actor === "agent" ? "Agent" + (e.runId ? " " + e.runId : "") : "Board"),
      h("span", null, e.action + (e.detail ? ": " + e.detail : "")),
    ]),
  );
}

// ---------------------------------------------------------------- start

setUnauthorizedHandler(() => {
  restarted = true;
  renderBanners();
});
window.addEventListener("hashchange", syncHash);
renderAll();
connect();
void load();
