// Everything a passenger sees.
import { api } from './api.js';
import {
  $, esc, icons, sheet, page, closePage, pageHead, onActions, busy, toast, formatWhen, minutes,
  statusBar, routeHtml, avatarHtml, telLink, historyList, STATUS_LABEL,
} from './ui.js';
import { setMarker, clearMarkers, fit, currentLocation } from './map.js';
import { pushBanner, pushStatus } from './push.js';
import { openChat, chatMessage, chatOpenFor } from './chat.js';

const MOVING = ['on_the_way', 'arrived', 'in_progress'];
const PLACE_ICONS = { Home: icons.home, Work: icons.work, School: icons.school };

let ctx;               // { user, driverName, logout, enablePush }
let driverInfo = {};   // name, phone, photo, car, online
let places = { saved: [], recent: [] };
let rides = [];        // this passenger's open rides
let finished = null;   // a ride that just ended, shown until dismissed
let draft = null;      // the ride being set up: { pickup, dropoff, passengers, note, later, at }
let here = null;       // the phone's location
const unread = {};     // ride id -> unread message count

const D = () => driverInfo.first_name || ctx.driverName;

// The ride happening now (not a scheduled one that hasn't started yet).
const activeRide = () => rides.find((r) => !r.scheduled_for || MOVING.includes(r.status));
const upcoming = () => rides.filter((r) => r.scheduled_for && !MOVING.includes(r.status));

// ---------- Start-up and live updates ----------

export async function start(c) {
  ctx = c;
  $('#locate-btn').innerHTML = icons.locate;
  $('#locate-btn').classList.remove('hidden');
  $('#locate-btn').onclick = locateMe;
  await loadAll();
  render();
  locateMe(true);
}

async function loadAll() {
  try {
    [driverInfo, places, rides] = await Promise.all([api('GET', '/driver'), api('GET', '/places'), api('GET', '/rides')]);
  } catch (err) {
    toast(err.message);
  }
}

export async function onReconnect() {
  await loadAll();
  if (!draft) render();
}

export function onLive(msg) {
  if (msg.type === 'ride') {
    const ride = msg.ride;
    const wasActive = activeRide();
    rides = rides.filter((r) => r.id !== ride.id);
    if (['requested', 'accepted', ...MOVING].includes(ride.status)) {
      rides.push(ride);
    } else if (wasActive && wasActive.id === ride.id && !(ride.status === 'cancelled' && ride.cancelled_by === 'rider')) {
      finished = ride;
    } else if (ride.scheduled_for && ride.status !== 'done' && ride.cancelled_by !== 'rider') {
      toast(`${D()} ${ride.status === 'declined' ? "can't make" : 'cancelled'} your ride on ${formatWhen(ride.scheduled_for)}.`, 6000);
    }
    if (!draft) render();
  } else if (msg.type === 'car') {
    const ride = activeRide();
    if (!ride || ride.id !== msg.ride_id) return;
    const first = !ride.car;
    ride.car = { lat: msg.lat, lng: msg.lng };
    ride.eta_seconds = msg.eta_seconds;
    setMarker('car', ride.car);
    const eta = $('#eta');
    if (eta && ride.status === 'on_the_way' && ride.eta_seconds != null) eta.textContent = minutes(ride.eta_seconds);
    if (first) fitRide(ride);
  } else if (msg.type === 'message') {
    const m = msg.message;
    if (m.sender_id === ctx.user.id) { chatMessage(m); return; }
    if (!chatMessage(m)) {
      unread[m.ride_id] = (unread[m.ride_id] || 0) + 1;
      toast(`${D()}: ${m.body}`);
      if (!draft) render();
    }
  }
}

async function locateMe(quiet) {
  try {
    here = await currentLocation();
    if (!activeRide() && !draft) {
      setMarker('pickup', null);
      setMarker('me', here);
      fit([here]);
    }
  } catch (err) {
    if (quiet !== true) toast(err.message);
  }
}

// ---------- Main sheet ----------

function render() {
  if (chatOpenFor()) return;
  const ride = activeRide();
  if (finished) return renderFinished();
  if (ride) return renderRide(ride);
  if (draft) return renderConfirm();
  renderHome();
}

function renderHome() {
  clearMarkers(['me']);
  const saved = places.saved;
  const list = upcoming();
  const el = sheet(`<div class="stack">
    <div class="small"><span class="dot ${driverInfo.online ? 'on' : ''}"></span>${driverInfo.online
      ? `${esc(D())} is online`
      : `${esc(D())} is offline. You can still schedule a ride.`}</div>
    <button class="where-to" data-action="where-to">${icons.search}Where to?</button>
    ${saved.length ? `<div class="chips">${saved.map((p) => `<button class="chip" data-action="quick" data-label="${esc(p.label)}">${PLACE_ICONS[p.label] || icons.pin}${esc(p.label)}</button>`).join('')}</div>` : ''}
    ${list.length ? `<div><div class="section-title">Scheduled</div><ul class="list">${list.map((r) => `<li>
      <button class="item" data-action="open-scheduled" data-id="${r.id}">
        <div class="item-icon">${icons.calendar}</div>
        <div class="grow" style="min-width:0">
          <div>${esc(formatWhen(r.scheduled_for))}</div>
          <div class="small muted ellipsis">To ${esc(r.dropoff_address)}</div>
          <div class="small ${r.status === 'accepted' ? '' : 'muted'}">${r.status === 'accepted' ? `${esc(D())} accepted` : `Waiting for ${esc(D())} to accept`}${unread[r.id] ? ` · <span class="badge">${unread[r.id]}</span>` : ''}</div>
        </div>
      </button></li>`).join('')}</ul></div>` : ''}
    ${pushBanner(`Get a heads-up when ${esc(D())} accepts, is close, and has arrived.`)}
  </div>`);
  onActions(el, {
    'where-to': () => startTrip(),
    quick: (d) => startTrip(saved.find((p) => p.label === d.label)),
    'open-scheduled': (d) => openScheduled(rides.find((r) => r.id === Number(d.id))),
    'enable-push': (d, btn) => busy(btn, async () => { await ctx.enablePush(); render(); }),
  });
}

// ---------- Setting up a ride ----------

async function startTrip(dropoff) {
  if (!dropoff) {
    dropoff = await pickAddress({ title: 'Where to?' });
    if (!dropoff) return;
  }
  draft = { pickup: null, dropoff, passengers: 1, note: '', later: !driverInfo.online, at: '' };
  renderConfirm();
  try {
    here = await currentLocation();
    const spot = await api('GET', `/reverse?lat=${here.lat}&lng=${here.lng}`);
    if (draft && !draft.pickup) { draft.pickup = spot; renderConfirm(); }
  } catch {
    if (draft && !draft.pickup) renderConfirm();
  }
}

function localInputValue(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function renderConfirm() {
  const t = draft;
  setMarker('me', null);
  setMarker('pickup', t.pickup);
  setMarker('dropoff', t.dropoff);
  const minAt = localInputValue(new Date(Date.now() + 15 * 60000));

  const el = sheet(`<div class="stack">
    <div class="row"><button class="icon-btn" data-action="cancel-draft" aria-label="Back">${icons.back}</button><h2 class="grow">Your ride</h2></div>
    <div class="route">
      <div><button class="item" data-action="change-pickup" style="all:unset;cursor:pointer;display:block">
        <div class="small muted">Pickup · <u>Change</u></div>
        <div>${t.pickup ? esc(t.pickup.address) : '<span class="muted">Finding your location…</span>'}</div></button></div>
      <div class="drop"><button class="item" data-action="change-dropoff" style="all:unset;cursor:pointer;display:block">
        <div class="small muted">Drop-off · <u>Change</u></div>
        <div>${esc(t.dropoff.address)}</div></button></div>
    </div>
    <div class="row"><div class="grow"><h3>People</h3><div class="small muted">Including you</div></div>
      <div class="stepper"><button data-action="less" aria-label="Fewer">−</button><output>${t.passengers}</output><button data-action="more" aria-label="More">+</button></div>
    </div>
    <label class="field"><span>Note for ${esc(D())} (optional)</span><input id="note" maxlength="300" value="${esc(t.note)}"></label>
    <div class="segment">
      <button data-action="now" class="${t.later ? '' : 'on'}" ${driverInfo.online ? '' : 'disabled'}>Now</button>
      <button data-action="later" class="${t.later ? 'on' : ''}">Later</button>
    </div>
    ${!driverInfo.online ? `<p class="small muted">${esc(D())} is offline, so you can only schedule a ride for later.</p>` : ''}
    ${t.later ? `<label class="field"><span>Pickup time</span><input id="at" type="datetime-local" min="${minAt}" value="${esc(t.at)}"></label>` : ''}
    <button class="btn" data-action="request" ${t.pickup ? '' : 'disabled'}>${t.later ? 'Schedule ride' : 'Request ride'}</button>
  </div>`);

  fit([t.pickup, t.dropoff]);

  $('#note', el).addEventListener('input', (e) => { t.note = e.target.value; });
  const at = $('#at', el);
  if (at) at.addEventListener('input', (e) => { t.at = e.target.value; });

  onActions(el, {
    'cancel-draft': () => { draft = null; render(); locateMe(true); },
    'change-pickup': async () => {
      const p = await pickAddress({ title: 'Pickup', current: true });
      if (p && draft) { draft.pickup = p; renderConfirm(); }
    },
    'change-dropoff': async () => {
      const p = await pickAddress({ title: 'Where to?' });
      if (p && draft) { draft.dropoff = p; renderConfirm(); }
    },
    less: () => { t.passengers = Math.max(1, t.passengers - 1); renderConfirm(); },
    more: () => {
      if (t.passengers >= 4) return toast('The car fits up to 4 people.');
      t.passengers++; renderConfirm();
    },
    now: () => { t.later = false; renderConfirm(); },
    later: () => { t.later = true; renderConfirm(); },
    request: (d, btn) => busy(btn, async () => {
      if (t.later && !t.at) throw new Error('Pick a pickup time.');
      const ride = await api('POST', '/rides', {
        pickup: t.pickup, dropoff: t.dropoff, passengers: t.passengers, note: t.note,
        scheduled_for: t.later ? new Date(t.at).toISOString() : null,
      });
      draft = null;
      rides = rides.filter((r) => r.id !== ride.id).concat(ride);
      places = await api('GET', '/places');
      if (ride.scheduled_for) toast(`Booked for ${formatWhen(ride.scheduled_for)}. You'll get a notification when ${D()} accepts.`, 5000);
      render();
      if (ride.scheduled_for) locateMe(true);
    }),
  });
}

// Full-screen address search. Resolves to { address, lat, lng } or null if they go back.
function pickAddress({ title, current = false }) {
  return new Promise((resolve) => {
    const done = (value) => { closePage(); resolve(value); };
    const shortcuts = [];
    if (current) shortcuts.push({ icon: icons.locationArrow, title: 'Current location', kind: 'current' });
    for (const p of places.saved) shortcuts.push({ icon: PLACE_ICONS[p.label] || icons.pin, title: p.label, sub: p.address, place: p });
    for (const p of places.recent) shortcuts.push({ icon: icons.clock, title: p.address, place: p });

    let results = shortcuts;
    const el = page(`<div class="page-inner">
      <div class="page-head"><button class="icon-btn" data-action="back" aria-label="Back">${icons.back}</button><h2>${esc(title)}</h2></div>
      <form id="search-form" class="row">
        <input class="grow" name="q" type="search" enterkeyhint="search" placeholder="Search for an address" autocomplete="off" aria-label="Search for an address">
        <button class="btn small" type="submit" aria-label="Search">${icons.search}</button>
      </form>
      <ul class="list" id="results"></ul>
    </div>`);

    const show = () => {
      $('#results', el).innerHTML = results.length ? results.map((r, i) => `<li><button class="item" data-action="pick" data-i="${i}">
        <div class="item-icon">${r.icon || icons.pin}</div>
        <div class="grow" style="min-width:0"><div class="ellipsis">${esc(r.title)}</div>${r.sub ? `<div class="small muted ellipsis">${esc(r.sub)}</div>` : ''}</div>
      </button></li>`).join('') : '<li class="muted">Search for a street address or a place name.</li>';
    };
    show();
    setTimeout(() => el.querySelector('[name=q]').focus(), 50);

    // Nominatim's rules say to search on submit, not on every key press.
    $('#search-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (!q) { results = shortcuts; return show(); }
      e.target.q.blur();
      $('#results', el).innerHTML = '<li class="muted">Searching…</li>';
      try {
        const near = here ? `&lat=${here.lat}&lng=${here.lng}` : '';
        const found = await api('GET', `/search?q=${encodeURIComponent(q)}${near}`);
        results = found.map((p) => ({ icon: icons.pin, title: p.address, sub: p.detail, place: p }));
        show();
        if (!found.length) $('#results', el).innerHTML = "<li class=\"muted\">Couldn't find that. Try adding the city.</li>";
      } catch (err) {
        $('#results', el).innerHTML = `<li class="muted">${esc(err.message)}</li>`;
      }
    });

    onActions(el, {
      back: () => done(null),
      pick: async (d, btn) => {
        const r = results[Number(d.i)];
        if (r.kind !== 'current') return done({ address: r.place.address, lat: r.place.lat, lng: r.place.lng });
        await busy(btn, async () => {
          here = await currentLocation();
          done(await api('GET', `/reverse?lat=${here.lat}&lng=${here.lng}`));
        });
      },
    });
  });
}

// ---------- During a ride ----------

function fitRide(ride) {
  if (ride.status === 'on_the_way' || ride.status === 'arrived') fit([ride.car, { lat: ride.pickup_lat, lng: ride.pickup_lng }]);
  else if (ride.status === 'in_progress') fit([ride.car, { lat: ride.dropoff_lat, lng: ride.dropoff_lng }]);
  else fit([{ lat: ride.pickup_lat, lng: ride.pickup_lng }, { lat: ride.dropoff_lat, lng: ride.dropoff_lng }]);
}

function headline(ride) {
  const d = esc(D());
  switch (ride.status) {
    case 'requested': return { title: `Waiting for ${d} to accept`, sub: '' };
    case 'accepted': return { title: `${d} accepted your ride`, sub: `${d} will head your way soon.` };
    case 'on_the_way': return { title: `${d} is on the way`, sub: '' };
    case 'arrived': return { title: `${d} is here`, sub: 'Head out to the car.' };
    case 'in_progress': return { title: 'Ride started', sub: `Heading to ${esc(ride.dropoff_address)}` };
    default: return { title: STATUS_LABEL[ride.status], sub: '' };
  }
}

function driverCard() {
  const car = [driverInfo.car_colour, driverInfo.car_model].filter(Boolean).join(' ');
  return `<div class="driver-card">
    ${avatarHtml(driverInfo.name, driverInfo.photo)}
    <div class="grow" style="min-width:0">
      <h3>${esc(driverInfo.name)}</h3>
      ${car ? `<div class="muted">${esc(car)}</div>` : ''}
      ${driverInfo.car_plate ? `<div style="margin-top:4px"><span class="plate">${esc(driverInfo.car_plate)}</span></div>` : ''}
    </div>
  </div>`;
}

function contactButtons(ride) {
  return `<div class="btn-row">
    <button class="btn light" data-action="chat">${icons.message}Message${unread[ride.id] ? ` <span class="badge">${unread[ride.id]}</span>` : ''}</button>
    <a class="btn light" href="${esc(telLink(driverInfo.phone))}">${icons.phone}Call</a>
  </div>`;
}

function rideActions(ride) {
  return {
    chat: () => {
      unread[ride.id] = 0;
      openChat({ ride, meId: ctx.user.id, otherName: driverInfo.name, otherPhone: driverInfo.phone, onClose: render });
    },
    cancel: (d, btn) => {
      if (!confirm('Cancel this ride?')) return;
      busy(btn, async () => {
        await api('POST', `/rides/${ride.id}/cancel`);
        rides = rides.filter((r) => r.id !== ride.id);
        closePage();
        toast('Ride cancelled.');
        render();
        locateMe(true);
      });
    },
  };
}

function renderRide(ride) {
  setMarker('me', null);
  setMarker('pickup', { lat: ride.pickup_lat, lng: ride.pickup_lng });
  setMarker('dropoff', { lat: ride.dropoff_lat, lng: ride.dropoff_lng });
  setMarker('car', MOVING.includes(ride.status) ? ride.car : null);

  const h = headline(ride);
  const showEta = ride.status === 'on_the_way';
  const el = sheet(`<div>
    ${ride.status === 'requested' ? '<div class="waiting-bar"></div>' : statusBar(ride.status)}
    <div class="small muted" style="margin-bottom:4px">${esc(STATUS_LABEL[ride.status])}</div>
    <div class="row"><h2 class="grow">${h.title}</h2>${showEta ? `<div class="eta" id="eta">${ride.eta_seconds != null ? minutes(ride.eta_seconds) : ''}</div>` : ''}</div>
    ${h.sub ? `<p class="muted" style="margin-top:4px">${h.sub}</p>` : ''}
    ${driverCard()}
    ${contactButtons(ride)}
    <div style="margin-top:16px">${routeHtml(ride)}</div>
    ${ride.passengers > 1 || ride.note ? `<p class="small muted" style="margin-top:8px">${ride.passengers > 1 ? `${ride.passengers} people` : ''}${ride.passengers > 1 && ride.note ? ' · ' : ''}${ride.note ? esc(ride.note) : ''}</p>` : ''}
    ${ride.status !== 'in_progress' ? '<button class="link-btn red" data-action="cancel">Cancel ride</button>' : ''}
    ${pushBanner(`Get a heads-up when ${esc(D())} is close and has arrived.`)}
  </div>`);
  onActions(el, { ...rideActions(ride), 'enable-push': (d, btn) => busy(btn, async () => { await ctx.enablePush(); render(); }) });
  fitRide(ride);
}

function renderFinished() {
  const ride = finished;
  clearMarkers();
  let title, text;
  if (ride.status === 'done') { title = "You're there"; text = `Thanks for riding with ${esc(D())}.`; }
  else if (ride.status === 'declined') { title = `${esc(D())} can't take this ride`; text = 'Sorry! Send a message or call if you need to sort something out.'; }
  else { title = `${esc(D())} cancelled your ride`; text = 'Send a message or call if you need to sort something out.'; }
  const el = sheet(`<div class="stack">
    <h2>${title}</h2>
    <p class="muted">${text}</p>
    <button class="btn" data-action="ok">OK</button>
  </div>`);
  onActions(el, { ok: () => { finished = null; render(); locateMe(true); } });
}

// A scheduled ride that hasn't started yet.
function openScheduled(ride) {
  if (!ride) return;
  const el = page(`<div class="page-inner stack">
    ${pageHead(formatWhen(ride.scheduled_for))}
    <p>${ride.status === 'accepted' ? `${esc(D())} accepted this ride.` : `Waiting for ${esc(D())} to accept.`}</p>
    ${routeHtml(ride)}
    ${ride.note ? `<p class="muted">${esc(ride.note)}</p>` : ''}
    ${ride.passengers > 1 ? `<p class="muted">${ride.passengers} people</p>` : ''}
    ${contactButtons(ride)}
    <button class="link-btn red" data-action="cancel">Cancel ride</button>
  </div>`);
  onActions(el, rideActions(ride));
}

// ---------- Menu pages ----------

export function openPage(name) {
  if (name === 'history') return historyPage();
  if (name === 'places') return placesPage();
  if (name === 'account') return accountPage();
}

async function historyPage() {
  const el = page(`<div class="page-inner">${pageHead('Ride history')}<div id="history"><p class="muted">Loading…</p></div></div>`);
  try {
    $('#history', el).innerHTML = historyList(await api('GET', '/rides?view=history'));
  } catch (err) {
    $('#history', el).innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

async function placesPage() {
  places = await api('GET', '/places');
  const el = page(`<div class="page-inner">${pageHead('Saved places')}
    <ul class="list">${['Home', 'Work', 'School'].map((label) => {
      const p = places.saved.find((s) => s.label === label);
      return `<li><div class="row">
        <div class="item-icon">${PLACE_ICONS[label]}</div>
        <button class="item grow" data-action="set" data-label="${label}" style="display:block">
          <div>${label}</div><div class="small muted ellipsis">${p ? esc(p.address) : `Add ${label.toLowerCase()}`}</div>
        </button>
        ${p ? `<button class="link-btn" data-action="remove" data-label="${label}">Remove</button>` : ''}
      </div></li>`;
    }).join('')}</ul></div>`);
  onActions(el, {
    set: async (d) => {
      const p = await pickAddress({ title: d.label, current: true });
      if (p) await busy(null, () => api('PUT', `/places/${d.label}`, p));
      placesPage();
    },
    remove: (d, btn) => busy(btn, async () => { await api('DELETE', `/places/${d.label}`); placesPage(); }),
  });
}

function accountPage() {
  const u = ctx.user;
  const status = pushStatus();
  const el = page(`<div class="page-inner">${pageHead('Account')}
    <form class="stack" id="account-form">
      <label class="field"><span>Name</span><input name="name" maxlength="60" value="${esc(u.name)}" required></label>
      <label class="field"><span>Phone number</span><input name="phone" type="tel" maxlength="30" value="${esc(u.phone)}" required></label>
      <div class="small muted">${esc(u.email || '')}</div>
      <button class="btn" type="submit">Save</button>
    </form>
    <div class="section-title">Notifications</div>
    <p class="muted">${status === 'on' ? 'On for this phone.' : status === 'denied' ? 'Blocked. Turn them on in your phone settings.' : status === 'unsupported' ? "This browser doesn't support notifications. You'll still get texts." : ''}</p>
    ${pushBanner('Get a heads-up when your ride is on the way.')}
    <div class="section-title">&nbsp;</div>
    <button class="btn light" data-action="logout">Log out</button>
  </div>`);
  onActions(el, {
    logout: () => ctx.logout(),
    'enable-push': (d, btn) => busy(btn, async () => { await ctx.enablePush(); accountPage(); }),
  });
  $('#account-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    busy(f.querySelector('[type=submit]'), async () => {
      const { user } = await api('PATCH', '/me', { name: f.name.value, phone: f.phone.value });
      ctx.user = user;
      toast('Saved.');
    });
  });
}
