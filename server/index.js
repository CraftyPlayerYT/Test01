require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { db, init } = require('./db');
const { sign, middleware, SECRET } = require('./auth');
const twilio = require('twilio');

init();

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// rate limiter (basic)
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', apiLimiter);

// register
app.post('/api/register', async (req, res) => {
  const schema = Joi.object({ username: Joi.string().alphanum().min(3).max(30).required(), password: Joi.string().min(6).required(), displayName: Joi.string().max(50).allow('', null), phone: Joi.string().pattern(/^[0-9+\- ]{6,20}$/).required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  const { username, password, displayName, phone } = value;
  const hash = await bcrypt.hash(password, 12);
  db.run('INSERT INTO users (username, password, displayName, phone) VALUES (?, ?, ?, ?)', [username, hash, displayName || username, phone], function (err) {
    if (err) return res.status(400).json({ error: 'User exists or DB error' });
    const user = { id: this.lastID, username, displayName: displayName || username, phone };
    const token = sign(user);
    res.json({ user, token });
  });
});

// login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const user = { id: row.id, username: row.username, displayName: row.displayName, phone: row.phone, phone_verified: !!row.phone_verified };
    const token = sign(user);
    res.json({ user, token });
  });
});

// send verification code (to phone) — requires phone in body
app.post('/api/send_verification', async (req, res) => {
  const schema = Joi.object({ phone: Joi.string().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  const phone = value.phone;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000; // 5 min
  db.run('INSERT INTO phone_verifications (phone, code, expires_at) VALUES (?, ?, ?)', [phone, code, expires], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    // try Twilio if configured
    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      client.messages.create({ body: `Votre code de vérification: ${code}`, from: process.env.TWILIO_FROM, to: phone }).then(()=>{
        res.json({ ok: true });
      }).catch(e=>{
        console.error('Twilio error', e);
        res.json({ ok: true, warning: 'Twilio error, code logged on server' });
      });
    } else {
      console.log('Verification code for', phone, code);
      res.json({ ok: true, info: 'Twilio non configuré, code loggé côté serveur' });
    }
  });
});

// verify code
app.post('/api/verify_phone', middleware, (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'Missing fields' });
  db.get('SELECT * FROM phone_verifications WHERE phone = ? AND code = ? ORDER BY id DESC LIMIT 1', [phone, code], (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Invalid code' });
    if (row.expires_at < Date.now()) return res.status(400).json({ error: 'Code expired' });
    // mark user's phone_verified
    db.run('UPDATE users SET phone_verified = 1 WHERE id = ?', [req.user.id], function (e) {
      if (e) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true });
    });
  });
});

// protected: me
app.get('/api/me', middleware, (req, res) => {
  db.get('SELECT id, username, displayName FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });
    res.json({ user: row });
  });
});

// contacts
app.get('/api/contacts', middleware, (req, res) => {
  db.all('SELECT id, username, displayName FROM users WHERE id != ?', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ contacts: rows });
  });
});

// messages between users
app.get('/api/messages/:otherId', middleware, (req, res) => {
  const otherId = parseInt(req.params.otherId, 10);
  const me = req.user.id;
  db.all('SELECT * FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY timestamp ASC', [me, otherId, otherId, me], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ messages: rows });
  });
});

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

// simple in-memory map userId -> socket id(s)
const userSockets = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Missing token'));
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, SECRET);
    socket.user = payload;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  if (!userSockets.has(uid)) userSockets.set(uid, new Set());
  userSockets.get(uid).add(socket.id);

  socket.on('private_message', (data) => {
    const { to, content } = data;
    const timestamp = Date.now();
    db.run('INSERT INTO messages (from_id, to_id, content, timestamp) VALUES (?, ?, ?, ?)', [uid, to, content, timestamp], function (err) {
      if (err) return;
      const msg = { id: this.lastID, from_id: uid, to_id: to, content, timestamp };
      // emit to recipient sockets
      const recipientSockets = userSockets.get(to);
      if (recipientSockets) {
        recipientSockets.forEach(sid => io.to(sid).emit('private_message', msg));
      }
      // ack back to sender
      socket.emit('private_message', msg);
    });
  });

  socket.on('disconnect', () => {
    const set = userSockets.get(uid);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) userSockets.delete(uid);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
