
const STORAGE_KEY = "hookahSpliterStateV2";
const MAX_COST_DIGITS = 5;
const MAX_COST_VALUE = Number("9".repeat(MAX_COST_DIGITS));
const API_BASE = "http://127.0.0.1:8000";

const createInitialState = () => ({
  settings: {
    defaultBowlCost: 500,
  },
  people: [],
  currentSession: null,
  savedSessions: [],
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
      ...createInitialState(),
      ...parsed,
      settings: { ...createInitialState().settings, ...(parsed.settings || {}) },
      people: Array.isArray(parsed.people) ? parsed.people : [],
      savedSessions: Array.isArray(parsed.savedSessions) ? parsed.savedSessions : [],
      currentSession: parsed.currentSession || null,
    };
  } catch (error) {
    console.warn("Не удалось прочитать сохранённое состояние", error);
    return createInitialState();
  }
};

const saveState = (state) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

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
  })}, ${date.toLocaleTimeString("ru-RU", {
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

// Отправляем initData на бэкенд и выводим «Добро пожаловать, <имя>»
async function initTelegramWelcome() {
  const out = document.getElementById("welcome");
  if (!out) return;

  // Базовый URL бэка: локалка по умолчанию, можно переопределить window.API_BASE
  const API_BASE = (typeof window !== "undefined" && window.API_BASE)
    ? window.API_BASE
    : "http://127.0.0.1:8000";

  let label = "Добро пожаловать, гость.";

  try {
    // Telegram SDK может отсутствовать вне Mini App
    const tg = window.Telegram?.WebApp;
    try { tg?.ready?.(); } catch {}

    // Берём initData строго из Telegram.WebApp, без ручной декодировки
    const initData = tg?.initData || "";

    const res = await fetch(`${API_BASE}/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // В проде (кросс-домен на куках) раскомментируй:
      // credentials: "include",
      body: JSON.stringify({ initData })
    });

    let data;
    try { data = await res.json(); } catch {}

    if (!res.ok) {
      console.warn("Auth failed:", { status: res.status, data });
    } else {
      const u = data?.user || null;
      if (u?.first_name) {
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ");
        label = `Добро пожаловать, ${fullName}!`;
      }
    }
  } catch (err) {
    console.warn("initTelegramWelcome error:", err);
  } finally {
    out.textContent = label;
  }
}

class HookahSpliterApp {
  constructor() {
    this.state = loadState();
    this.elements = {
      sessionPane: document.getElementById("sessionPane"),
      peoplePane: document.getElementById("peoplePane"),
      settingsPane: document.getElementById("settingsPane"),
      historyPane: document.getElementById("historyPane"),
    };
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
    const raw = inputElement.value;
    if (raw === "") {
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
    inputElement.addEventListener("change", (event) => {
      const target = event.target;
      const success = commitCallback(target);
      if (!success) {
        target.value = target.dataset.lastValidValue || "";
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

  endSession() {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;

    const endedAt = new Date().toISOString();
    const summary = this.computeSummary(session);
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
    if (
      this.state.currentSession &&
      this.state.currentSession.id === sessionId &&
      !this.state.currentSession.isActive
    ) {
      this.state.currentSession = null;
    }
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
                      <span class="badge ${bowl.id === activeBowl.id ? "bg-light text-dark" : "text-bg-light"}">${bowl.participantIds.length}</span>
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
                      <input type="text" class="form-control form-control-sm" value="${escapeHtml(person.name)}" data-role="person-name" data-person-id="${person.id}" />
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
        <p class="text-muted small mb-0">Значение используется при создании новой чаши. Суммы всегда округляются до целого числа.</p>
      </div>
    `;

    this.setupCostInput(
      container.querySelector('[data-role="default-cost"]'),
      this.state.settings.defaultBowlCost,
      (input) => this.updateDefaultBowlCost(input.value, input)
    );
  }

  renderHistoryPane() {
    const container = this.elements.historyPane;
    if (!this.state.savedSessions.length) {
      container.innerHTML = `
        <div class="card-glass p-4 text-center text-muted">
          Сохранённых сессий пока нет.
        </div>
      `;
      return;
    }

    container.innerHTML = this.state.savedSessions
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
                      <div class="text-muted small">${bowl.participants.length ? bowl.participants.map(escapeHtml).join(', ') : 'Участников нет'}</div>
                    </div>
                  `,
                )
                .join('<hr class="my-2" />')}
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-action="delete-session"]').forEach((button) => {
      button.addEventListener('click', () => {
        this.deleteSavedSession(button.dataset.sessionId);
      });
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await initTelegramWelcome();
  window.app = new HookahSpliterApp();
});

(() => {
  const el = document.getElementById('year');
  if (el) el.textContent = String(new Date().getFullYear());
})();
