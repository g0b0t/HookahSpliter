const STORAGE_KEY = "hookahSpliterStateV2";
const MAX_COST_DIGITS = 5;
const MAX_COST_VALUE = Number("9".repeat(MAX_COST_DIGITS));
const API_BASE = "";
const SYNC_DEBOUNCE_MS = 800;
let clientRev = 0;

function getInitDataRaw() {
  // 1) Нормальный путь: Telegram SDK
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && tg.initData.includes("hash=")) return tg.initData;

  // 2) Fallback: иногда Telegram кладёт initData в #tgWebAppData=...
  // Там он ДВОЙНО закодирован, поэтому один раз декодируем,
  // чтобы получить СЫРОЕ (с %xx) initData.
  const h = typeof location !== "undefined" ? (location.hash || "") : "";
  const m = h.match(/(?:^|[&#])tgWebAppData=([^&]+)/);
  if (m) {
    try { 
      const raw = decodeURIComponent(m[1]);  // даёт строку вида user=%7B...%7D&auth_date=...&hash=...
      if (raw.includes("hash=")) return raw;
    } catch {}
    if (m[1].includes("hash=")) return m[1];
  }
  return "";
}

// === Telegram globals for reuse ===
window.tg = window.Telegram?.WebApp || null;
try { window.tg?.ready?.(); } catch {}
window.initDataUnsafe = window.tg?.initDataUnsafe || null;
// cache once; still can be recomputed via getInitDataRaw() if needed
window.initDataRaw = (typeof window !== "undefined") ? (getInitDataRaw() || "") : "";

async function pullStateFromCloud() {
  try {
    const res = await fetch(`/state`, { credentials: "include" });
    if (!res.ok) return;
    const server = await res.json();
    clientRev = server._rev || 0;

    const local = loadState?.() || {};
    const merged = {
      ...server,
      people: Array.isArray(server.people) ? server.people : (local.people || []),
    };
    saveStateLocalOnly(merged);
    return merged;
  } catch (e) { console.warn("pullStateFromCloud failed", e); }
}

const pushStateDebounced = (() => {
  let t = null;
  return (state) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const r = await fetch(`/state`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, clientRev }),
        });
        if (r.status === 409) {
          const body = await r.json();
          clientRev = body.server?._rev || 0;
          saveState(body.server);
          window.app && window.app.renderAll && window.app.renderAll();
        } else if (r.ok) {
          const body = await r.json();
          clientRev = body.state?._rev || clientRev;
        }
      } catch (e) { console.warn("pushState failed", e); }
    }, SYNC_DEBOUNCE_MS);
  };
})();

async function saveSessionToCloud(fullSession) {
  try {
    const r = await fetch(`/sessions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullSession),
    });
    if (!r.ok) {
      console.warn("saveSessionToCloud failed:", r.status, await r.text());
    }
  } catch (e) {
    console.warn("saveSessionToCloud error:", e);
  }
}

function flushStateToCloudKeepalive() {
  try {
    const s = loadState();
    fetch('/state', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: s, clientRev }),
      keepalive: true,
    }).catch(() => { });
  } catch { }
}

const createInitialState = () => ({
  settings: {
    defaultBowlCost: 500,
    theme: "system",           // system | light | dark
  },
  people: [],
  currentSession: null,
  savedSessions: [],
  historyFilters: {
    searchTerm: "",
    date: "",
    sortBy: "date",
  },
  historyView: "history", // history | stats
});

const loadState = () => {
  if (typeof window === "undefined") {
    return createInitialState();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    return {
      settings: {
        defaultBowlCost: Number.isFinite(parsed?.settings?.defaultBowlCost)
          ? parsed.settings.defaultBowlCost
          : 500,
        theme: parsed?.settings?.theme || "system",
      },
      people: Array.isArray(parsed.people) ? parsed.people : [],
      savedSessions: Array.isArray(parsed.savedSessions) ? parsed.savedSessions : [],
      currentSession: parsed.currentSession || null,
      historyFilters: {
        searchTerm: parsed?.historyFilters?.searchTerm || "",
        date: parsed?.historyFilters?.date || "",
        sortBy: parsed?.historyFilters?.sortBy || "date",
      },
      historyView: parsed?.historyView === "stats" ? "stats" : "history",
    };
  } catch (error) {
    console.warn("Не удалось прочитать сохранённое состояние", error);
    return createInitialState();
  }
};

// 1) БАЗОВОЕ сохранение в localStorage
function saveState(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("saveState localStorage error:", e);
  }
}

// 2) Указатель на базовую реализацию + "только локально"
const _origSaveState = saveState;
function saveStateLocalOnly(s) { _origSaveState(s); }

// 3) Обновляем saveState: локально + дебаунс-пуш в KV
saveState = (state) => {
  saveStateLocalOnly(state);
  pushStateDebounced(state);
};

async function loadSessionsFromCloud() {
  try {
    const r = await fetch(`/sessions`, { credentials: "include" });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) {
    console.warn("loadSessionsFromCloud failed", e);
    return [];
  }
}

async function loadSessionFromCloud(id) {
  const r = await fetch(`/sessions/${id}`, { credentials: "include" });
  return r.ok ? r.json() : { ok: false };
}

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getDefaultSessionName = () => {
  const now = new Date();
  return `Вечер ${now.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  })}`;
};

const formatCurrency = (value) => `${Math.round(value || 0).toLocaleString("ru-RU")} ₽`;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDateTime = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  return `${date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })} ${date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const formatDateRange = (start, end) => {
  const startText = formatDateTime(start);
  const endText = formatDateTime(end);
  if (!startText && !endText) return "";
  if (!endText) return startText;
  return `${startText} — ${endText}`;
};

// Отправляем initData на бэкенд, без UI «добро пожаловать»
async function initTelegramAuth() {
  try {
    await new Promise(r => setTimeout(r, 30));
    const initData = window.initDataRaw || getInitDataRaw();
    if (!initData || !initData.includes("hash=")) {
      console.info("[auth] skip: empty initData");
      return;
    }
    const res = await fetch(`/auth/telegram`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    console.info("[auth] /auth/telegram ->", res.status);
  } catch (err) {
    console.warn("[auth] error:", err);
  }
}

async function pingBackend() {
  try {
    const r = await fetch('/ping', { cache: 'no-store', credentials: 'include' });
    backendOnline = r.ok;
  } catch {
    backendOnline = false;
  }
}

// === User chip (аватар + ник @handle в табе) ===
let backendOnline = false;

function autoFitFont(textEl, container) {
  if (!textEl || !container) return;
  const min = Number(textEl.dataset.minFont || 10);
  const max = Number(textEl.dataset.maxFont || 14);
  let size = max;
  textEl.style.fontSize = size + 'px';
  // небольшая подстраховка на паддинги/иконки
  const pad = 8;
  const maxWidth = container.clientWidth - pad;
  while (size > min && textEl.scrollWidth > maxWidth) {
    size -= 0.5;
    textEl.style.fontSize = size + 'px';
  }
}

function setUserChip({ username, photoUrl, online }) {
  const avatar = document.querySelector('#tab-user .user-avatar');
  const handle = document.querySelector('#tab-user .user-handle');
  const fallback = document.querySelector('#tab-user .avatar-fallback');
  if (!avatar && !handle) return;

  if (handle) {
    if (online && username) {
      handle.textContent = '@' + username;
    } else {
      handle.textContent = 'Гость';
    }
  }

  if (avatar) {
    if (online && photoUrl) {
      avatar.src = photoUrl;
      avatar.hidden = false;
    } else {
      avatar.removeAttribute('src');
      avatar.hidden = true;
    }
  }

  if (fallback) {
    fallback.hidden = Boolean(avatar && !avatar.hidden);
  }

  if (handle) autoFitFont(handle, handle.parentElement || handle);
  // обновим позицию индикатора вкладок, если есть
  try { window.dispatchEvent(new Event('resize')); } catch {}
}

function getTgUser() {
  return window.tg?.initDataUnsafe?.user || null;
}

async function initUserHeader() {
  await pingBackend();
  if (!backendOnline) {
    setUserChip({ username: null, photoUrl: null, online: false });
    return;
  }
  const user = getTgUser();
  const username = user?.username || null;
  const photoUrl = user?.photo_url || null;

  console.info('[chip]', { backendOnline, tgUser: getTgUser() });

  setUserChip({ username, photoUrl, online: true });
}

function mergePeopleByName(serverArr, localArr) {
  const map = new Map();
  [...serverArr, ...localArr].forEach(p => {
    const key = (p.name || "").trim().toLowerCase();
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...p });
    } else {
      map.set(key, {
        ...prev,
        id: prev.id || p.id,
        name: prev.name || p.name,
      });
    }
  });
  return [...map.values()];
}

function getEffectiveTheme(choice) {
  if (choice === "dark") return "dark";
  if (choice === "light") return "light";
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

const TELEGRAM_THEME_COLORS = {
  light: "#f5f6f8",
  dark: "#000000",
};

function syncTelegramTheme(mode) {
  const tg = window.tg;
  if (!tg) return;
  const color = TELEGRAM_THEME_COLORS[mode] || TELEGRAM_THEME_COLORS.light;
  try {
    tg.setHeaderColor?.(color);
    tg.setBackgroundColor?.(color);
    tg.setBottomBarColor?.(color);
  } catch {}
}

function applyTheme(choice) {
  const mode = getEffectiveTheme(choice || "system");
  document.documentElement.setAttribute("data-theme", mode);
  document.body && document.body.setAttribute("data-theme", mode);
  syncTelegramTheme(mode);
}

class HookahSpliterApp {
  constructor() {
    this.state = loadState();

    // апгрейд старого состояния
    this.state.settings = this.state.settings || {};
    if (!("theme" in this.state.settings)) this.state.settings.theme = "system";
    if (!this.state.historyFilters) {
      this.state.historyFilters = { searchTerm: "", date: "", sortBy: "date" };
    }
    if (!this.state.historyView) {
      this.state.historyView = "history";
    }

    // применяем тему сразу
    applyTheme(this.state.settings.theme);

    this.elements = {
      sessionPane: document.getElementById("sessionPane"),
      peoplePane: document.getElementById("peoplePane"),
      settingsPane: document.getElementById("settingsPane"),
      historyPane: document.getElementById("historyPane"),
    };

    // если пользователь переключит системную тему — обновим UI
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (this.state.settings.theme === "system") applyTheme("system");
      });
    }

    this.renderAll();
  }

  persistAndRender() {
    saveState(this.state);
    this.renderAll();
  }

  showValidationMessage(element, message) {
    if (!element) {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(message);
      }
      return;
    }
    element.setCustomValidity(message);
    element.reportValidity();
    window.setTimeout(() => element.setCustomValidity(""), 0);
  }

  validateCostValue(rawValue, inputElement) {
    const trimmed = String(rawValue ?? "").trim();
    if (!trimmed) {
      this.showValidationMessage(inputElement, "Введите стоимость, используя только цифры.");
      return null;
    }
    if (!/^\d+$/.test(trimmed)) {
      this.showValidationMessage(inputElement, "Можно вводить только цифры без пробелов и символов.");
      return null;
    }
    if (trimmed.length > MAX_COST_DIGITS) {
      this.showValidationMessage(
        inputElement,
        `Стоимость не может содержать более ${MAX_COST_DIGITS} цифр (максимум ${MAX_COST_VALUE}).`
      );
      return null;
    }
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      this.showValidationMessage(inputElement, "Стоимость должна быть положительным числом.");
      return null;
    }
    if (numericValue > MAX_COST_VALUE) {
      this.showValidationMessage(
        inputElement,
        `Стоимость не может превышать ${MAX_COST_VALUE}.`
      );
      return null;
    }
    return numericValue;
  }

  enforceCostInputConstraints(inputElement) {
    if (!inputElement) return;
    const raw = String(inputElement.value ?? "");
    if (!raw) {
      inputElement.value = "";
      return;
    }
    const digitsOnly = raw.replace(/\D+/g, "");
    let sanitized = digitsOnly;
    let message = "";

    if (digitsOnly !== raw) {
      message = "Можно вводить только цифры без пробелов и символов.";
    }

    if (sanitized.length > MAX_COST_DIGITS) {
      sanitized = sanitized.slice(0, MAX_COST_DIGITS);
      message = `Стоимость не может содержать более ${MAX_COST_DIGITS} цифр (максимум ${MAX_COST_VALUE}).`;
    }

    if (sanitized !== raw) {
      inputElement.value = sanitized;
    }

    if (message) {
      this.showValidationMessage(inputElement, message);
    }
  }

  setupCostInput(inputElement, initialValue, commitCallback) {
    if (!inputElement) return;
    const normalizedInitialValue = initialValue == null ? "" : String(initialValue);
    inputElement.dataset.lastValidValue = normalizedInitialValue;
    inputElement.addEventListener("input", (event) => {
      this.enforceCostInputConstraints(event.target);
    });
    inputElement.addEventListener("blur", (event) => {
      const target = event.target;
      const ok = commitCallback?.(target);
      if (ok === false) {
        // вернуть предыдущее валидное значение
        const last = target.dataset.lastValidValue ?? "";
        target.value = last;
        return;
      }
      target.dataset.lastValidValue = target.value;
    });
  }

  renderAll() {
    this.renderSessionPane();
    this.renderPeoplePane();
    this.renderSettingsPane();
    this.renderHistoryPane();
  }

  getPersonMap() {
    return new Map(this.state.people.map((person) => [person.id, person]));
  }

  ensureActiveBowl(session) {
    if (!session) return null;
    let bowl = session.bowls.find((b) => b.id === session.activeBowlId);
    if (!bowl && session.bowls.length) {
      bowl = session.bowls[0];
      session.activeBowlId = bowl.id;
    }
    return bowl || null;
  }

  startSession(name) {
    const trimmed = (name || "").trim() || getDefaultSessionName();
    const firstBowlId = createId();
    this.state.currentSession = {
      id: createId(),
      name: trimmed,
      startedAt: new Date().toISOString(),
      endedAt: null,
      isActive: true,
      bowls: [
        {
          id: firstBowlId,
          name: "Чаша 1",
          cost: this.state.settings.defaultBowlCost,
          participantIds: [],
        },
      ],
      activeBowlId: firstBowlId,
    };
    this.persistAndRender();
  }

  async endSession() {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;

    const endedAt = new Date().toISOString();
    const summary = this.computeSummary(session);
    const totalCost = session.bowls.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    const full = {
      id: session.id,
      title: session.name || `Сессия ${new Date().toLocaleString()}`,
      startedAt: session.startedAt,
      endedAt,
      people: this.state.people,
      bowls: session.bowls,
      totalCost,
      summary: summary.rows,
    };

    await saveSessionToCloud(full);

    const personMap = this.getPersonMap();

    const historyEntry = {
      id: session.id,
      name: session.name,
      startedAt: session.startedAt,
      endedAt,
      bowlCount: session.bowls.length,
      totalCost: session.bowls.reduce((sum, bowl) => sum + (Number(bowl.cost) || 0), 0),
      summary: summary.rows,
      bowls: session.bowls.map((bowl) => ({
        name: bowl.name,
        cost: bowl.cost,
        participants: bowl.participantIds
          .map((id) => personMap.get(id)?.name)
          .filter(Boolean),
      })),
    };

    this.state.savedSessions.unshift(historyEntry);

    session.isActive = false;
    session.endedAt = endedAt;

    this.persistAndRender();
  }

  deleteSavedSession(sessionId) {
    this.state.savedSessions = this.state.savedSessions.filter(
      (session) => session.id !== sessionId,
    );
    this.persistAndRender();
  }

  addBowl() {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;

    const bowlIndex = session.bowls.length + 1;
    const previousBowl = this.ensureActiveBowl(session);
    const newBowlId = createId();
    session.bowls.push({
      id: newBowlId,
      name: `Чаша ${bowlIndex}`,
      cost: this.state.settings.defaultBowlCost,
      participantIds: previousBowl ? [...previousBowl.participantIds] : [],
    });
    session.activeBowlId = newBowlId;
    this.persistAndRender();
  }

  selectBowl(bowlId) {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;
    session.activeBowlId = bowlId;
    this.persistAndRender();
  }

  updateSessionName(name) {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;
    const trimmed = (name || "").trim();
    session.name = trimmed || session.name || getDefaultSessionName();
    this.persistAndRender();
  }

  updateBowlName(bowlId, name) {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;
    const bowl = session.bowls.find((b) => b.id === bowlId);
    if (!bowl) return;
    const trimmed = (name || "").trim();
    bowl.name = trimmed || bowl.name || "Чаша";
    this.persistAndRender();
  }

  updateBowlCost(bowlId, costValue, inputElement) {
    const session = this.state.currentSession;
    if (!session) return false;
    const bowl = session.bowls.find((b) => b.id === bowlId);
    if (!bowl) return false;
    const value = this.validateCostValue(costValue, inputElement);
    if (value === null) {
      return false;
    }
    bowl.cost = value;
    this.persistAndRender();
    return true;
  }

  addParticipantByName(name) {
    const session = this.state.currentSession;
    const bowl = this.ensureActiveBowl(session);
    if (!session || !session.isActive || !bowl) return;

    const trimmed = (name || "").trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();
    let person = this.state.people.find((p) => p.name.toLowerCase() === lower);
    if (!person) {
      person = { id: createId(), name: trimmed };
      this.state.people.push(person);
      this.state.people.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }

    if (!bowl.participantIds.includes(person.id)) {
      bowl.participantIds.push(person.id);
    }

    this.persistAndRender();
  }

  removeParticipant(personId) {
    const session = this.state.currentSession;
    const bowl = this.ensureActiveBowl(session);
    if (!session || !bowl) return;
    bowl.participantIds = bowl.participantIds.filter((id) => id !== personId);
    this.persistAndRender();
  }

  quickAddParticipant(personId) {
    const session = this.state.currentSession;
    const bowl = this.ensureActiveBowl(session);
    if (!session || !session.isActive || !bowl) return;
    if (!bowl.participantIds.includes(personId)) {
      bowl.participantIds.push(personId);
      this.persistAndRender();
    }
  }

  updateDefaultBowlCost(costValue, inputElement) {
    const value = this.validateCostValue(costValue, inputElement);
    if (value === null) {
      return false;
    }
    this.state.settings.defaultBowlCost = value;
    const session = this.state.currentSession;
    if (session && session.isActive) {
      const bowl = this.ensureActiveBowl(session);
      if (bowl && bowl.cost === undefined) {
        bowl.cost = value;
      }
    }
    this.persistAndRender();
    return true;
  }

  updatePersonName(personId, name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const person = this.state.people.find((p) => p.id === personId);
    if (!person) return;
    person.name = trimmed;
    this.state.people.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    this.persistAndRender();
  }

  deletePerson(personId) {
    this.state.people = this.state.people.filter((p) => p.id !== personId);
    const session = this.state.currentSession;
    if (session) {
      session.bowls.forEach((bowl) => {
        bowl.participantIds = bowl.participantIds.filter((id) => id !== personId);
      });
    }
    this.persistAndRender();
  }

  addPersonFromPeopleTab(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    if (this.state.people.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    this.state.people.push({ id: createId(), name: trimmed });
    this.state.people.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    this.persistAndRender();
  }

  computeSummary(session) {
    if (!session) {
      return { rows: [], total: 0, bowls: [] };
    }
    const personMap = this.getPersonMap();
    const summaryMap = new Map();
    let totalCost = 0;

    session.bowls.forEach((bowl) => {
      const participants = bowl.participantIds.map((id) => personMap.get(id)).filter(Boolean);
      const cost = Math.max(0, Math.round(Number(bowl.cost) || 0));
      totalCost += cost;
      if (!participants.length || cost === 0) {
        return;
      }

      const baseShare = Math.floor(cost / participants.length);
      let remainder = cost - baseShare * participants.length;

      participants.forEach((person) => {
        if (!summaryMap.has(person.id)) {
          summaryMap.set(person.id, {
            personId: person.id,
            name: person.name,
            bowlsCount: 0,
            total: 0,
          });
        }
        const entry = summaryMap.get(person.id);
        entry.bowlsCount += 1;
        const share = baseShare + (remainder > 0 ? 1 : 0);
        if (remainder > 0) {
          remainder -= 1;
        }
        entry.total += share;
      });
    });

    const rows = Array.from(summaryMap.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ru"));

    return { rows, total: totalCost };
  }

  renderSessionPane() {
    const container = this.elements.sessionPane;
    const session = this.state.currentSession;

    if (!session || !session.isActive) {
      const suggestedName = session && !session.isActive ? session.name : getDefaultSessionName();
      container.innerHTML = `
        <div class="card-glass p-4">
          <h2 class="h5 fw-semibold mb-3">Начать новый вечер</h2>
          <div class="mb-3">
            <label for="newSessionName" class="form-label">Название сессии</label>
            <input type="text" id="newSessionName" class="form-control" value="${escapeHtml(suggestedName)}" placeholder="Например, Пятница с друзьями" />
          </div>
          <button class="btn btn-primary w-100" data-action="start-session">Начать сессию</button>
        </div>
      `;

      container.querySelector('[data-action="start-session"]').addEventListener('click', () => {
        const input = container.querySelector('#newSessionName');
        this.startSession(input.value);
      });
      container.querySelector('#newSessionName').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.startSession(event.target.value);
        }
      });
      return;
    }

    const activeBowl = this.ensureActiveBowl(session);
    const personMap = this.getPersonMap();
    const participants = activeBowl ? activeBowl.participantIds.map((id) => personMap.get(id)).filter(Boolean) : [];
    const availablePeople = this.state.people.filter((person) => !activeBowl?.participantIds.includes(person.id));
    const summary = this.computeSummary(session);

    container.innerHTML = `
      <div class="d-grid gap-3">
        <div class="card-glass p-4">
          <div class="d-flex flex-column gap-3">
            <div>
              <label class="form-label text-uppercase small text-muted mb-1">Название сессии</label>
              <input type="text" class="form-control" value="${escapeHtml(session.name)}" data-role="session-name" />
            </div>
            <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between">
              <div class="text-muted small">Старт: ${escapeHtml(formatDateTime(session.startedAt))}</div>
              <button class="btn btn-outline-danger" data-action="end-session">Завершить сессию</button>
            </div>
          </div>
        </div>

        <div class="card-glass p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h3 class="h6 mb-0">Чаши</h3>
            <button class="btn btn-primary btn-sm" data-action="add-bowl">Добавить чашу</button>
          </div>
          <div class="list-group list-group-flush">
            ${session.bowls
        .map(
          (bowl) => `
                  <button
                    type="button"
                    class="list-group-item list-group-item-action ${bowl.id === activeBowl.id ? "active" : ""}"
                    data-action="select-bowl"
                    data-bowl-id="${bowl.id}"
                  >
                    <div class="d-flex justify-content-between align-items-center">
                      <span>${escapeHtml(bowl.name)}</span>
                      <span class="badge ${bowl.id === activeBowl.id ? "text-bg-dark" : "text-bg-light"}">${bowl.participantIds.length}</span>
                    </div>
                  </button>
                `,
        )
        .join("")}
          </div>
        </div>

        ${activeBowl
        ? `
          <div class="card-glass p-4 d-grid gap-3">
            <div>
              <label class="form-label text-uppercase small text-muted mb-1">Название чаши</label>
              <input type="text" class="form-control" value="${escapeHtml(activeBowl.name)}" data-role="bowl-name" />
            </div>
            <div>
              <label class="form-label text-uppercase small text-muted mb-1">Стоимость (₽)</label>
              <input
                type="number"
                min="1"
                max="${MAX_COST_VALUE}"
                inputmode="numeric"
                class="form-control"
                value="${activeBowl.cost ?? ""}"
                data-role="bowl-cost"
              />
            </div>
            <div>
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="section-title mb-0">Участники</span>
                <span class="badge text-bg-light">${participants.length}</span>
              </div>
              <ul class="list-group mb-3">
                ${participants.length
          ? participants
            .map(
              (person) => `
                          <li class="list-group-item d-flex justify-content-between align-items-center">
                            <span>${escapeHtml(person.name)}</span>
                            <button class="btn btn-sm btn-outline-danger" data-action="remove-participant" data-person-id="${person.id}">Убрать</button>
                          </li>
                        `,
            )
            .join("")
          : '<li class="list-group-item text-muted small">Добавьте участников в чашу</li>'}
              </ul>
              <div class="input-group mb-3">
                <input type="text" class="form-control" placeholder="Имя участника" data-role="participant-search" />
                <button class="btn btn-primary" type="button" data-action="add-participant">Добавить</button>
              </div>
              ${availablePeople.length
          ? `
                  <div class="d-flex flex-wrap gap-2">
                    ${availablePeople
            .map(
              (person) => `
                          <button class="tag-button" data-action="quick-add" data-person-id="${person.id}">${escapeHtml(person.name)}</button>
                        `,
            )
            .join("")}
                  </div>
                `
          : ''}
            </div>
          </div>
        `
        : ''}

        <div class="card-glass p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h3 class="h6 mb-0">Текущие итоги</h3>
            <span class="badge text-bg-light">${formatCurrency(summary.total)}</span>
          </div>
          ${summary.rows.length
        ? `
              <div class="list-group list-group-flush">
                ${summary.rows
          .map(
            (row) => `
                      <div class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                          <div class="fw-semibold">${escapeHtml(row.name)}</div>
                          <div class="text-muted small">Чаш: ${row.bowlsCount}</div>
                        </div>
                        <span class="badge text-bg-primary">${formatCurrency(row.total)}</span>
                      </div>
                    `,
          )
          .join("")}
              </div>
            `
        : '<p class="text-muted small mb-0">Добавьте участников в чаши, чтобы увидеть расчёт.</p>'}
        </div>
      </div>
    `;

    container.querySelector('[data-role="session-name"]').addEventListener('input', (event) => {
      this.updateSessionName(event.target.value);
    });

    container.querySelector('[data-action="end-session"]').addEventListener('click', () => this.endSession());
    container.querySelector('[data-action="add-bowl"]').addEventListener('click', () => this.addBowl());

    container.querySelectorAll('[data-action="select-bowl"]').forEach((button) => {
      button.addEventListener('click', () => this.selectBowl(button.dataset.bowlId));
    });

    if (activeBowl) {
      container.querySelector('[data-role="bowl-name"]').addEventListener('input', (event) => {
        this.updateBowlName(activeBowl.id, event.target.value);
      });
      this.setupCostInput(
        container.querySelector('[data-role="bowl-cost"]'),
        activeBowl.cost,
        (input) => this.updateBowlCost(activeBowl.id, input.value, input)
      );

      const addParticipantInput = container.querySelector('[data-role="participant-search"]');
      const addParticipant = () => {
        this.addParticipantByName(addParticipantInput.value);
        addParticipantInput.value = '';
        addParticipantInput.focus();
      };
      container.querySelector('[data-action="add-participant"]').addEventListener('click', addParticipant);
      addParticipantInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addParticipant();
        }
      });

      container.querySelectorAll('[data-action="remove-participant"]').forEach((button) => {
        button.addEventListener('click', () => this.removeParticipant(button.dataset.personId));
      });

      container.querySelectorAll('[data-action="quick-add"]').forEach((button) => {
        button.addEventListener('click', () => this.quickAddParticipant(button.dataset.personId));
      });
    }
  }

  renderPeoplePane() {
    const container = this.elements.peoplePane;
    if (!this.state.people.length) {
      container.innerHTML = `
        <div class="card-glass p-4">
          <h2 class="h6 fw-semibold mb-3">Сохранённые участники</h2>
          <p class="text-muted small">Пока пусто. Добавьте участника в сессии или вручную ниже.</p>
          <div class="input-group">
            <input type="text" class="form-control" placeholder="Имя" data-role="new-person-name" />
            <button class="btn btn-primary" data-action="create-person">Добавить</button>
          </div>
        </div>
      `;
      const addBtn = container.querySelector('[data-action="create-person"]');
      const input = container.querySelector('[data-role="new-person-name"]');
      const create = () => {
        this.addPersonFromPeopleTab(input.value);
        input.value = '';
        input.focus();
      };
      addBtn.addEventListener('click', create);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          create();
        }
      });
      return;
    }

    container.innerHTML = `
      <div class="d-grid gap-3">
        <div class="card-glass p-4">
          <h2 class="h6 fw-semibold mb-3">Сохранённые участники</h2>
          <div class="input-group mb-3">
            <input type="text" class="form-control" placeholder="Имя" data-role="new-person-name" />
            <button class="btn btn-primary" data-action="create-person">Добавить</button>
          </div>
          <div class="list-group list-group-flush">
            ${this.state.people
        .map(
          (person) => `
                  <div class="list-group-item">
                    <div class="d-flex flex-column gap-2">
                      <input type="text" class="form-control" value="${escapeHtml(person.name)}" data-role="person-name" data-person-id="${person.id}" />
                      <div class="d-flex justify-content-end">
                        <button class="btn btn-sm btn-outline-danger" data-action="delete-person" data-person-id="${person.id}">Удалить</button>
                      </div>
                    </div>
                  </div>
                `,
        )
        .join("")}
          </div>
        </div>
      </div>
    `;

    const addBtn = container.querySelector('[data-action="create-person"]');
    const input = container.querySelector('[data-role="new-person-name"]');
    const create = () => {
      this.addPersonFromPeopleTab(input.value);
      input.value = '';
      input.focus();
    };
    addBtn.addEventListener('click', create);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        create();
      }
    });

    container.querySelectorAll('[data-role="person-name"]').forEach((field) => {
      field.addEventListener('change', (event) => {
        this.updatePersonName(event.target.dataset.personId, event.target.value);
      });
    });

    container.querySelectorAll('[data-action="delete-person"]').forEach((button) => {
      button.addEventListener('click', () => this.deletePerson(button.dataset.personId));
    });
  }

  renderSettingsPane() {
    const container = this.elements.settingsPane;
    const theme = this.state.settings.theme || "system";

    container.innerHTML = `
    <div class="card-glass p-4">
      <h2 class="h6 fw-semibold mb-3">Общие настройки</h2>

      <div class="mb-3">
        <label class="form-label">Стоимость чаши по умолчанию (₽)</label>
        <input
          type="number"
          min="1"
          max="${MAX_COST_VALUE}"
          inputmode="numeric"
          class="form-control"
          value="${this.state.settings.defaultBowlCost ?? ""}"
          data-role="default-cost"
        />
      </div>

      <div class="mb-1">
        <label class="form-label d-block">Тема</label>
        <div class="btn-group" role="group" aria-label="Переключение темы" data-role="theme-picker">
          <input type="radio" class="btn-check" name="theme" id="t-system" value="system" ${theme === "system" ? "checked" : ""}>
          <label class="btn btn-outline-secondary" for="t-system">Системная</label>

          <input type="radio" class="btn-check" name="theme" id="t-light" value="light" ${theme === "light" ? "checked" : ""}>
          <label class="btn btn-outline-secondary" for="t-light">Светлая</label>

          <input type="radio" class="btn-check" name="theme" id="t-dark" value="dark" ${theme === "dark" ? "checked" : ""}>
          <label class="btn btn-outline-secondary" for="t-dark">Тёмная</label>
        </div>
        <div class="form-text">«Системная» подстраивается под настройки ОС.</div>
      </div>
    </div>
  `;

    this.setupCostInput(
      container.querySelector('[data-role="default-cost"]'),
      this.state.settings.defaultBowlCost,
      (input) => this.updateDefaultBowlCost(input.value, input)
    );

    // обработчик темы
    container.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.state.settings.theme = e.target.value;
        saveState(this.state);           // сохраняем без лишнего перерендера
        applyTheme(this.state.settings.theme);
        // при желании можно this.renderAll(); но не обязательно
      });
    });

  }

  renderHistoryPane() {
    const container = this.elements.historyPane;
    const filters = this.state.historyFilters || { searchTerm: "", date: "", sortBy: "date" };
    const activeView = this.state.historyView === "stats" ? "stats" : "history";
    const normalizeDate = (isoString) => {
      if (!isoString) return "";
      const d = new Date(isoString);
      if (Number.isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 10);
    };

    const allSessions = Array.isArray(this.state.savedSessions) ? this.state.savedSessions : [];

    const filteredSessions = [...allSessions]
      .filter((session) => {
        const matchesName = filters.searchTerm
          ? (session.name || "").toLowerCase().includes(filters.searchTerm.toLowerCase())
          : true;
        const filterDate = filters.date;
        const sessionDate = normalizeDate(session.endedAt || session.startedAt);
        const matchesDate = filterDate ? sessionDate === filterDate : true;
        return matchesName && matchesDate;
      })
      .sort((a, b) => {
        if (filters.sortBy === "totalCost") {
          return (b.totalCost || 0) - (a.totalCost || 0);
        }
        const dateA = new Date(a.endedAt || a.startedAt || 0).getTime();
        const dateB = new Date(b.endedAt || b.startedAt || 0).getTime();
        return dateB - dateA;
      });

    const listHtml = filteredSessions.length
      ? filteredSessions
        .map((session, index) => {
          const collapseId = `history-${session.id}-${index}`;
          return `
            <div class="card-glass p-4 mb-3">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <h3 class="h6 mb-1">${escapeHtml(session.name)}</h3>
                  <p class="text-muted small mb-2">${escapeHtml(formatDateRange(session.startedAt, session.endedAt))}</p>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <span class="badge text-bg-light">${formatCurrency(session.totalCost)}</span>
                  <button
                    class="btn btn-sm btn-outline-danger"
                    data-action="delete-session"
                    data-session-id="${session.id}"
                    type="button"
                  >
                    Удалить
                  </button>
                </div>
              </div>
              <div class="text-muted small mb-3">Чаш: ${session.bowlCount}</div>
              <button class="btn btn-sm btn-outline-primary" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                Показать детали
              </button>
              <div class="collapse mt-3" id="${collapseId}">
                <h4 class="h6 mb-2">Распределение</h4>
                ${session.summary.length
              ? session.summary
                .map(
                  (row) => `
                          <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>${escapeHtml(row.name)}</div>
                            <span class="badge text-bg-primary">${formatCurrency(row.total)}</span>
                          </div>
                        `,
                )
                .join("")
              : '<p class="text-muted small mb-2">Нет участников</p>'}
                <h4 class="h6 mt-3 mb-2">Чаши</h4>
                ${session.bowls
              .map(
                (bowl) => `
                      <div class="mb-2">
                        <div class="d-flex justify-content-between align-items-center">
                          <span class="fw-semibold">${escapeHtml(bowl.name)}</span>
                          <span class="badge text-bg-light">${formatCurrency(bowl.cost)}</span>
                        </div>
                        <div class="text-muted small">${bowl.participants?.length ? bowl.participants.map(escapeHtml).join(', ') : 'Участников нет'}</div>
                      </div>
                    `,
              )
              .join('<hr class="my-2" />')}
              </div>
            </div>
          `;
        })
        .join('')
      : '<div class="card-glass p-4 text-center text-muted">Сохранённых сессий пока нет.</div>';

    const totalCost = allSessions.reduce((sum, s) => sum + Number(s.totalCost || 0), 0);
    const totalSessions = allSessions.length;
    const avgSessionCost = totalSessions ? totalCost / totalSessions : 0;
    const totalBowls = allSessions.reduce((sum, s) => sum + Number(s.bowlCount || 0), 0);
    const avgBowlsPerSession = totalSessions ? totalBowls / totalSessions : 0;
    const avgCostPerBowl = totalBowls ? totalCost / totalBowls : 0;
    const monthAgoTs = Date.now() - 1000 * 60 * 60 * 24 * 30;
    const sessionsLast30 = allSessions.filter((session) => {
      const date = new Date(session.endedAt || session.startedAt || 0).getTime();
      return !Number.isNaN(date) && date >= monthAgoTs;
    }).length;

    const participantTotals = new Map();
    let participantEntries = 0;

    allSessions.forEach((session) => {
      (session.summary || []).forEach((row) => {
        const name = (row?.name || "Без имени").trim() || "Без имени";
        const total = Number(row?.total || 0);
        participantTotals.set(name, (participantTotals.get(name) || 0) + total);
        participantEntries += 1;
      });
    });

    const uniqueParticipants = participantTotals.size;
    const avgParticipantsPerSession = totalSessions ? participantEntries / totalSessions : 0;
    const avgContributionPerPerson = uniqueParticipants ? totalCost / uniqueParticipants : 0;
    const avgPaymentPerParticipant = participantEntries ? totalCost / participantEntries : 0;
    const topParticipants = [...participantTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const formatNumber = (value, fractionDigits = 0) => Number(value || 0).toLocaleString("ru-RU", {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });

    const statsHtml = allSessions.length
      ? `
        <div class="card-glass p-3 mb-3">
          <h3 class="h6 mb-3">Общие метрики</h3>
          <div class="row g-3 text-center text-md-start">
            <div class="col-6 col-md-3">
              <div class="text-muted small">Всего сессий</div>
              <div class="fw-semibold">${formatNumber(totalSessions)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Общий расход</div>
              <div class="fw-semibold">${formatCurrency(totalCost)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Средний чек</div>
              <div class="fw-semibold">${formatCurrency(avgSessionCost)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Средняя чаша</div>
              <div class="fw-semibold">${formatCurrency(avgCostPerBowl)}</div>
            </div>
          </div>
        </div>

        <div class="card-glass p-3 mb-3">
          <h3 class="h6 mb-3">Активность</h3>
          <div class="row g-3 text-center text-md-start">
            <div class="col-6 col-md-3">
              <div class="text-muted small">Всего чаш</div>
              <div class="fw-semibold">${formatNumber(totalBowls)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Чаш на сессию</div>
              <div class="fw-semibold">${formatNumber(avgBowlsPerSession, 1)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Сессий за 30 дней</div>
              <div class="fw-semibold">${formatNumber(sessionsLast30)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Участников на сессию</div>
              <div class="fw-semibold">${formatNumber(avgParticipantsPerSession, 1)}</div>
            </div>
          </div>
        </div>

        <div class="card-glass p-3 mb-3">
          <h3 class="h6 mb-3">Платежи</h3>
          <div class="row g-3 text-center text-md-start">
            <div class="col-6 col-md-3">
              <div class="text-muted small">Уникальных участников</div>
              <div class="fw-semibold">${formatNumber(uniqueParticipants)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Средний вклад участника</div>
              <div class="fw-semibold">${formatCurrency(avgContributionPerPerson)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">В среднем на человека</div>
              <div class="fw-semibold">${formatCurrency(avgPaymentPerParticipant)}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted small">Стоимость чаши</div>
              <div class="fw-semibold">${formatCurrency(avgCostPerBowl)}</div>
            </div>
          </div>
        </div>

        <div class="card-glass p-3">
          <h3 class="h6 mb-3">Топ участников</h3>
          ${topParticipants.length
        ? topParticipants
          .map(([name, total]) => `
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <div class="fw-semibold">${escapeHtml(name)}</div>
                  <span class="badge text-bg-primary">${formatCurrency(total)}</span>
                </div>
              `)
          .join("")
        : '<div class="text-muted small">Пока нет распределения по участникам.</div>'}
        </div>
      `
      : '<div class="card-glass p-4 text-center text-muted">Сохранённых данных для метрик пока нет.</div>';

    container.innerHTML = `
      <div class="mb-3">
        <ul class="nav nav-pills" role="tablist">
          <li class="nav-item" role="presentation">
            <button class="nav-link ${activeView === "history" ? "active" : ""}" type="button" data-role="history-view" data-view="history">История</button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link ${activeView === "stats" ? "active" : ""}" type="button" data-role="history-view" data-view="stats">Статистика</button>
          </li>
        </ul>
      </div>

      <div data-history-section="history" class="${activeView === "history" ? "" : "d-none"}">
        <div class="card-glass p-3 mb-3">
          <div class="row g-3 align-items-end">
            <div class="col-12 col-md">
              <label class="form-label mb-1" for="history-search">Поиск по названию</label>
              <input
                type="search"
                id="history-search"
                class="form-control"
                placeholder="Введите название"
                value="${escapeHtml(filters.searchTerm)}"
                data-role="history-search"
              />
            </div>
            <div class="col-12 col-md-auto">
              <label class="form-label mb-1" for="history-date">Дата</label>
              <input
                type="date"
                id="history-date"
                class="form-control"
                value="${filters.date || ""}"
                data-role="history-date"
              />
            </div>
            <div class="col-12 col-md-auto">
              <div class="form-label mb-1">Сортировка</div>
              <div class="btn-group w-100" role="group" aria-label="Сортировка истории">
                <input type="radio" class="btn-check" name="history-sort" id="history-sort-date" value="date" ${filters.sortBy === "date" ? "checked" : ""}>
                <label class="btn btn-outline-secondary" for="history-sort-date">По дате</label>
                <input type="radio" class="btn-check" name="history-sort" id="history-sort-total" value="totalCost" ${filters.sortBy === "totalCost" ? "checked" : ""}>
                <label class="btn btn-outline-secondary" for="history-sort-total">По сумме</label>
              </div>
            </div>
          </div>
        </div>
        <div data-role="history-list">${listHtml}</div>
      </div>

      <div data-history-section="stats" class="${activeView === "stats" ? "" : "d-none"}">
        ${statsHtml}
      </div>
    `;

    container.querySelectorAll('[data-role="history-view"]').forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.view === "stats" ? "stats" : "history";
        if (this.state.historyView !== view) {
          this.state.historyView = view;
          this.persistAndRender();
        }
      });
    });

    const searchInput = container.querySelector('[data-role="history-search"]');
    searchInput?.addEventListener('input', (e) => {
      this.state.historyFilters = {
        ...this.state.historyFilters,
        searchTerm: e.target.value,
      };
      this.persistAndRender();
    });

    const dateInput = container.querySelector('[data-role="history-date"]');
    dateInput?.addEventListener('change', (e) => {
      this.state.historyFilters = {
        ...this.state.historyFilters,
        date: e.target.value,
      };
      this.persistAndRender();
    });

    container.querySelectorAll('input[name="history-sort"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.state.historyFilters = {
            ...this.state.historyFilters,
            sortBy: e.target.value,
          };
          this.persistAndRender();
        }
      });
    });

    container.querySelectorAll('[data-action="delete-session"]').forEach((button) => {
      button.addEventListener('click', () => {
        this.deleteSavedSession(button.dataset.sessionId);
      });
    });
  }
}

// Универсальный авто-фит для всей навигации: уменьшает font-size у UL,
// пока суммарная ширина пунктов не влезет в контейнер.
function fitNavFont() {
  const nav = document.getElementById('mainTab');
  if (!nav) return;

  const min = Number(nav.dataset.minFont || 10);
  const max = Number(nav.dataset.maxFont || 14);

  // Сбрасываем на максимум и считаем
  let size = max;
  nav.style.fontSize = size + 'px';

  const items = Array.from(nav.querySelectorAll(':scope > li'));
  if (!items.length) return;

  const totalWidth = () => {
    // берём реальную ширину элементов
    return items.reduce((sum, li) => sum + li.getBoundingClientRect().width, 0);
  };

  // Пока не влезает — уменьшаем на 0.5px
  let guard = 0;
  const containerWidth = nav.clientWidth;
  while (size > min && totalWidth() > containerWidth && guard < 40) {
    size -= 0.5;
    nav.style.fontSize = size + 'px';
    guard++;
  }
}

// Оборачиваем с троттлом, чтобы не дёргать часто
function throttle(fn, ms) {
  let t = 0;
  return (...args) => {
    const now = performance.now();
    if (now - t > ms) {
      t = now;
      fn(...args);
    }
  };
}
const fitNavFontThrottled = throttle(() => {
  fitNavFont();
  // после общего фитта — подгоняем ник в чипе ещё раз
  const chip = document.querySelector('#tab-user .user-chip');
  const handle = chip?.querySelector('.user-handle');
  if (chip && handle) autoFitFont(handle, chip);
}, 50);


const triggerHaptic = (() => {
  let lastTriggerAt = 0;
  return () => {
    if (!window.tg?.HapticFeedback?.impactOccurred) return;
    const now = Date.now();
    if (now - lastTriggerAt < 100) return;
    lastTriggerAt = now;
    window.tg.HapticFeedback.impactOccurred("light");
  };
})();

function initHapticFeedback() {
  if (!window.tg?.HapticFeedback?.impactOccurred) return;
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target?.closest?.(
        "button, [role='button'], .btn, .nav-link, input[type='checkbox'], input[type='radio'], label"
      );
      if (!target) return;
      if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
      triggerHaptic();
    },
    { capture: true }
  );
}

function initNavAnimated() {
  const nav = document.getElementById('mainTab');
  if (!nav) return;

  nav.classList.add('nav-animated');

  // Создаём капсулу-указатель один раз
  let indicator = nav.querySelector('.nav-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'nav-indicator';
    nav.appendChild(indicator);
  }

  const update = () => {
    const active = nav.querySelector('.nav-link.active');
    if (!active) return;

    const navRect = nav.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();

    const left = btnRect.left - navRect.left + nav.scrollLeft;
    indicator.style.width = `${btnRect.width}px`;
    indicator.style.transform = `translateX(${left}px)`;

    // каждый раз, когда таб меняется, проверяем, влазит ли меню
    fitNavFontThrottled();
  };

  // Обновляем при показе вкладки (bootstrap 5)
  nav.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('shown.bs.tab', () => {
      update();
    });
  });

  window.addEventListener('resize', () => {
    update();
    fitNavFontThrottled();
  });
  window.addEventListener('orientationchange', () => {
    fitNavFontThrottled();
  });

  update();
}

// === СТАРТ ПРИЛОЖЕНИЯ ===
window.addEventListener("DOMContentLoaded", async () => {
  // если в верстке остался элемент приветствия — уберём
  (function(){ const w = document.getElementById('welcome'); if (w) w.remove(); })();
  await initTelegramAuth(); // только авторизация, без UI

  await pullStateFromCloud();  // подменяем локалку облаком
  initHapticFeedback();
  initNavAnimated && initNavAnimated();
  window.app = new HookahSpliterApp();
  initUserHeader().catch(() => {});

  // первичный авто-фит после рендера
  fitNavFontThrottled();
});

// добивка состояния при закрытии/сворачивании
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushStateToCloudKeepalive();
});
window.addEventListener('beforeunload', flushStateToCloudKeepalive);

(() => {
  const el = document.getElementById('year');
  if (el) el.textContent = String(new Date().getFullYear());
})();
