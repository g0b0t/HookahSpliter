import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');
const LOGS_FILE = join(DATA_DIR, 'logs.json');
const DEFAULT_BOWL_COST = 500;
const TOKEN_SECRET = process.env.JWT_SECRET || 'dev-secret-token';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const readJsonFile = async (filePath, defaultValue) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeJsonFile(filePath, defaultValue);
      return defaultValue;
    }
    console.error('Failed to read JSON file', filePath, error);
    return JSON.parse(JSON.stringify(defaultValue));
  }
};

const writeJsonFile = async (filePath, data) => {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fsPromises.rename(tmpPath, filePath);
};

const ensureDataShape = async () => {
  await fsPromises.mkdir(DATA_DIR, { recursive: true });
  await readJsonFile(USERS_FILE, []);
  await readJsonFile(SESSIONS_FILE, { sessions: [] });
  await readJsonFile(LOGS_FILE, []);
};

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch (error) {
    return {};
  }
};

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-InitData',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(body);
};

const notFound = (res) => sendJson(res, 404, { error: 'Not found' });

const createToken = (payload) => {
  const issuedAt = Date.now();
  const base = Buffer.from(JSON.stringify({ ...payload, iat: issuedAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(base).digest('base64url');
  return `${base}.${signature}`;
};

const verifyToken = (token) => {
  if (!token) return null;
  const [base, signature] = token.split('.');
  if (!base || !signature) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(base).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(base, 'base64url').toString('utf-8'));
  } catch (error) {
    return null;
  }
};

const parseInitData = (initDataRaw) => {
  if (!initDataRaw) return null;
  const params = new URLSearchParams(initDataRaw);
  const authDate = params.get('auth_date');
  const hash = params.get('hash');
  if (!hash) return null;
  const dataCheckArr = [];
  params.forEach((value, key) => {
    if (key === 'hash') return;
    dataCheckArr.push(`${key}=${value}`);
  });
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (BOT_TOKEN && calculatedHash !== hash) {
    console.warn('Invalid initData hash', { initDataRaw, calculatedHash, hash });
    return null;
  }
  const user = params.get('user');
  const payload = user ? JSON.parse(user) : null;
  if (!payload) return null;
  return {
    telegramId: payload.id,
    username: payload.username || '',
    firstName: payload.first_name || '',
    lastName: payload.last_name || '',
    authDate,
  };
};

const loadUsers = async () => readJsonFile(USERS_FILE, []);
const saveUsers = async (users) => writeJsonFile(USERS_FILE, users);
const loadSessions = async () => readJsonFile(SESSIONS_FILE, { sessions: [] });
const saveSessions = async (data) => writeJsonFile(SESSIONS_FILE, data);
const loadLogs = async () => readJsonFile(LOGS_FILE, []);
const saveLogs = async (logs) => writeJsonFile(LOGS_FILE, logs);

const logAction = async (entry) => {
  const logs = await loadLogs();
  const enriched = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  logs.unshift(enriched);
  await saveLogs(logs.slice(0, 1000));
};

const ensureAdminExists = async (users) => {
  if (users.some((user) => user.role === 'admin')) {
    return users;
  }
  if (!users.length) {
    return users;
  }
  users[0].role = 'admin';
  await saveUsers(users);
  await logAction({
    userId: users[0].id,
    action: 'promote:first-user',
    description: 'Первый пользователь автоматически назначен администратором',
  });
  return users;
};

const upsertUserFromTelegram = async (telegramProfile) => {
  const users = await loadUsers();
  let user = users.find((u) => u.telegramId === telegramProfile.telegramId);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      telegramId: telegramProfile.telegramId,
      username: telegramProfile.username,
      firstName: telegramProfile.firstName,
      lastName: telegramProfile.lastName,
      createdAt: new Date().toISOString(),
      settings: { notifyOnNewBowl: true },
      role: users.length === 0 ? 'admin' : 'user',
    };
    users.push(user);
    await logAction({
      userId: user.id,
      action: 'user:create',
      description: 'Создан новый пользователь из Telegram WebApp',
      meta: { username: user.username },
    });
  } else {
    const nextUser = {
      ...user,
      username: telegramProfile.username,
      firstName: telegramProfile.firstName,
      lastName: telegramProfile.lastName,
      updatedAt: new Date().toISOString(),
    };
    const idx = users.findIndex((u) => u.id === user.id);
    users[idx] = nextUser;
    user = nextUser;
  }
  await saveUsers(users);
  await ensureAdminExists(users);
  return user;
};

const authenticateRequest = async (req) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload) return null;
  const users = await loadUsers();
  return users.find((user) => user.id === payload.userId) || null;
};

const filterSessionForUser = (session, user) => {
  if (user.role === 'admin') return session;
  const participantIds = new Set(session.participants?.map((p) => p.userId));
  if (!participantIds.has(user.id)) return null;
  return {
    ...session,
    bowls: session.bowls?.map((bowl) => ({
      ...bowl,
      participantIds: bowl.participantIds,
    })) || [],
  };
};

const sendNotification = async (telegramUserId, message) => {
  if (!telegramUserId) return;
  if (!BOT_TOKEN) {
    console.log('[notify]', telegramUserId, message);
    return;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramUserId, text: message }),
    });
    if (!response.ok) {
      console.warn('Failed to send Telegram notification', await response.text());
    }
  } catch (error) {
    console.error('Telegram notification error', error);
  }
};

const addParticipantToSession = (session, userId, actorId) => {
  const nextSession = { ...session };
  nextSession.participants = Array.isArray(session.participants)
    ? [...session.participants]
    : [];
  const already = nextSession.participants.find((p) => p.userId === userId);
  if (!already) {
    nextSession.participants.push({ userId, joinedAt: new Date().toISOString(), invitedBy: actorId });
  }
  return nextSession;
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-InitData',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/auth/telegram') {
    const body = await parseBody(req);
    const initDataRaw = body?.initData || req.headers['x-telegram-initdata'];
    let profile = null;
    if (initDataRaw) {
      profile = parseInitData(initDataRaw);
    }
    if (!profile && body?.devUser) {
      profile = {
        telegramId: body.devUser.id,
        username: body.devUser.username || '',
        firstName: body.devUser.firstName || '',
        lastName: body.devUser.lastName || '',
      };
    }
    if (!profile) {
      sendJson(res, 400, { error: 'initData is required' });
      return;
    }
    const user = await upsertUserFromTelegram(profile);
    const token = createToken({ userId: user.id });
    sendJson(res, 200, { token, user });
    return;
  }

  const user = await authenticateRequest(req);
  if (!user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET' && pathname === '/me') {
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === 'GET' && pathname === '/participants') {
    const users = await loadUsers();
    if (user.role === 'admin') {
      sendJson(res, 200, { participants: users.map((u) => ({
        id: u.id,
        telegramId: u.telegramId,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        settings: u.settings,
      })) });
      return;
    }
    const self = users.find((u) => u.id === user.id);
    sendJson(res, 200, { participants: [self].filter(Boolean).map((u) => ({
      id: u.id,
      telegramId: u.telegramId,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      settings: u.settings,
    })) });
    return;
  }

  if (req.method === 'POST' && pathname === '/participants/settings') {
    const body = await parseBody(req);
    if (!body?.settings) {
      sendJson(res, 400, { error: 'settings required' });
      return;
    }
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    users[idx] = { ...users[idx], settings: { ...users[idx].settings, ...body.settings } };
    await saveUsers(users);
    await logAction({ userId: user.id, action: 'user:update-settings', meta: body.settings });
    sendJson(res, 200, { settings: users[idx].settings });
    return;
  }

  if (req.method === 'POST' && pathname === '/participants/promote') {
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const body = await parseBody(req);
    const targetId = body?.userId;
    if (!targetId) {
      sendJson(res, 400, { error: 'userId required' });
      return;
    }
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === targetId);
    if (idx === -1) {
      sendJson(res, 404, { error: 'User not found' });
      return;
    }
    users[idx] = { ...users[idx], role: body.role === 'admin' ? 'admin' : 'user' };
    await saveUsers(users);
    await logAction({ userId: user.id, action: 'user:update-role', meta: { targetId, role: users[idx].role } });
    sendJson(res, 200, { user: users[idx] });
    return;
  }

  if (req.method === 'GET' && pathname === '/sessions/current') {
    const { sessions } = await loadSessions();
    const active = sessions.find((session) => session.isActive);
    if (!active) {
      sendJson(res, 200, { session: null });
      return;
    }
    const filtered = filterSessionForUser(active, user);
    sendJson(res, 200, { session: filtered });
    return;
  }

  if (req.method === 'GET' && pathname === '/sessions/history') {
    const { sessions } = await loadSessions();
    const history = sessions
      .filter((session) => !session.isActive)
      .map((session) => filterSessionForUser(session, user))
      .filter(Boolean);
    sendJson(res, 200, { sessions: history });
    return;
  }

  if (req.method === 'POST' && pathname === '/sessions') {
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const body = await parseBody(req);
    const name = (body?.name || '').trim() || `Вечер ${new Date().toLocaleDateString('ru-RU')}`;
    const sessionId = crypto.randomUUID();
    const bowlId = crypto.randomUUID();
    const session = {
      id: sessionId,
      name,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      isActive: true,
      createdBy: user.id,
      bowls: [
        {
          id: bowlId,
          name: 'Чаша 1',
          cost: body?.defaultBowlCost ?? DEFAULT_BOWL_COST,
          participantIds: [],
        },
      ],
      activeBowlId: bowlId,
      participants: [],
    };
    const data = await loadSessions();
    data.sessions = [session, ...data.sessions.filter((s) => s.isActive === false)];
    await saveSessions(data);
    await logAction({ userId: user.id, action: 'session:create', meta: { sessionId } });
    sendJson(res, 201, { session });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/end')) {
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const [, resource, sessionId] = pathname.split('/');
    if (resource !== 'sessions' || !sessionId) {
      notFound(res);
      return;
    }
    const data = await loadSessions();
    const idx = data.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    const session = data.sessions[idx];
    data.sessions[idx] = {
      ...session,
      isActive: false,
      endedAt: new Date().toISOString(),
    };
    await saveSessions(data);
    await logAction({ userId: user.id, action: 'session:end', meta: { sessionId } });
    sendJson(res, 200, { session: data.sessions[idx] });
    return;
  }

  if (req.method === 'POST' && pathname.includes('/bowls') && !pathname.endsWith('/participants')) {
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const parts = pathname.split('/');
    const sessionId = parts[2];
    const data = await loadSessions();
    const idx = data.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    const body = await parseBody(req);
    const bowlId = crypto.randomUUID();
    const session = data.sessions[idx];
    const nextBowls = Array.isArray(session.bowls) ? [...session.bowls] : [];
    nextBowls.push({
      id: bowlId,
      name: body?.name || `Чаша ${nextBowls.length + 1}`,
      cost: Number(body?.cost) || DEFAULT_BOWL_COST,
      participantIds: body?.participantIds || [],
    });
    data.sessions[idx] = { ...session, bowls: nextBowls, activeBowlId: bowlId };
    await saveSessions(data);
    await logAction({ userId: user.id, action: 'bowl:create', meta: { sessionId, bowlId } });
    sendJson(res, 201, { bowl: nextBowls[nextBowls.length - 1] });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/participants')) {
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const parts = pathname.split('/');
    const sessionId = parts[2];
    const bowlId = parts[4];
    const body = await parseBody(req);
    const participantId = body?.userId;
    if (!participantId) {
      sendJson(res, 400, { error: 'userId required' });
      return;
    }
    const data = await loadSessions();
    const idx = data.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    const session = data.sessions[idx];
    if (!session.isActive) {
      sendJson(res, 400, { error: 'Session is not active' });
      return;
    }
    const bowlIndex = session.bowls.findIndex((b) => b.id === bowlId);
    if (bowlIndex === -1) {
      sendJson(res, 404, { error: 'Bowl not found' });
      return;
    }
    const bowl = session.bowls[bowlIndex];
    const wasParticipant = Array.isArray(session.participants)
      ? session.participants.some((p) => p.userId === participantId)
      : false;
    if (!bowl.participantIds.includes(participantId)) {
      bowl.participantIds.push(participantId);
    }
    const nextSession = addParticipantToSession(session, participantId, user.id);
    session.participants = nextSession.participants;
    session.bowls[bowlIndex] = bowl;
    data.sessions[idx] = session;
    await saveSessions(data);
    await logAction({ userId: user.id, action: 'bowl:add-participant', meta: { sessionId, bowlId, participantId } });

    const users = await loadUsers();
    const participant = users.find((u) => u.id === participantId);
    if (!wasParticipant && participant?.settings?.notifyOnNewBowl !== false && participant.telegramId) {
      await sendNotification(
        participant.telegramId,
        `Вас добавили в чашу "${bowl.name}" сессии "${session.name}"`
      );
    }
    sendJson(res, 200, { bowl });
    return;
  }

  if (req.method === 'GET' && pathname === '/admin/logs') {
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const logs = await loadLogs();
    const limit = Number(url.searchParams.get('limit') || '100');
    sendJson(res, 200, { logs: logs.slice(0, Math.min(limit, 500)) });
    return;
  }

  notFound(res);
});

ensureDataShape()
  .then(() => {
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to prepare data directory', error);
    process.exit(1);
  });
