export const MAX_COST_DIGITS = 5;
export const MAX_COST_VALUE = Number('9'.repeat(MAX_COST_DIGITS));

export const formatCurrency = (value) => `${Math.round(value || 0).toLocaleString('ru-RU')} ₽`;

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const formatDateTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};

export const formatDateRange = (start, end) => {
  const startText = formatDateTime(start);
  const endText = formatDateTime(end);
  if (!startText && !endText) return '';
  if (!endText) return startText;
  return `${startText} — ${endText}`;
};

export function isTelegramAuthorized() {
  return Boolean(window.tg?.initDataUnsafe?.user?.id);
}
