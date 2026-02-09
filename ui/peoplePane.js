import { escapeHtml, isTelegramAuthorized, MAX_COST_VALUE } from "./shared.js";

export function renderPeoplePane(app) {
  const container = app.elements.peoplePane;
  const canManagePeople = app.isAdmin();
  const manualAddDisabled = true;
  const peopleAddDisabled = manualAddDisabled || !isTelegramAuthorized() || !canManagePeople;
  const peopleAddHint = !canManagePeople
    ? "Добавление доступно только для администраторов."
    : "Добавление доступно только для авторизованных пользователей.";
  if (!app.state.people.length) {
    container.innerHTML = `
      <div class="card-glass p-4">
        <h2 class="h6 fw-semibold mb-3">Сохранённые участники</h2>
        <p class="text-muted small">Пока пусто. Добавьте участника в сессии или вручную ниже.</p>
        ${canManagePeople ? `
          <div class="input-group mb-2">
            <input
              type="text"
              class="form-control"
              placeholder="Имя"
              data-role="new-person-name"
              ${peopleAddDisabled ? 'disabled aria-disabled="true"' : ""}
            />
            <button
              class="btn btn-primary"
              data-action="create-person"
              ${peopleAddDisabled ? 'disabled aria-disabled="true"' : ""}
            >
              Добавить
            </button>
          </div>
          <p class="text-muted small mb-0">${peopleAddHint}</p>
        ` : `<p class="text-muted small mb-0">${peopleAddHint}</p>`}
      </div>
    `;
    const addBtn = container.querySelector('[data-action="create-person"]');
    const input = container.querySelector('[data-role="new-person-name"]');
    const create = () => {
      app.addPersonFromPeopleTab(input.value);
      input.value = '';
      input.focus();
    };
    if (!peopleAddDisabled && addBtn && input) {
      addBtn.addEventListener('click', create);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          create();
        }
      });
    }
    return;
  }

  container.innerHTML = `
    <div class="d-grid gap-3">
      <div class="card-glass p-4">
        <h2 class="h6 fw-semibold mb-3">Сохранённые участники</h2>
        ${canManagePeople ? `
          <div class="input-group mb-2">
            <input
              type="text"
              class="form-control"
              placeholder="Имя"
              data-role="new-person-name"
              ${peopleAddDisabled ? 'disabled aria-disabled="true"' : ""}
            />
            <button
              class="btn btn-primary"
              data-action="create-person"
              ${peopleAddDisabled ? 'disabled aria-disabled="true"' : ""}
            >
              Добавить
            </button>
          </div>
          <p class="text-muted small">${peopleAddHint}</p>
        ` : `<p class="text-muted small">${peopleAddHint}</p>`}
        <div class="list-group list-group-flush">
          ${app.state.people
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
    app.addPersonFromPeopleTab(input.value);
    input.value = '';
    input.focus();
  };
  if (!peopleAddDisabled && addBtn && input) {
    addBtn.addEventListener('click', create);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        create();
      }
    });
  }

  container.querySelectorAll('[data-role="person-name"]').forEach((field) => {
    field.addEventListener('change', (event) => {
      app.updatePersonName(event.target.dataset.personId, event.target.value);
    });
  });

  container.querySelectorAll('[data-action="delete-person"]').forEach((button) => {
    button.addEventListener('click', () => app.deletePerson(button.dataset.personId));
  });
}
