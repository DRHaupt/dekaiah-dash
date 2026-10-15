// Small helpers shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);

// Escape text before putting it into HTML.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const icons = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  locate: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>'),
  message: svg('<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>'),
  home: svg('<path d="M3 11l9-7 9 7M5 10v10h14V10"/>'),
  work: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>'),
  school: svg('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  locationArrow: svg('<path d="M3 11l18-8-8 18-2-8z"/>'),
  history: svg('<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3"/><path d="M3 3v4h4M12 7v5l3 2"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0114 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a7 7 0 014 6"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>'),
  bell: svg('<path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>'),
  directions: svg('<path d="M12 2l10 10-10 10L2 12z"/><path d="M9 13v-2a1 1 0 011-1h5M13 8l2 2-2 2"/>'),
  share: svg('<path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v13"/>'),
  car: '<svg viewBox="0 0 24 24"><path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11h.5a1.5 1.5 0 011.5 1.5V17a1 1 0 01-1 1h-1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3.9A1 1 0 013 17v-4.5A1.5 1.5 0 014.5 11zm2.1 0h9.8l-1-3.2a.5.5 0 00-.5-.3H8.6a.5.5 0 00-.5.3zM6.5 15a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zm11 0a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z"/></svg>',
};

let toastTimer;
export function toast(message, ms = 3500) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// Bottom sheet over the map.
export function sheet(html) {
  const el = $('#sheet');
  el.innerHTML = html;
  el.classList.remove('hidden');
  requestAnimationFrame(() => document.documentElement.style.setProperty('--sheet-h', el.offsetHeight + 'px'));
  return el;
}

// Full-screen page on top of everything.
export function page(html, extraClass = '') {
  const el = $('#page');
  el.className = 'page ' + extraClass;
  el.innerHTML = html;
  el.scrollTop = 0;
  return el;
}

export function closePage() {
  const el = $('#page');
  el.className = 'page hidden';
  el.innerHTML = '';
}

export const pageOpen = () => !$('#page').classList.contains('hidden');

export function pageHead(title, { back = true } = {}) {
  return `<div class="page-head">${back ? `<button class="icon-btn" data-action="close-page" aria-label="Back">${icons.back}</button>` : ''}<h2>${esc(title)}</h2></div>`;
}

// Hooks up data-action="name" buttons inside a container to handler functions.
// Calling it again on the same container replaces the handlers. The back button on pages always works.
export function onActions(el, handlers) {
  el._actions = handlers;
  if (el._actionsBound) return;
  el._actionsBound = true;
  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || !el.contains(target)) return;
    const name = target.dataset.action;
    const fn = el._actions[name] || (name === 'close-page' ? closePage : null);
    if (fn) { e.preventDefault(); fn(target.dataset, target, e); }
  });
}

// Runs an async action, showing any error as a toast and disabling the button meanwhile.
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message || 'Something went wrong. Try again.');
  } finally {
    if (button) button.disabled = false;
  }
}

export function formatWhen(date) {
  const d = new Date(date);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + `, ${time}`;
}

export function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function minutes(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min`;
}

export const STEPS = ['requested', 'accepted', 'on_the_way', 'arrived', 'in_progress', 'done'];
export const STATUS_LABEL = {
  requested: 'Requested',
  accepted: 'Accepted',
  on_the_way: 'On the way',
  arrived: 'Arrived',
  in_progress: 'Ride started',
  done: 'Done',
  cancelled: 'Cancelled',
  declined: 'Declined',
};

export function statusBar(status) {
  const at = STEPS.indexOf(status);
  return `<div class="status-bar" aria-label="${esc(STATUS_LABEL[status])}">${STEPS.map((_, i) => `<span class="${i <= at ? 'on' : ''}"></span>`).join('')}</div>`;
}

export function routeHtml(ride) {
  return `<div class="route">
    <div><div class="small muted">Pickup</div><div>${esc(ride.pickup_address)}</div></div>
    <div class="drop"><div class="small muted">Drop-off</div><div>${esc(ride.dropoff_address)}</div></div>
  </div>`;
}

export function avatarHtml(name, photo) {
  if (photo) return `<div class="avatar" style="background-image:url('${esc(photo)}')"></div>`;
  return `<div class="avatar">${esc((name || '?').trim().charAt(0).toUpperCase())}</div>`;
}

export function telLink(phone) {
  return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
}

export function historyList(rides, { showRider = false } = {}) {
  if (!rides.length) return '<p class="muted">No rides yet.</p>';
  return `<ul class="list">${rides.map((r) => `<li>
    <div class="row"><div class="grow">
      <div class="small muted">${esc(formatWhen(r.scheduled_for || r.created_at))}${showRider ? ' · ' + esc(r.rider_name) : ''}</div>
      <div class="ellipsis">${esc(r.dropoff_address)}</div>
      <div class="small muted ellipsis">From ${esc(r.pickup_address)}</div>
    </div><div class="small ${r.status === 'done' ? '' : 'muted'}">${esc(r.status === 'cancelled' ? (r.cancelled_by === 'driver' ? 'Cancelled by driver' : 'Cancelled') : STATUS_LABEL[r.status])}</div></div>
  </li>`).join('')}</ul>`;
}

// Makes a JPEG data URL no bigger than `size` pixels on its longest side.
export function resizePhoto(file, size = 400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('That photo didn’t work. Try another one.'));
    img.src = URL.createObjectURL(file);
  });
}
