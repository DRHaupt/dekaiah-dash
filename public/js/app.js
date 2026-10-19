// Start-up: login, sign-up, waiting for approval, then the passenger or driver screens.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { api, setTokenSource, connectLive, stopLive } from './api.js';
import { $, esc, icons, page, closePage, onActions, busy, toast } from './ui.js';
import { initMap } from './map.js';
import { setVapidKey, refreshPush, disablePush, enablePush } from './push.js';
import * as rider from './rider.js';
import * as driver from './driver.js';

let auth;

// ---------- Invite link ----------

// Invite links look like https://your-site/join/abc123. Remember the code until sign-up is done.
const joinMatch = location.pathname.match(/^\/join\/([\w-]+)/);
if (joinMatch) {
  try { localStorage.setItem('invite', joinMatch[1]); } catch { /* private mode */ }
  history.replaceState(null, '', '/');
}
const inviteCode = () => { try { return localStorage.getItem('invite'); } catch { return null; } };

// ---------- Friendly Firebase errors ----------

function loginError(err) {
  const code = err && err.code ? err.code : '';
  const messages = {
    'auth/invalid-email': "That email doesn't look right.",
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': "That email and password don't match.",
    'auth/wrong-password': "That email and password don't match.",
    'auth/user-not-found': "There's no account with that email.",
    'auth/email-already-in-use': 'There is already an account with that email. Try logging in.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/too-many-requests': 'Too many tries. Wait a bit and try again.',
    'auth/network-request-failed': "Couldn't connect. Check your internet.",
    'auth/popup-closed-by-user': 'Sign-in was closed before it finished.',
  };
  // Unknown problems show Firebase's code so it can be looked up.
  return new Error(messages[code] || `Sign-in didn’t work (${code || err.message}). Try again.`);
}

// ---------- Screens before the app ----------

function showWelcome() {
  const el = page(`<div class="page-inner welcome">
    <div class="brand">
      <div class="brand-name">Dekaiah Dash</div>
      <p class="muted" style="margin-top:8px">Rides from Dekaiah.</p>
    </div>
    <div class="stack">
      <button class="btn" data-action="google">Continue with Google</button>
      <button class="btn light" data-action="email-login">Log in with email</button>
      <button class="link-btn" style="width:100%" data-action="email-signup">Sign up with email</button>
    </div>
  </div>`);
  onActions(el, {
    google: (d, btn) => busy(btn, googleLogin),
    'email-login': () => showEmailForm('login'),
    'email-signup': () => showEmailForm('signup'),
  });
}

async function googleLogin() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // Some phones block pop-ups; send them to Google and back instead.
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(err.code)) {
      await signInWithRedirect(auth, provider);
    } else {
      throw loginError(err);
    }
  }
}

function showEmailForm(mode) {
  const signup = mode === 'signup';
  const el = page(`<div class="page-inner">
    <div class="page-head"><button class="icon-btn" data-action="back" aria-label="Back">${icons.back}</button><h2>${signup ? 'Sign up' : 'Log in'}</h2></div>
    <form class="stack" id="email-form">
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
      <button class="btn" type="submit">${signup ? 'Sign up' : 'Log in'}</button>
      ${signup ? '' : '<button class="link-btn" type="button" data-action="forgot">Forgot password?</button>'}
    </form>
  </div>`);
  onActions(el, {
    back: showWelcome,
    forgot: (d, btn) => busy(btn, async () => {
      const email = el.querySelector('[name=email]').value.trim();
      if (!email) throw new Error('Type your email first.');
      try { await sendPasswordResetEmail(auth, email); } catch (err) { throw loginError(err); }
      toast('Check your email for a link to reset your password.', 6000);
    }),
  });
  $('#email-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const email = form.email.value.trim();
    const password = form.password.value;
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        if (signup) await createUserWithEmailAndPassword(auth, email, password);
        else await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        throw loginError(err);
      }
    });
  });
}

function showSignup(me) {
  const el = page(`<div class="page-inner">
    <div class="page-head"><h2>Almost done</h2></div>
    <form class="stack" id="signup-form">
      <p class="muted">${me.isDriverLogin ? 'This is the driver account.' : `So ${esc(me.driverName)} knows who you are.`}</p>
      <label class="field"><span>Your name</span><input name="name" autocomplete="name" required maxlength="60" value="${esc(me.login.name)}"></label>
      <label class="field"><span>Phone number</span><input name="phone" type="tel" autocomplete="tel" required maxlength="30"></label>
      <p class="small muted">Used for calls and text alerts about your rides.</p>
      <button class="btn" type="submit">Continue</button>
      <button class="link-btn" type="button" data-action="logout">Log out</button>
    </form>
  </div>`);
  onActions(el, { logout });
  $('#signup-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    busy(form.querySelector('[type=submit]'), async () => {
      await api('POST', '/signup', { name: form.name.value, phone: form.phone.value, invite: inviteCode() });
      try { localStorage.removeItem('invite'); } catch { /* ignore */ }
      await afterLogin();
    });
  });
}

function showMessage(title, text, { canLogout = true } = {}) {
  const el = page(`<div class="page-inner welcome">
    <div class="brand stack"><h1>${esc(title)}</h1><p class="muted">${text}</p></div>
    ${canLogout ? '<button class="btn light" data-action="logout">Log out</button>' : ''}
  </div>`);
  onActions(el, { logout });
}

// ---------- Logged in ----------

async function afterLogin() {
  let me;
  try {
    me = await api('GET', '/me');
  } catch (err) {
    return showMessage("Can't connect", esc(err.message) + ' <br><br><button class="btn light" onclick="location.reload()">Try again</button>');
  }
  const user = me.user;

  if (!user) {
    if (me.isDriverLogin || inviteCode()) return showSignup(me);
    return showMessage('You need an invite', `Dekaiah Dash is invite-only. Ask ${esc(me.driverName)} for an invite link, then open it on this phone.`);
  }
  if (user.status === 'blocked') {
    return showMessage("You can't use Dekaiah Dash", `Talk to ${esc(me.driverName)} if you think this is a mistake.`);
  }

  // Reload whenever the server says something about this account changed (approved, removed, blocked).
  connectLive((msg) => {
    if (msg.type === 'me') location.reload();
    else if (user.status === 'approved') (user.role === 'driver' ? driver : rider).onLive(msg);
  }, () => {
    if (user.status === 'approved') (user.role === 'driver' ? driver : rider).onReconnect();
  });

  if (user.status === 'pending') {
    showMessage(`Thanks, ${user.name.split(' ')[0]}`,
      `${esc(me.driverName)} needs to approve you before you can request rides. You'll get a text when you're in.`);
    return;
  }

  closePage();
  setupDrawer(user);
  refreshPush();
  const module = user.role === 'driver' ? driver : rider;
  module.start({ user, driverName: me.driverName, logout, enablePush });
}

async function logout() {
  await disablePush();
  stopLive();
  await signOut(auth);
  location.reload();
}

// ---------- Menu ----------

function setupDrawer(user) {
  const items = user.role === 'driver'
    ? [['scheduled', icons.calendar, 'Scheduled rides'], ['friends', icons.users, 'Friends'], ['history', icons.history, 'Ride history'], ['settings', icons.settings, 'Settings']]
    : [['history', icons.history, 'Ride history'], ['places', icons.pin, 'Saved places'], ['account', icons.user, 'Account']];

  const drawer = $('#drawer');
  drawer.innerHTML = `<div class="who"><h3>${esc(user.name)}</h3><div class="small muted">${user.role === 'driver' ? 'Driver' : 'Passenger'}</div></div>
    ${items.map(([key, icon, label]) => `<button data-action="${key}">${icon}${label}</button>`).join('')}
    <button data-action="logout">${icons.logout}Log out</button>`;

  const open = () => { drawer.classList.add('open'); $('#drawer-bg').classList.remove('hidden'); };
  const close = () => { drawer.classList.remove('open'); $('#drawer-bg').classList.add('hidden'); };
  const module = user.role === 'driver' ? driver : rider;

  $('#menu-btn').innerHTML = icons.menu;
  $('#menu-btn').classList.remove('hidden');
  $('#menu-btn').onclick = open;
  $('#drawer-bg').onclick = close;
  drawer.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    close();
    if (btn.dataset.action === 'logout') logout();
    else module.openPage(btn.dataset.action);
  };
}

// ---------- Boot ----------

// Logins are saved in the browser. Private Browsing or "Block All Cookies" stops that,
// which makes login look like it works and then forget you straight away.
function canSaveLogin() {
  try {
    for (const store of [localStorage, sessionStorage]) {
      store.setItem('dd-test', '1');
      store.removeItem('dd-test');
    }
    return !!window.indexedDB;
  } catch {
    return false;
  }
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  if (!canSaveLogin()) {
    return showMessage("This browser can't keep you logged in",
      'Your browser is blocking websites from saving data, so your login gets forgotten. '
      + 'On iPhone, turn off <b>Settings → Safari → Block All Cookies</b> and close any Private tabs. '
      + 'Then open Dekaiah Dash in a normal tab.', { canLogout: false });
  }

  let config;
  try {
    config = await (await fetch('/api/config')).json();
  } catch {
    return showMessage("Can't connect", "Couldn't reach the server. Check your connection and try again.", { canLogout: false });
  }
  if (!config.firebase.apiKey) {
    return showMessage('Almost set up', 'The Firebase settings are missing from the server’s .env file.', { canLogout: false });
  }
  setVapidKey(config.vapidPublicKey);
  initMap();

  const app = initializeApp(config.firebase);
  auth = getAuth(app);
  setTokenSource((fresh) => (auth.currentUser ? auth.currentUser.getIdToken(!!fresh) : null));
  getRedirectResult(auth).catch((err) => toast(loginError(err).message));

  let started = false;
  onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser) return showWelcome();
    if (started) return;
    started = true;
    afterLogin();
  });
}

boot();
