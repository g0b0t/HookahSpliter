import { escapeHtml, formatCurrency, formatDateTime, isTelegramAuthorized, MAX_COST_VALUE } from "./shared.js";
import { getDefaultSessionName } from "../domain/session.js";

export function renderSessionPane(app) {
  const container = app.elements.sessionPane;
  const session = app.state.currentSession;
  const canManageParticipants = app.isAdmin();
  const canEditCosts = app.isAdmin();
  const manualAddDisabled = true;
  const participantAddDisabled = manualAddDisabled || !isTelegramAuthorized() || !canManageParticipants;
  const participantAddHint = !canManageParticipants
    ? "Добавление доступно только для администраторов."
    : "Добавление доступно только для авторизованных пользователей.";

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
      app.startSession(input.value);
    });
    container.querySelector('#newSessionName').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        app.startSession(event.target.value);
      }
    });
    return;
  }

  const activeBowl = app.ensureActiveBowl(session);
  const personMap = app.getPersonMap();
  const participants = activeBowl ? activeBowl.participantIds.map((id) => personMap.get(id)).filter(Boolean) : [];
  const availablePeople = app.state.people.filter((person) => !activeBowl?.participantIds.includes(person.id));
  const summary = app.computeSummary(session);

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
              ${canEditCosts ? "" : 'readonly aria-readonly="true"'}
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
            ${canManageParticipants ? `
              <div class="input-group mb-2">
                <input
                  type="text"
                  class="form-control"
                  placeholder="Имя участника"
                  data-role="participant-search"
                  ${participantAddDisabled ? 'disabled aria-disabled="true"' : ""}
                />
                <button
                  class="btn btn-primary"
                  type="button"
                  data-action="add-participant"
                  ${participantAddDisabled ? 'disabled aria-disabled="true"' : ""}
                >
                  Добавить
                </button>
              </div>
              <p class="text-muted small mb-3">${participantAddHint}</p>
            ` : `<p class="text-muted small mb-3">${participantAddHint}</p>`}
            ${availablePeople.length && canManageParticipants
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
    app.updateSessionName(event.target.value);
  });

  container.querySelector('[data-action="end-session"]').addEventListener('click', () => app.endSession());
  container.querySelector('[data-action="add-bowl"]').addEventListener('click', () => app.addBowl());

  container.querySelectorAll('[data-action="select-bowl"]').forEach((button) => {
    button.addEventListener('click', () => app.selectBowl(button.dataset.bowlId));
  });

  if (activeBowl) {
    container.querySelector('[data-role="bowl-name"]').addEventListener('input', (event) => {
      app.updateBowlName(activeBowl.id, event.target.value);
    });
    if (canEditCosts) {
      app.setupCostInput(
        container.querySelector('[data-role="bowl-cost"]'),
        activeBowl.cost,
        (input) => app.updateBowlCost(activeBowl.id, input.value, input)
      );
    }

    const addParticipantInput = container.querySelector('[data-role="participant-search"]');
    const addParticipantButton = container.querySelector('[data-action="add-participant"]');
    const addParticipant = () => {
      app.addParticipantByName(addParticipantInput.value);
      addParticipantInput.value = '';
      addParticipantInput.focus();
    };
    if (!participantAddDisabled && addParticipantButton && addParticipantInput) {
      addParticipantButton.addEventListener('click', addParticipant);
      addParticipantInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addParticipant();
        }
      });
    }

    container.querySelectorAll('[data-action="remove-participant"]').forEach((button) => {
      button.addEventListener('click', () => app.removeParticipant(button.dataset.personId));
    });

    container.querySelectorAll('[data-action="quick-add"]').forEach((button) => {
      button.addEventListener('click', () => app.quickAddParticipant(button.dataset.personId));
    });
  }
}
