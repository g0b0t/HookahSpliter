import { MAX_COST_VALUE } from "./shared.js";

export function renderSettingsPane(app) {
  const container = app.elements.settingsPane;
  const theme = app.state.settings.theme || "system";
  const canEditCosts = app.isAdmin();
  const canManageAdmins = app.isAdmin();

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
        value="${app.state.settings.defaultBowlCost ?? ""}"
        data-role="default-cost"
        ${canEditCosts ? "" : 'readonly aria-readonly="true"'}
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
  ${canManageAdmins ? `
    <div class="card-glass p-4 mt-3">
      <h2 class="h6 fw-semibold mb-3">Права администратора</h2>
      <div class="input-group">
        <input
          type="text"
          class="form-control"
          placeholder="Telegram ID пользователя"
          data-role="admin-user-id"
        />
        <button class="btn btn-primary" type="button" data-action="grant-admin">
          Сделать админом
        </button>
      </div>
      <p class="text-muted small mt-2 mb-0">Только администратор может выдавать права.</p>
    </div>
  ` : ""}
  `;

  if (canEditCosts) {
    app.setupCostInput(
      container.querySelector('[data-role="default-cost"]'),
      app.state.settings.defaultBowlCost,
      (input) => app.updateDefaultBowlCost(input.value, input)
    );
  }

  // обработчик темы
  container.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      app.state.settings.theme = e.target.value;
      app.saveState(app.state);           // сохраняем без лишнего перерендера
      app.applyTheme(app.state.settings.theme);
      // при желании можно app.renderAll(); но не обязательно
    });
  });

  if (canManageAdmins) {
    const adminInput = container.querySelector('[data-role="admin-user-id"]');
    const grantButton = container.querySelector('[data-action="grant-admin"]');
    grantButton?.addEventListener('click', () => {
      app.grantAdminRole(adminInput?.value, adminInput);
    });
    adminInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        app.grantAdminRole(adminInput?.value, adminInput);
      }
    });
  }
}
