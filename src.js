import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('ضع JWT_SECRET بطول 32 حرفًا على الأقل داخل ملف .env');
  process.exit(1);
}

const db = new Database(process.env.DATABASE_FILE || './sabry-chat.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_pair
  ON messages(sender_id, receiver_id, id);
`);

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }
});

const makeToken = (user) =>
  jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'سجّل الدخول أولًا' });
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'SABRY CHAT' }));

app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون من 3 إلى 24 حرفًا أو رقمًا' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  const user = { id: Number(result.lastInsertRowid), username };
  res.status(201).json({ token: makeToken(user), user });
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  const user = { id: row.id, username: row.username };
  res.json({ token: makeToken(user), user });
});

app.get('/api/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, username FROM users WHERE id != ? ORDER BY username').all(req.user.id);
  res.json(users);
});

app.get('/api/messages/:otherId', auth, (req, res) => {
  const otherId = Number(req.params.otherId);
  if (!Number.isInteger(otherId) || otherId < 1) return res.status(400).json({ error: 'مستخدم غير صالح' });
  const messages = db.prepare(`
    SELECT id, sender_id AS senderId, receiver_id AS receiverId, body, created_at AS createdAt
    FROM messages
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY id ASC LIMIT 500
  `).all(req.user.id, otherId, otherId, req.user.id);
  res.json(messages);
});

function roomFor(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join(':');
}

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth?.token || '', JWT_SECRET);
    next();
  } catch {
    next(new Error('غير مصرح'));
  }
});

io.on('connection', (socket) => {
  socket.on('join-chat', (otherId) => {
    const id = Number(otherId);
    if (Number.isInteger(id) && id > 0 && id !== socket.user.id) {
      socket.join(roomFor(socket.user.id, id));
    }
  });

  socket.on('send-message', (payload, callback) => {
    const receiverId = Number(payload?.receiverId);
    const body = String(payload?.body || '').trim();
    if (!Number.isInteger(receiverId) || receiverId < 1 || receiverId === socket.user.id ||
        body.length < 1 || body.length > 4000) {
      return callback?.({ error: 'الرسالة أو المستلم غير صالح' });
    }
    const receiver = db.prepare('SELECT id FROM users WHERE id = ?').get(receiverId);
    if (!receiver) return callback?.({ error: 'المستخدم غير موجود' });

    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)'
    ).run(socket.user.id, receiverId, body);

    const message = db.prepare(`
      SELECT id, sender_id AS senderId, receiver_id AS receiverId, body, created_at AS createdAt
      FROM messages WHERE id = ?
    `).get(Number(result.lastInsertRowid));

    io.to(roomFor(socket.user.id, receiverId)).emit('new-message', message);
    callback?.({ ok: true, message });
  });
});

server.listen(PORT, () => console.log(`SABRY CHAT API running on port ${PORT}`));
