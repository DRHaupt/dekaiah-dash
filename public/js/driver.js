// Everything the driver sees.
import { api, sendLive } from './api.js';
import {
  $, esc, icons, sheet, page, pageHead, onActions, busy, toast, formatWhen, closePage,
  routeHtml, avatarHtml, telLink, historyList, resizePhoto, STATUS_LABEL,
} from './ui.js';
import { setMarker, clearMarkers, fit, directionsLinks, setRoute } from './map.js';
import { pushBanner, pushStatus } from './push.js';
import { openChat, chatMessage, chatOpenFor } from './chat.js';

const MOVING = ['on_the_way', 'arrived', 'in_progress'];
const NEXT_STEP = {
  accepted: ['on_the_way', 'On the way'],
  on_the_way: ['arrived', 'Arrived'],
  arrived: ['in_progress', 'Start ride'],
  in_progress: ['done', 'Finish ride'],
};

let ctx;              // { user, logout, enablePush }
let info = {};        // car, photo, online
let rides = [];       // every open ride
let here = null;      // this phone's location
const unread = {};    // ride id -> unread messages
const seen = new Set(); // requests already alerted
let alertQueue = [];

const activeRide = () => rides.find((r) => MOVING.includes(r.status));
const requests = () => rides.filter((r) => r.status === 'requested');
// Accepted rides that are for now, or scheduled within the next 2 hours.
const upNext = () => rides.filter((r) => r.status === 'accepted'
  && (!r.scheduled_for || new Date(r.scheduled_for) - Date.now() < 2 * 3600 * 1000));
const scheduled = () => rides.filter((r) => r.scheduled_for && ['requested', 'accepted'].includes(r.status));

// ---------- Start-up and live updates ----------

export async function start(c) {
  ctx = c;
  $('#locate-btn').innerHTML = icons.locate;
  $('#locate-btn').classList.remove('hidden');
  $('#locate-btn').onclick = () => (here ? fit([here]) : toast('Waiting for your location…'));
  unlockSound();
  await loadAll();
  rides.filter((r) => r.status === 'requested').forEach((r) => seen.add(r.id));
  render();
  updateTracking();
  setInterval(() => { if (!chatOpenFor() && !$('#alert').offsetParent && !document.activeElement.closest('#sheet')) render(); }, 60000); // keeps "up next" times fresh
}

async function loadAll() {
  try {
    [info, rides] = await Promise.all([api('GET', '/driver'), api('GET', '/rides')]);
  } catch (err) {
    toast(err.message);
  }
}

export async function onReconnect() {
  await loadAll();
  for (const r of requests()) if (!seen.has(r.id)) { seen.add(r.id); alertQueue.push(r); }
  showNextAlert();
  render();
  updateTracking();
}

export function onLive(msg) {
  if (msg.type === 'ride') {
    const ride = msg.ride;
    const before = rides.find((r) => r.id === ride.id);
    rides = rides.filter((r) => r.id !== ride.id);
    if (['requested', 'accepted', ...MOVING].includes(ride.status)) rides.push(ride);

    if (ride.status === 'requested' && !seen.has(ride.id)) {
      seen.add(ride.id);
      alertQueue.push(ride);
      showNextAlert();
    }
    if (ride.status === 'cancelled' && before) {
      if (ride.cancelled_by === 'rider') toast(`${ride.rider_name} cancelled their ride.`, 6000);
      if (ride.cancelled_by === 'timeout') toast(`${ride.rider_name}'s request timed out. They got a text.`, 6000);
    }
    if (ride.status !== 'requested') {
      alertQueue = alertQueue.filter((r) => r.id !== ride.id);
      if (currentAlert && currentAlert.id === ride.id) closeAlert();
    }
    render();
    updateTracking();
  } else if (msg.type === 'message') {
    const m = msg.message;
    if (m.sender_id === ctx.user.id) { chatMessage(m); return; }
    if (!chatMessage(m)) {
      unread[m.ride_id] = (unread[m.ride_id] || 0) + 1;
      const ride = rides.find((r) => r.id === m.ride_id);
      toast(`${ride ? ride.rider_name.split(' ')[0] : 'Message'}: ${m.body}`);
      render();
    }
  } else if (msg.type === 'car') {
    // New route line from the server while driving to the pickup or drop-off.
    const ride = activeRide();
    if (ride && ride.id === msg.ride_id && msg.route) { ride.route = msg.route; setRoute(ride.route); }
  } else if (msg.type === 'friends') {
    if (friendsOpen) friendsPage();
    else toast('Someone wants to join. Check Friends.');
  }
}

// ---------- Location ----------

let watchId = null;
let lastSent = 0;
let wakeLock = null;

// Shares location while online or during a ride. Browsers only allow this while the app is open.
function updateTracking() {
  const want = info.online || !!activeRide() || upNext().length > 0;
  if (want && watchId == null && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const first = !here;
        here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMarker('car', here);
        if (first) fitView();
        if (Date.now() - lastSent > 4000) {
          lastSent = Date.now();
          sendLive({ type: 'location', ...here });
        }
      },
      (err) => { if (err.code === 1) toast('Location is off. Friends won’t see where you are. Turn it on in your phone settings.', 6000); },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  } else if (!want && watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  keepScreenOn(!!activeRide());
}

async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ctx) keepScreenOn(!!activeRide()); });

function fitView() {
  const ride = activeRide();
  if (!ride) return fit([here]);
  const dest = ride.status === 'in_progress'
    ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
    : { lat: ride.pickup_lat, lng: ride.pickup_lng };
  fit([here, dest]);
}

// ---------- Sound for new requests ----------

let audio = null;
let alarmTimer = null;

// Phones only allow sound after a tap, so get it ready on the first tap anywhere.
function unlockSound() {
  const unlock = () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    } catch { /* no sound on this phone */ }
  };
  document.addEventListener('pointerdown', unlock, { once: false, passive: true });
}

function beep() {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [i, freq] of [[0, 880], [1, 1175], [2, 880], [3, 1175]]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, t + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.5, t + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.17);
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function startAlarm() {
  stopAlarm();
  beep();
  let count = 0;
  alarmTimer = setInterval(() => { if (++count >= 20) stopAlarm(); else beep(); }, 2000);
}

function stopAlarm() {
  clearInterval(alarmTimer);
  alarmTimer = null;
}

// ---------- New request alert ----------

let currentAlert = null;

function showNextAlert() {
  if (currentAlert) return;
  const ride = alertQueue.shift();
  if (!ride) return;
  if (!rides.some((r) => r.id === ride.id && r.status === 'requested')) return showNextAlert();
  currentAlert = ride;
  const el = $('#alert');
  el.innerHTML = `<div class="alert-body">
      <div class="muted">${ride.scheduled_for ? `Scheduled for ${esc(formatWhen(ride.scheduled_for))}` : 'New ride request'}</div>
      <h1>${esc(ride.rider_name)}</h1>
      ${ride.passengers > 1 ? `<div>${ride.passengers} people</div>` : ''}
      ${routeHtml(ride)}
      ${ride.note ? `<div class="note">"${esc(ride.note)}"</div>` : ''}
    </div>
    <div class="alert-actions stack">
      <button class="btn" data-action="accept">Accept</button>
      <button class="btn light" data-action="decline">Decline</button>
      <button class="link-btn" style="color:#fff;width:100%" data-action="later">Decide later</button>
    </div>`;
  el.classList.remove('hidden');
  onActions(el, {
    accept: (d, btn) => busy(btn, async () => { await setStatus(ride, 'accepted'); closeAlert(); }),
    decline: (d, btn) => busy(btn, async () => { await setStatus(ride, 'declined'); closeAlert(); }),
    later: () => closeAlert(),
  });
  startAlarm();
}

function closeAlert() {
  stopAlarm();
  currentAlert = null;
  $('#alert').classList.add('hidden');
  $('#alert').innerHTML = '';
  showNextAlert();
}

// ---------- Actions ----------

async function setStatus(ride, status) {
  const updated = await api('POST', `/rides/${ride.id}/status`, { status });
  rides = rides.filter((r) => r.id !== ride.id);
  if (!['done', 'declined'].includes(updated.status)) rides.push(updated);
  if (status === 'done') toast('Ride finished.');
  render();
  updateTracking();
  if (status === 'on_the_way' || status === 'in_progress') fitView();
  return updated;
}

function rideActions(ride) {
  return {
    step: (d, btn) => busy(btn, () => setStatus(ride, d.status)),
    accept: (d, btn) => busy(btn, () => setStatus(ride, 'accepted')),
    decline: (d, btn) => {
      if (confirm(`Decline ${ride.rider_name}'s ride?`)) busy(btn, () => setStatus(ride, 'declined'));
    },
    chat: () => {
      unread[ride.id] = 0;
      openChat({ ride, meId: ctx.user.id, otherName: ride.rider_name, otherPhone: ride.rider_phone, role: 'driver', onClose: render });
    },
    cancel: (d, btn) => {
      if (!confirm(`Cancel ${ride.rider_name}'s ride? They'll get a text.`)) return;
      busy(btn, async () => {
        await api('POST', `/rides/${ride.id}/cancel`);
        rides = rides.filter((r) => r.id !== ride.id);
        closePage();
        render();
        updateTracking();
      });
    },
  };
}

// Several rides can be on screen at once, so buttons carry the ride id.
function actionsFor(el, extra = {}) {
  const forRide = (name) => (d, btn, e) => {
    const ride = rides.find((r) => r.id === Number(d.id));
    if (ride) rideActions(ride)[name](d, btn, e);
  };
  onActions(el, {
    step: forRide('step'), accept: forRide('accept'), decline: forRide('decline'),
    chat: forRide('chat'), cancel: forRide('cancel'),
    ...extra,
  });
}

const chatBtn = (ride) => `<button class="btn light" data-action="chat" data-id="${ride.id}">${icons.message}Message${unread[ride.id] ? ` <span class="badge">${unread[ride.id]}</span>` : ''}</button>`;
const callBtn = (ride) => (ride.rider_phone ? `<a class="btn light" href="${esc(telLink(ride.rider_phone))}">${icons.phone}Call</a>` : '');
const details = (ride) => [ride.passengers > 1 ? `${ride.passengers} people` : '', ride.note ? `"${esc(ride.note)}"` : ''].filter(Boolean).join(' · ');

// ---------- Main sheet ----------

function render() {
  if (chatOpenFor()) return;
  const ride = activeRide();
  clearMarkers(['car']);
  if (ride) {
    setMarker('pickup', { lat: ride.pickup_lat, lng: ride.pickup_lng });
    setMarker('dropoff', { lat: ride.dropoff_lat, lng: ride.dropoff_lng });
    if (ride.status !== 'arrived') setRoute(ride.route || null);
  }

  const reqs = requests().filter((r) => !r.scheduled_for || new Date(r.scheduled_for) - Date.now() < 2 * 3600 * 1000);
  const later = scheduled().length;
  const next = upNext();

  const el = sheet(`<div class="stack">
    ${info.online
      ? `<div class="row"><div class="grow"><span class="dot on"></span><b>You're online</b></div><button class="btn small light" data-action="offline">Go offline</button></div>`
      : `<div><h2>You're offline</h2><p class="muted small" style="margin-top:4px">Go online so friends can ask for a ride now. Scheduled requests still come in.</p></div>
         <button class="btn green" data-action="online">Go online</button>
         <label class="field"><span>Note for friends (optional)</span>
           <input id="away-note" maxlength="80" placeholder="Like: Back at 9pm" value="${esc(info.away_note || '')}"></label>`}

    ${ride ? activeHtml(ride) : ''}

    ${reqs.length ? `<div><div class="section-title">Requests</div><ul class="list">${reqs.map((r) => `<li class="stack">
      <div class="row"><h3 class="grow">${esc(r.rider_name)}</h3><span class="small muted">${r.scheduled_for ? esc(formatWhen(r.scheduled_for)) : 'Now'}</span></div>
      ${routeHtml(r)}
      ${details(r) ? `<p class="small muted">${details(r)}</p>` : ''}
      <div class="btn-row"><button class="btn small" data-action="accept" data-id="${r.id}">Accept</button><button class="btn small light" data-action="decline" data-id="${r.id}">Decline</button></div>
    </li>`).join('')}</ul></div>` : ''}

    ${next.length ? `<div><div class="section-title">Up next</div><ul class="list">${next.map((r) => `<li class="stack">
      <div class="row"><h3 class="grow">${esc(r.rider_name)}</h3><span class="small muted">${r.scheduled_for ? esc(formatWhen(r.scheduled_for)) : 'Now'}</span></div>
      ${routeHtml(r)}
      ${details(r) ? `<p class="small muted">${details(r)}</p>` : ''}
      ${ride ? '' : `<button class="btn" data-action="step" data-status="on_the_way" data-id="${r.id}">On the way</button>`}
      <div class="btn-row">${chatBtn(r)}${callBtn(r)}</div>
    </li>`).join('')}</ul></div>` : ''}

    ${later ? `<button class="btn light" data-action="scheduled">${icons.calendar}Scheduled rides (${later})</button>` : ''}
    ${!ride && !reqs.length && !next.length && info.online ? '<p class="muted center small">No requests right now.</p>' : ''}
    ${pushBanner('Get notified about new requests even when the app is closed.')}
  </div>`);

  actionsFor(el, {
    online: (d, btn) => busy(btn, () => setOnline(true)),
    offline: (d, btn) => busy(btn, () => setOnline(false)),
    scheduled: () => scheduledPage(),
    'enable-push': (d, btn) => busy(btn, async () => { await ctx.enablePush(); render(); }),
  });

  const note = $('#away-note', el);
  if (note) {
    note.addEventListener('change', () => busy(null, async () => {
      info = await api('PATCH', '/driver/note', { away_note: note.value });
      toast(info.away_note ? 'Friends will see your note.' : 'Note removed.');
    }));
  }

  if (ride && here) fitView();
  else if (!ride && here) fit([here]);
}

function activeHtml(ride) {
  const [nextStatus, nextLabel] = NEXT_STEP[ride.status];
  const dest = ride.status === 'in_progress'
    ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
    : { lat: ride.pickup_lat, lng: ride.pickup_lng };
  const links = directionsLinks(dest);
  return `<div class="card stack">
    <div class="small muted">${esc(STATUS_LABEL[ride.status])}</div>
    <h2>${esc(ride.rider_name)}</h2>
    ${details(ride) ? `<p class="muted">${details(ride)}</p>` : ''}
    ${routeHtml(ride)}
    <button class="btn ${ride.status === 'in_progress' ? 'green' : ''}" data-action="step" data-status="${nextStatus}" data-id="${ride.id}">${nextLabel}</button>
    <div class="small muted">Directions to ${ride.status === 'in_progress' ? 'drop-off' : 'pickup'}</div>
    <div class="btn-row">
      <a class="btn light" href="${links.google}" target="_blank" rel="noopener">Google Maps</a>
      <a class="btn light" href="${links.apple}" target="_blank" rel="noopener">Apple Maps</a>
    </div>
    <div class="btn-row">${chatBtn(ride)}${callBtn(ride)}</div>
    ${ride.status !== 'in_progress' ? `<button class="link-btn red" data-action="cancel" data-id="${ride.id}">Cancel ride</button>` : ''}
  </div>`;
}

async function setOnline(online) {
  info = await api('POST', '/driver/online', { online });
  if (online && pushStatus() === 'off') toast('Turn on notifications so you hear about requests when the app is closed.', 5000);
  render();
  updateTracking();
}

// ---------- Menu pages ----------

let friendsOpen = false;

export function openPage(name) {
  friendsOpen = false;
  if (name === 'scheduled') return scheduledPage();
  if (name === 'friends') return friendsPage();
  if (name === 'history') return historyPage();
  if (name === 'settings') return settingsPage();
}

function scheduledPage() {
  const list = scheduled().sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
  const busyNow = !!activeRide();
  const el = page(`<div class="page-inner">${pageHead('Scheduled rides')}
    ${list.length ? `<ul class="list">${list.map((r) => `<li class="stack">
      <div class="row"><div class="grow"><h3>${esc(formatWhen(r.scheduled_for))}</h3><div class="muted">${esc(r.rider_name)}</div></div>
        <span class="small ${r.status === 'accepted' ? '' : 'muted'}">${r.status === 'accepted' ? 'Accepted' : 'Needs an answer'}</span></div>
      ${routeHtml(r)}
      ${details(r) ? `<p class="small muted">${details(r)}</p>` : ''}
      ${r.status === 'requested'
        ? `<div class="btn-row"><button class="btn small" data-action="accept" data-id="${r.id}">Accept</button><button class="btn small light" data-action="decline" data-id="${r.id}">Decline</button></div>`
        : `${busyNow ? '' : `<button class="btn small" data-action="step" data-status="on_the_way" data-id="${r.id}">On the way</button>`}
           <div class="btn-row">${chatBtn(r)}${callBtn(r)}</div>
           <button class="link-btn red" data-action="cancel" data-id="${r.id}">Cancel ride</button>`}
    </li>`).join('')}</ul>` : '<p class="muted">No scheduled rides.</p>'}
  </div>`);
  actionsFor(el, {
    step: (d, btn) => busy(btn, async () => {
      await setStatus(rides.find((r) => r.id === Number(d.id)), d.status);
      closePage();
    }),
    accept: (d, btn) => busy(btn, async () => { await setStatus(rides.find((r) => r.id === Number(d.id)), 'accepted'); scheduledPage(); }),
    decline: (d, btn) => {
      const ride = rides.find((r) => r.id === Number(d.id));
      if (ride && confirm(`Decline ${ride.rider_name}'s ride?`)) busy(btn, async () => { await setStatus(ride, 'declined'); scheduledPage(); });
    },
  });
}

async function friendsPage() {
  friendsOpen = true;
  let data;
  try { data = await api('GET', '/friends'); } catch (err) { return toast(err.message); }
  const link = `${location.origin}/join/${data.invite_code}`;
  const group = (status) => data.friends.filter((f) => f.status === status);
  const person = (f, buttons) => `<li class="stack">
    <div class="row"><div class="grow" style="min-width:0"><h3>${esc(f.name)}</h3>
      <div class="small muted ellipsis">${esc(f.phone)}${f.email ? ' · ' + esc(f.email) : ''}</div></div></div>
    <div class="btn-row">${buttons}</div>
  </li>`;
  const waiting = group('pending'), approved = group('approved'), blocked = group('blocked');

  const el = page(`<div class="page-inner">${pageHead('Friends')}
    <div class="card stack">
      <h3>Invite link</h3>
      <p class="small muted">Send this to friends. They sign up with it, then you approve them here.</p>
      <div class="small" style="word-break:break-all">${esc(link)}</div>
      <button class="btn small" data-action="share">${icons.share}Share link</button>
    </div>
    ${waiting.length ? `<div class="section-title">Waiting for you</div><ul class="list">${waiting.map((f) => person(f,
      `<button class="btn small" data-action="approve" data-id="${f.id}">Approve</button><button class="btn small light" data-action="remove" data-id="${f.id}" data-name="${esc(f.name)}">Decline</button>`)).join('')}</ul>` : ''}
    <div class="section-title">Friends</div>
    ${approved.length ? `<ul class="list">${approved.map((f) => person(f,
      `<a class="btn small light" href="${esc(telLink(f.phone))}">${icons.phone}Call</a><button class="btn small light" data-action="remove" data-id="${f.id}" data-name="${esc(f.name)}">Remove</button><button class="btn small light" data-action="block" data-id="${f.id}" data-name="${esc(f.name)}">Block</button>`)).join('')}</ul>`
      : '<p class="muted">No friends yet. Share your invite link to get started.</p>'}
    ${blocked.length ? `<div class="section-title">Blocked</div><ul class="list">${blocked.map((f) => person(f,
      `<button class="btn small light" data-action="unblock" data-id="${f.id}">Unblock</button><button class="btn small light" data-action="remove" data-id="${f.id}" data-name="${esc(f.name)}">Remove</button>`)).join('')}</ul>` : ''}
  </div>`);

  const act = (action, question) => (d, btn) => {
    if (question && !confirm(question.replace('NAME', d.name))) return;
    busy(btn, async () => {
      await api('POST', `/friends/${d.id}`, { action });
      await loadAll();
      render();
      friendsPage();
    });
  };
  onActions(el, {
    'close-page': () => { friendsOpen = false; closePage(); },
    share: async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'Dekaiah Dash', text: 'Sign up here so you can request rides from me:', url: link }); } catch { /* closed */ }
      } else {
        try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch { toast('Copy the link above.'); }
      }
    },
    approve: act('approve'),
    unblock: act('unblock'),
    remove: act('remove', 'Remove NAME? They will need a new invite to come back.'),
    block: act('block', "Block NAME? They won't be able to request rides."),
  });
}

async function historyPage() {
  const el = page(`<div class="page-inner">${pageHead('Ride history')}<div id="history"><p class="muted">Loading…</p></div></div>`);
  try {
    $('#history', el).innerHTML = historyList(await api('GET', '/rides?view=history'), { showRider: true });
  } catch (err) {
    $('#history', el).innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function settingsPage() {
  const u = ctx.user;
  const status = pushStatus();
  const el = page(`<div class="page-inner">${pageHead('Settings')}
    <div class="row" style="margin-bottom:16px">
      ${avatarHtml(u.name, info.photo)}
      <label class="btn small light" style="cursor:pointer">Change photo<input type="file" accept="image/*" id="photo" hidden></label>
    </div>
    <form class="stack" id="settings-form">
      <label class="field"><span>Name</span><input name="name" maxlength="60" value="${esc(u.name)}" required></label>
      <label class="field"><span>Phone number</span><input name="phone" type="tel" maxlength="30" value="${esc(u.phone)}" required></label>
      <div class="section-title">Car</div>
      <label class="field"><span>Model</span><input name="car_model" maxlength="60" value="${esc(info.car_model)}"></label>
      <label class="field"><span>Colour</span><input name="car_colour" maxlength="40" value="${esc(info.car_colour)}"></label>
      <label class="field"><span>Plate</span><input name="car_plate" maxlength="20" value="${esc(info.car_plate)}" style="text-transform:uppercase"></label>
      <button class="btn" type="submit">Save</button>
    </form>
    <div class="section-title">Notifications</div>
    <p class="muted">${status === 'on' ? 'On for this phone.' : status === 'denied' ? 'Blocked. Turn them on in your phone settings.' : status === 'unsupported' ? "This browser doesn't support notifications. You'll still get texts." : ''}</p>
    ${pushBanner('Get notified about new requests even when the app is closed.')}
    <div class="section-title">&nbsp;</div>
    <button class="btn light" data-action="logout">Log out</button>
  </div>`);

  onActions(el, {
    logout: () => ctx.logout(),
    'enable-push': (d, btn) => busy(btn, async () => { await ctx.enablePush(); settingsPage(); }),
  });
  $('#photo', el).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    busy(null, async () => {
      info = await api('POST', '/driver/photo', { photo: await resizePhoto(file) });
      toast('Photo updated.');
      settingsPage();
    });
  });
  $('#settings-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    busy(f.querySelector('[type=submit]'), async () => {
      const [{ user }, car] = await Promise.all([
        api('PATCH', '/me', { name: f.name.value, phone: f.phone.value }),
        api('PATCH', '/driver/car', { car_model: f.car_model.value, car_colour: f.car_colour.value, car_plate: f.car_plate.value }),
      ]);
      ctx.user = user;
      info = car;
      toast('Saved.');
    });
  });
}
