import { bootstrapApp, flushStateToCloudKeepalive } from './app.js';

window.addEventListener('DOMContentLoaded', async () => {
  const w = document.getElementById('welcome');
  if (w) w.remove();
  await bootstrapApp();

  const el = document.getElementById('year');
  if (el) el.textContent = String(new Date().getFullYear());
});

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushStateToCloudKeepalive();
});
window.addEventListener('beforeunload', flushStateToCloudKeepalive);
