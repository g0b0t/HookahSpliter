const API_BASE = '';

const formatCurrency = (value) => `${Math.round(value || 0).toLocaleString('ru-RU')} ₽`;
const formatDateTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return `${date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  })}, ${date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

class HookahSpliterApp {
  constructor() {
    this.state = {
      auth: { loading: true, error: null, token: null, user: null },
      currentSession: null,
      participants: [],
      history: [],
      logs: [],
    };
    this.elements = {
      sessionPane: document.getElementById('sessionPane'),
      peoplePane: document.getElementById('peoplePane'),
      settingsPane: document.getElementById('settingsPane'),
      historyPane: document.getElementById('historyPane'),
    };
    this.init();
  }

  async init() {
    try {
      await this.authenticate();
      await this.loadInitialData();
      this.bindEvents();
    } catch (error) {
      console.error(error);
      this.state.auth.error = error.message || 'Не удалось инициализировать приложение';
    } finally {
      this.state.auth.loading = false;
      this.renderAll();
    }
  }

  async authenticate() {
    const telegramInitData = window.Telegram?.WebApp?.initData || null;
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
    }
    const devUserParam = new URLSearchParams(window.location.search).get('devUser');
    const body = telegramInitData
      ? { initData: telegramInitData }
      : devUserParam
      ? { devUser: JSON.parse(decodeURIComponent(devUserParam)) }
      : { devUser: { id: 'dev-user', username: 'dev', firstName: 'Dev' } };

    const response = await fetch(`${API_BASE}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Ошибка авторизации');
    }
    const payload = await response.json();
    this.state.auth.token = payload.token;
    this.state.auth.user = payload.user;
  }

  async loadInitialData() {
    await Promise.all([this.loadParticipants(), this.loadCurrentSession(), this.loadHistory(), this.loadLogsIfNeeded()]);
  }

  async loadParticipants() {
    const result = await this.apiFetch('/participants');
    this.state.participants = result.participants || [];
  }

  async loadCurrentSession() {
    const result = await this.apiFetch('/sessions/current');
    this.state.currentSession = result.session || null;
  }

  async loadHistory() {
    const result = await this.apiFetch('/sessions/history');
    this.state.history = result.sessions || [];
  }

  async loadLogsIfNeeded() {
    if (!this.isAdmin()) {
      this.state.logs = [];
      return;
    }
    const result = await this.apiFetch('/admin/logs?limit=100');
    this.state.logs = result.logs || [];
  }

  async apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.state.auth.token) {
      headers.Authorization = `Bearer ${this.state.auth.token}`;
    }
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || 'Ошибка запроса');
      error.payload = payload;
      throw error;
    }
    return response.json();
  }

  bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'start-session') {
        event.preventDefault();
        this.promptStartSession();
      } else if (action === 'end-session') {
        event.preventDefault();
        this.endSession();
      } else if (action === 'add-bowl') {
        event.preventDefault();
        this.addBowl();
      } else if (action === 'refresh-logs') {
        event.preventDefault();
        this.loadLogsIfNeeded().then(() => this.renderSettingsPane());
      }
    });

    document.addEventListener('submit', (event) => {
      if (event.target.matches('[data-form="add-participant"]')) {
        event.preventDefault();
        const form = event.target;
        const { sessionId, bowlId } = form.dataset;
        const userId = form.querySelector('select[name="participant"]').value;
        if (!userId) return;
        this.addParticipant(sessionId, bowlId, userId);
      }
      if (event.target.matches('[data-form="update-notify"]')) {
        event.preventDefault();
        const form = event.target;
        const notify = form.querySelector('input[name="notify"]').checked;
        this.updateNotificationPreference(notify);
      }
    });
  }

  async promptStartSession() {
    const name = window.prompt('Название сессии', `Вечер ${new Date().toLocaleDateString('ru-RU')}`);
    if (name === null) return;
    try {
      await this.apiFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await Promise.all([this.loadCurrentSession(), this.loadHistory(), this.loadLogsIfNeeded()]);
      this.renderAll();
    } catch (error) {
      alert(error.message || 'Не удалось создать сессию');
    }
  }

  async endSession() {
    if (!this.state.currentSession) return;
    const confirmed = window.confirm('Завершить текущую сессию?');
    if (!confirmed) return;
    try {
      await this.apiFetch(`/sessions/${this.state.currentSession.id}/end`, { method: 'POST' });
      await Promise.all([this.loadCurrentSession(), this.loadHistory(), this.loadLogsIfNeeded()]);
      this.renderAll();
    } catch (error) {
      alert(error.message || 'Не удалось завершить сессию');
    }
  }

  async addBowl() {
    if (!this.state.currentSession) return;
    const name = window.prompt('Название чаши', `Чаша ${this.state.currentSession.bowls.length + 1}`);
    if (name === null) return;
    try {
      await this.apiFetch(`/sessions/${this.state.currentSession.id}/bowls`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await Promise.all([this.loadCurrentSession(), this.loadLogsIfNeeded()]);
      this.renderAll();
    } catch (error) {
      alert(error.message || 'Не удалось добавить чашу');
    }
  }

  async addParticipant(sessionId, bowlId, userId) {
    try {
      await this.apiFetch(`/sessions/${sessionId}/bowls/${bowlId}/participants`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      await Promise.all([this.loadCurrentSession(), this.loadHistory(), this.loadLogsIfNeeded()]);
      this.renderAll();
    } catch (error) {
      alert(error.message || 'Не удалось добавить участника');
    }
  }

  async updateNotificationPreference(notify) {
    try {
      const result = await this.apiFetch('/participants/settings', {
        method: 'POST',
        body: JSON.stringify({ settings: { notifyOnNewBowl: notify } }),
      });
      this.state.auth.user = {
        ...this.state.auth.user,
        settings: { ...this.state.auth.user?.settings, ...result.settings },
      };
      this.renderSettingsPane();
    } catch (error) {
      alert(error.message || 'Не удалось обновить настройки');
    }
  }

  renderAll() {
    this.renderSessionPane();
    this.renderPeoplePane();
    this.renderSettingsPane();
    this.renderHistoryPane();
  }

  isAdmin() {
    return this.state.auth.user?.role === 'admin';
  }

  renderSessionPane() {
    const container = this.elements.sessionPane;
    if (this.state.auth.loading) {
      container.innerHTML = '<div class="text-center py-5 text-muted">Загрузка…</div>';
      return;
    }
    if (this.state.auth.error) {
      container.innerHTML = `<div class="alert alert-danger">${this.state.auth.error}</div>`;
      return;
    }
    if (!this.state.currentSession) {
      container.innerHTML = `
        <div class="text-center py-5">
          <p class="text-muted mb-3">Активных сессий нет.</p>
          ${
            this.isAdmin()
              ? '<button class="btn btn-primary" data-action="start-session">Начать сессию</button>'
              : '<p class="small text-muted">Ожидайте, пока администратор запустит сессию.</p>'
          }
        </div>
      `;
      return;
    }

    const session = this.state.currentSession;
    const bowlCards = (session.bowls || [])
      .map((bowl) => {
        const participants = (bowl.participantIds || [])
          .map((id) => this.state.participants.find((p) => p.id === id))
          .filter(Boolean);
        const available = this.state.participants.filter((p) => !participants.some((participant) => participant.id === p.id));
        const addForm = this.isAdmin()
          ? `
            <form class="mt-3" data-form="add-participant" data-session-id="${session.id}" data-bowl-id="${bowl.id}">
              <div class="input-group input-group-sm">
                <select class="form-select" name="participant">
                  <option value="">Добавить участника…</option>
                  ${available
                    .map((participant) => `<option value="${participant.id}">${this.formatUser(participant)}</option>`)
                    .join('')}
                </select>
                <button class="btn btn-outline-primary" type="submit">Добавить</button>
              </div>
            </form>
          `
          : '';
        return `
          <div class="card mb-3 shadow-sm">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <h3 class="h6 mb-1">${bowl.name}</h3>
                  <p class="text-muted small mb-2">${formatCurrency(bowl.cost)}</p>
                </div>
              </div>
              <ul class="list-group list-group-flush">
                ${
                  participants.length
                    ? participants
                        .map(
                          (participant) => `
                          <li class="list-group-item px-0 d-flex justify-content-between align-items-center">
                            <span>${this.formatUser(participant)}</span>
                          </li>`
                        )
                        .join('')
                    : '<li class="list-group-item px-0 text-muted small">Участников пока нет</li>'
                }
              </ul>
              ${addForm}
            </div>
          </div>
        `;
      })
      .join('');

    container.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 class="h5 mb-1">${session.name}</h2>
          <p class="text-muted small mb-0">Началась: ${formatDateTime(session.startedAt)}</p>
        </div>
        ${
          this.isAdmin()
            ? '<button class="btn btn-outline-danger btn-sm" data-action="end-session">Завершить</button>'
            : ''
        }
      </div>
      ${this.isAdmin() ? '<button class="btn btn-primary btn-sm mb-3" data-action="add-bowl">Добавить чашу</button>' : ''}
      ${bowlCards || '<p class="text-muted">Чаш пока нет</p>'}
    `;
  }

  renderPeoplePane() {
    const container = this.elements.peoplePane;
    if (this.state.auth.loading) {
      container.innerHTML = '<div class="text-center py-5 text-muted">Загрузка…</div>';
      return;
    }
    const rows = this.state.participants
      .map(
        (participant) => `
          <tr>
            <td>${this.formatUser(participant)}</td>
            <td>${participant.username ? '@' + participant.username : '—'}</td>
            <td>${participant.role === 'admin' ? '<span class="badge bg-primary">Админ</span>' : 'Пользователь'}</td>
          </tr>
        `
      )
      .join('');
    container.innerHTML = `
      <div class="card shadow-sm">
        <div class="card-body">
          <h2 class="h6 mb-3">Участники приложения</h2>
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Username</th>
                  <th>Роль</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="3" class="text-muted text-center py-3">Нет участников</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  renderSettingsPane() {
    const container = this.elements.settingsPane;
    if (this.state.auth.loading) {
      container.innerHTML = '<div class="text-center py-5 text-muted">Загрузка…</div>';
      return;
    }
    const notify = this.state.auth.user?.settings?.notifyOnNewBowl !== false;
    const logSection = this.isAdmin()
      ? `
        <div class="card mt-3 shadow-sm">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h3 class="h6 mb-0">Журнал действий</h3>
              <button class="btn btn-outline-secondary btn-sm" data-action="refresh-logs">Обновить</button>
            </div>
            <div class="log-window border rounded" style="max-height: 240px; overflow-y: auto;">
              ${
                this.state.logs.length
                  ? this.state.logs
                      .map(
                        (log) => `
                        <div class="p-2 border-bottom small">
                          <div class="fw-semibold">${log.action}</div>
                          <div class="text-muted">${formatDateTime(log.timestamp)}</div>
                          ${log.description ? `<div>${log.description}</div>` : ''}
                          ${log.meta ? `<pre class="mb-0 small text-muted">${JSON.stringify(log.meta, null, 2)}</pre>` : ''}
                        </div>
                      `
                      )
                      .join('')
                  : '<div class="p-2 text-muted small">Записей пока нет</div>'
              }
            </div>
          </div>
        </div>
      `
      : '';

    container.innerHTML = `
      <div class="card shadow-sm">
        <div class="card-body">
          <h2 class="h6 mb-3">Личные настройки</h2>
          <form data-form="update-notify" class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="notifyToggle" name="notify" ${notify ? 'checked' : ''}>
            <label class="form-check-label" for="notifyToggle">Уведомлять, если меня добавили в чашу</label>
          </form>
        </div>
      </div>
      ${logSection}
    `;
  }

  renderHistoryPane() {
    const container = this.elements.historyPane;
    if (this.state.auth.loading) {
      container.innerHTML = '<div class="text-center py-5 text-muted">Загрузка…</div>';
      return;
    }
    if (!this.state.history.length) {
      container.innerHTML = '<p class="text-muted">История пуста.</p>';
      return;
    }
    container.innerHTML = this.state.history
      .map(
        (session) => `
          <div class="card mb-3 shadow-sm">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <h3 class="h6 mb-0">${session.name}</h3>
                <span class="badge bg-light text-muted">${formatDateTime(session.startedAt)} — ${formatDateTime(session.endedAt)}</span>
              </div>
              <ul class="list-group list-group-flush">
                ${(session.bowls || [])
                  .map(
                    (bowl) => `
                      <li class="list-group-item px-0">
                        <div class="d-flex justify-content-between">
                          <span>${bowl.name}</span>
                          <span class="text-muted small">${formatCurrency(bowl.cost)}</span>
                        </div>
                      </li>
                    `
                  )
                  .join('')}
              </ul>
            </div>
          </div>
        `
      )
      .join('');
  }

  formatUser(user) {
    if (!user) return '';
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    if (fullName) return fullName;
    if (user.username) return `@${user.username}`;
    return 'Неизвестный';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new HookahSpliterApp();
});
