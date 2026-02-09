import { escapeHtml, formatCurrency, formatDateRange } from "./shared.js";

export function renderHistoryPane(app) {
  const container = app.elements.historyPane;
  const filters = app.state.historyFilters || { searchTerm: "", date: "", sortBy: "date" };
  const activeView = app.state.historyView === "stats" ? "stats" : "history";
  const normalizeDate = (isoString) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const allSessions = Array.isArray(app.state.savedSessions) ? app.state.savedSessions : [];
  const canDeleteSessions = app.isAdmin();

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
                ${canDeleteSessions ? `
                  <button
                    class="btn btn-sm btn-outline-danger"
                    data-action="delete-session"
                    data-session-id="${session.id}"
                    type="button"
                  >
                    Удалить
                  </button>
                ` : ""}
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
      <div class="card-glass p-3 mb-3 history-filters-card">
        <div class="d-flex align-items-center justify-content-between gap-2">
          <div class="fw-semibold">Фильтры</div>
          <button
            class="btn btn-sm btn-outline-secondary"
            type="button"
            data-role="history-filters-toggle"
            aria-expanded="${app.state.historyFiltersExpanded ? "true" : "false"}"
          >
            ${app.state.historyFiltersExpanded ? "Скрыть" : "Показать"}
          </button>
        </div>
        <div
          data-role="history-filters"
          class="collapse ${app.state.historyFiltersExpanded ? "show" : ""}"
        >
          <div class="row g-3 align-items-end mt-1">
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
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end mb-3">
        <div class="history-sort" role="group" aria-label="Сортировка истории">
          <button
            class="history-sort-button ${filters.sortBy === "date" ? "is-active" : ""}"
            type="button"
            data-role="history-sort"
            data-sort="date"
            aria-pressed="${filters.sortBy === "date" ? "true" : "false"}"
            title="По дате"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M3 10h18" />
            </svg>
          </button>
          <button
            class="history-sort-button ${filters.sortBy === "totalCost" ? "is-active" : ""}"
            type="button"
            data-role="history-sort"
            data-sort="totalCost"
            aria-pressed="${filters.sortBy === "totalCost" ? "true" : "false"}"
            title="По сумме"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v18" />
              <path d="M8 7c0-1.7 1.6-3 4-3s4 1.3 4 3-1.6 3-4 3-4 1.3-4 3 1.6 3 4 3 4-1.3 4-3" />
            </svg>
          </button>
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
      if (app.state.historyView !== view) {
        app.state.historyView = view;
        app.persistAndRender();
      }
    });
  });

  const filtersToggle = container.querySelector('[data-role="history-filters-toggle"]');
  filtersToggle?.addEventListener('click', () => {
    app.state.historyFiltersExpanded = !app.state.historyFiltersExpanded;
    app.persistAndRender();
  });

  const searchInput = container.querySelector('[data-role="history-search"]');
  searchInput?.addEventListener('input', (e) => {
    app.state.historyFilters = {
      ...app.state.historyFilters,
      searchTerm: e.target.value,
    };
    app.persistAndRender();
  });

  const dateInput = container.querySelector('[data-role="history-date"]');
  dateInput?.addEventListener('change', (e) => {
    app.state.historyFilters = {
      ...app.state.historyFilters,
      date: e.target.value,
    };
    app.persistAndRender();
  });

  container.querySelectorAll('[data-role="history-sort"]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextSort = button.dataset.sort || "date";
      if (app.state.historyFilters.sortBy !== nextSort) {
        app.state.historyFilters = {
          ...app.state.historyFilters,
          sortBy: nextSort,
        };
        app.persistAndRender();
      }
    });
  });

  if (canDeleteSessions) {
    container.querySelectorAll('[data-action="delete-session"]').forEach((button) => {
      button.addEventListener('click', () => {
        void app.deleteSavedSession(button.dataset.sessionId);
      });
    });
  }
}
