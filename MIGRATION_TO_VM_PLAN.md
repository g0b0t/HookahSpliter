# План миграции HookahSpliter с Cloudflare на Ubuntu 22.04 VM (с KV-аналогом, без SQL)

## 1) Исходная точка

Сейчас проект уже работает в модели Cloudflare Functions + KV:

- API в `functions/*` (`/state`, `/sessions`, `/auth/telegram`, `/admin/role` и т.д.).
- Данные хранятся ключами в KV:
  - `user:{uid}:state`
  - `user:{uid}:session:{id}`
  - `admin_uids`
  - `admin_usernames`

С учётом малого объёма данных и невысоких требований к скорости, целесообразно оставить **ключ-значение** модель и на VM.

## 2) Целевая архитектура на VM

Рекомендуемый production-стек:

- **Nginx** — HTTPS, reverse proxy, статика.
- **Node.js 20 LTS** + **PM2** (или systemd) — backend API.
- **Redis** (или KeyDB) — KV-аналог вместо БД.
- **Certbot** — TLS сертификат Let's Encrypt.
- **UFW + Fail2ban** — базовая защита.

> Почему Redis: простой, стабильный, хорошо подходит под текущую структуру ключей, минимальный порог поддержки.

## 3) Что установить на Ubuntu 22.04

```bash
# База
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw fail2ban nginx certbot python3-certbot-nginx

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential

# PM2
sudo npm i -g pm2

# Redis (KV-аналог)
sudo apt install -y redis-server
```

Проверка и автозапуск Redis:

```bash
sudo systemctl enable redis-server
sudo systemctl restart redis-server
sudo systemctl status redis-server
redis-cli ping
```

UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 4) Минимальная настройка Redis под прод

Файл: `/etc/redis/redis.conf`

Рекомендуется:

- `supervised systemd`
- `appendonly yes` (AOF для большей сохранности)
- `save 900 1`, `save 300 10`, `save 60 10000` (RDB snapshots)
- `maxmemory-policy noeviction` (не терять данные молча)
- `bind 127.0.0.1 ::1` (не открывать наружу)

После изменений:

```bash
sudo systemctl restart redis-server
```

## 5) План инфраструктурной миграции (по шагам)

1. **DNS и домен**
   - A-запись на белый IP VM.
   - Telegram WebApp должен использовать HTTPS-домен.

2. **Развёртывание приложения**
   - Клонировать репозиторий в `/var/www/hookahspliter`.
   - Поднять backend (PM2/systemd).
   - Настроить Nginx:
     - `/` -> статика;
     - `/auth/*`, `/state`, `/sessions*`, `/admin/*`, `/whoami`, `/ping` -> backend.

3. **TLS**
   - `certbot --nginx -d your-domain`.
   - Проверить автообновление сертификата.

4. **Миграция данных**
   - Выгрузить текущий KV в JSON.
   - Импортировать JSON в Redis (однократный скрипт).
   - Сверить количество ключей и выборочные payload.

5. **Soft-launch**
   - Прогнать smoke-сценарии на тестовых аккаунтах.
   - Сверить ответы `/state`, `/sessions`, `/whoami`.

6. **Cutover**
   - Переключить Telegram WebApp URL на новый домен.
   - Мониторить backend/Nginx/Redis.

## 6) Предварительный план изменения кода

## 6.1 Backend переносим 1:1 по API контракту

Создать `server/` (Fastify/Express), сохранить те же маршруты:

- `POST /auth/telegram`
- `POST /auth/logout`
- `GET /state`
- `PUT /state`
- `GET /sessions`
- `POST /sessions`
- `GET /sessions/:id`
- `DELETE /sessions/:id`
- `POST /admin/role`
- `GET /whoami`
- `GET /ping`

Контракт `GET /whoami` в новой версии должен быть диагностическим и безопасным:

- возвращает только `{ authorized: boolean, uid: masked | null }`;
- **не** возвращает raw `Cookie` или другие чувствительные заголовки;
- доступ только для admin-ролей, либо во включённом dev-режиме через ENV-флаг (`WHOAMI_DEV_ENABLED=true`).

Логика переносится из:

- `functions/auth/telegram.ts` — проверка `initData`.
- `functions/_utils.ts` — cookies, user role.
- `functions/state.ts` — `_rev` и conflict handling.
- `functions/sessions/*` — сохранение/чтение сессий.

## 6.2 Слой хранения: Redis-адаптер вместо KVNamespace

Добавить абстракцию `storage` с методами:

- `getJson(key)`
- `setJson(key, value)`
- `del(key)`
- `list(prefix)`

И реализовать её через Redis:

- `GET` / `SET`
- `DEL`
- `SCAN MATCH <prefix>*` (вместо `KV.list`)

### Ключи оставляем совместимыми

- `user:{uid}:state`
- `user:{uid}:session:{id}`
- `admin_uids`
- `admin_usernames`

Это упростит миграцию: можно перелить данные почти без трансформации.

## 6.3 Как заменить KV metadata для сессий

Сейчас в Cloudflare KV метаданные сессий хранятся отдельно (`metadata`). В Redis проще:

- хранить **полную сессию JSON** в `user:{uid}:session:{id}`;
- список `GET /sessions` собирать на лету из payload (title, startedAt, endedAt, totalCost).

Для малого объёма это нормально и просто.

(Оптимизация на будущее: отдельный ключ-индекс `user:{uid}:sessions:index`.)

## 6.4 Конкурентность `_rev`

Сохранить текущую модель optimistic lock (`clientRev < serverRev -> 409`).

Для большей атомарности можно сделать Lua-скрипт в Redis, но на малом трафике допустим и простой read-check-write.

## 6.5 Cookie и безопасность

Оставить текущий контракт cookie:

- `tg_uid` (HttpOnly, Secure, SameSite=None, Path=/)
- `tg_username` (HttpOnly, Secure, SameSite=None, Path=/)

Плюс:

- `trust proxy` в backend.
- `X-Forwarded-Proto https` в Nginx.
- body size limit (1–2MB).
- rate limit на `/auth/telegram`.

## 6.6 ENV переменные для VM-версии

- `TELEGRAM_BOT_TOKEN`
- `REDIS_URL=redis://127.0.0.1:6379`
- `PORT`
- `ADMIN_TG_UIDS` (опциональный bootstrap)
- `NODE_ENV=production`
- `WHOAMI_DEV_ENABLED=false` (в production держать выключенным)

## 7) Итерации работ

### Итерация 1 — Инфраструктура
- VM hardening (обновления, UFW, Fail2ban).
- Nginx + HTTPS.
- Node.js + PM2.
- Redis + persistence (AOF/RDB).

### Итерация 2 — Backend parity
- Реализовать API 1:1 с текущими ответами.
- Добавить storage adapter под Redis.
- Проверить кейсы auth/state/sessions/admin.

### Итерация 3 — Перенос данных
- Экспорт текущего KV.
- Импорт в Redis.
- Сверка ключей и выборочных значений.

### Итерация 4 — Переключение
- Обновить URL в Telegram WebApp.
- Smoke-тесты в Telegram (iOS/Android/Desktop).
- Мониторинг и fallback-план.

## 8) Чек-лист перед переключением

- [ ] Домен и HTTPS работают.
- [ ] `/ping` -> 200.
- [ ] Telegram auth выставляет `tg_uid` cookie.
- [ ] `/state` читает/пишет, conflict=409 отрабатывает.
- [ ] `/sessions` CRUD работает.
- [ ] Роли admin/user работают (`/admin/role`).
- [ ] Redis persistence включён и проверен.
- [ ] Настроены бэкапы Redis dump/AOF.

## 9) Риски и снижение

- **Риск:** потеря данных при сбое Redis.
  - **Снижение:** AOF + периодические бэкапы + `noeviction`.
- **Риск:** медленный `SCAN` при росте данных.
  - **Снижение:** при необходимости добавить индекс-ключи.
- **Риск:** несовпадение логики `initData` между CF и Node.
  - **Снижение:** вынести в отдельный модуль и покрыть тест-векторами.

---

Если нужно, следующим шагом подготовлю:
1) каркас `server/` (Fastify + redis client),
2) `storage`-адаптер с совместимыми ключами,
3) скрипт миграции KV JSON -> Redis,
4) production-конфиг Nginx под этот стек.
