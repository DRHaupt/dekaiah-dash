// Phone notifications (Web Push).
import { api } from './api.js';

let vapidKey = null;

export function setVapidKey(key) {
  vapidKey = key;
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'on', 'off' (can be turned on), 'denied', 'install' (iPhone needs Add to Home Screen first) or 'unsupported'.
export function pushStatus() {
  if (!vapidKey) return 'unsupported';
  if (isIos() && !isInstalled()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'on';
  if (Notification.permission === 'denied') return 'denied';
  return 'off';
}

function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// Subscribes this phone and tells the server. Must be called from a tap the first time.
export async function enablePush() {
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') throw new Error('Notifications are blocked. You can turn them on in your phone settings.');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
  await api('POST', '/push', { subscription: sub.toJSON() });
}

// Called on start-up so the server always has this phone's latest subscription.
export async function refreshPush() {
  if (pushStatus() === 'on') {
    try { await enablePush(); } catch { /* try again next time */ }
  }
}

export async function disablePush() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    try { await api('DELETE', '/push', { endpoint: sub.endpoint }); } catch { /* already logged out */ }
    await sub.unsubscribe();
  }
}

// A small banner for the bottom sheet asking to turn notifications on, or '' if not needed.
export function pushBanner(text) {
  const status = pushStatus();
  if (status === 'off') {
    return `<button class="btn light" data-action="enable-push">Turn on notifications</button>
      <p class="small muted center">${text}</p>`;
  }
  if (status === 'install') {
    return `<div class="notice">To get notifications on iPhone, add this app to your Home Screen: tap Share, then <b>Add to Home Screen</b>, and open it from there.</div>`;
  }
  return '';
}
