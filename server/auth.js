const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const db = require('./db');

// Checking a Firebase login token only needs the project ID, not a service account.
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });

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

// Works out who is making the request. Sets req.login (Firebase) and req.user (our database row, or null).
async function loadUser(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try {
    req.login = await module.exports.verifyToken(token);
  } catch (err) {
    // Usually a wrong FIREBASE_PROJECT_ID, the server's clock being off, or no internet access from the server.
    console.error('Login check failed:', err.code || '', err.message);
    return res.status(401).json({ error: 'Please log in again.' });
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

module.exports = { verifyToken, isDriverLogin, loadUser, approvedOnly, driverOnly };
