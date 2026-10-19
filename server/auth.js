const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const db = require('./db');

// Checking a Firebase login token only needs the project ID, not a service account.
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });

const COOKIE = 'dd_session';
const SESSION_DAYS = 90;

async function verifyToken(token) {
  const decoded = await getAuth().verifyIdToken(token);
  return { uid: decoded.uid, email: decoded.email || null, emailVerified: !!decoded.email_verified, name: decoded.name || '' };
}

// The driver account is whoever logs in with DRIVER_EMAIL, as long as that email is verified
// (signing in with Google counts), so nobody else can claim it.
function isDriverLogin(login) {
  const email = (login.email || '').toLowerCase();
  return !!email && login.emailVerified && email === (process.env.DRIVER_EMAIL || '').toLowerCase();
}

// ---------- Login cookie ----------
// After Firebase confirms who someone is, the phone gets our own cookie, so it stays logged in
// no matter what the browser does with Firebase's saved login (iPhone Safari sometimes drops it).

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function cookieHeader(req, token, maxAgeSeconds) {
  const secure = (process.env.PUBLIC_URL || '').startsWith('https') || req.secure || req.get('x-forwarded-proto') === 'https';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

async function startSession(req, res, login) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    'INSERT INTO sessions (token, firebase_uid, email, email_verified, name) VALUES ($1, $2, $3, $4, $5)',
    [token, login.uid, login.email, login.emailVerified, login.name]
  );
  res.set('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
}

async function endSession(req, res) {
  const token = readCookie(req.get('Cookie'), COOKIE);
  if (token) await db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.set('Set-Cookie', cookieHeader(req, '', 0));
}

async function loginFromCookie(header) {
  const token = readCookie(header, COOKIE);
  if (!token) return null;
  const row = await db.one(
    `SELECT * FROM sessions WHERE token = $1 AND created_at > now() - interval '${SESSION_DAYS} days'`,
    [token]
  );
  return row ? { uid: row.firebase_uid, email: row.email, emailVerified: row.email_verified, name: row.name } : null;
}

// Who is this? Uses the login cookie, or a Firebase token if one was sent. Returns null if neither works.
async function loginFrom(cookie, bearer) {
  const fromCookie = await loginFromCookie(cookie);
  if (fromCookie) return fromCookie;
  if (!bearer) return null;
  try {
    return await module.exports.verifyToken(bearer);
  } catch (err) {
    // Usually a wrong FIREBASE_PROJECT_ID, the server's clock being off, or no internet access from the server.
    console.error('Login check failed:', err.code || '', err.message);
    return null;
  }
}

// Works out who is making the request. Sets req.login and req.user (our database row, or null).
async function loadUser(req, res, next) {
  const header = req.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.login = await loginFrom(req.get('Cookie'), bearer);
  if (!req.login) {
    // Opening the app logged out asks /api/me first, which is expected to fail, so that one isn't logged.
    if (!bearer && req.path !== '/me') console.error('Login check failed: no login cookie or token', req.method, req.originalUrl);
    return res.status(401).json({ error: 'Please log in.' });
  }
  req.user = await db.one('SELECT * FROM users WHERE firebase_uid = $1', [req.login.uid]);
  next();
}

function approvedOnly(req, res, next) {
  if (!req.user) return res.status(403).json({ error: 'Finish signing up first.' });
  if (req.user.status !== 'approved') return res.status(403).json({ error: "You can't do that yet." });
  next();
}

function driverOnly(req, res, next) {
  if (!req.user || req.user.role !== 'driver') return res.status(403).json({ error: 'Only the driver can do that.' });
  next();
}

module.exports = {
  verifyToken, isDriverLogin, loginFrom, startSession, endSession,
  loadUser, approvedOnly, driverOnly,
};
