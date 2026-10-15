// Messages for one ride. Used by both the passenger and the driver.
import { api } from './api.js';
import { $, esc, icons, page, closePage, onActions, toast, formatTime, telLink } from './ui.js';

let open = null; // { rideId, meId }

// One-tap messages so nobody has to type while driving or walking out.
const QUICK_REPLIES = {
  driver: ["I'm here", '2 min away', 'Running a bit late', 'Where are you?'],
  passenger: ['Coming out now', 'Be there in 2 min', "I'm at the pickup spot", 'Where are you?'],
};

export const chatOpenFor = () => (open && !$('#page').classList.contains('hidden') ? open.rideId : null);

function bubble(m, meId) {
  return `<div class="bubble ${m.sender_id === meId ? 'mine' : ''}">${esc(m.body)}<time>${esc(formatTime(m.created_at))}</time></div>`;
}

export async function openChat({ ride, meId, otherName, otherPhone, role, onClose }) {
  open = { rideId: ride.id, meId };
  const el = page(`<div class="chat page-inner" style="height:100%">
      <div class="page-head">
        <button class="icon-btn" data-action="back" aria-label="Back">${icons.back}</button>
        <h2 class="ellipsis">${esc(otherName)}</h2>
        ${otherPhone ? `<a class="icon-btn" href="${esc(telLink(otherPhone))}" aria-label="Call">${icons.phone}</a>` : ''}
      </div>
      <div class="chat-list" id="chat-list"><p class="muted center small">Loading…</p></div>
      <div class="chips" style="flex:none;padding-top:8px">${(QUICK_REPLIES[role] || []).map((q) =>
        `<button class="chip" type="button" data-action="quick" data-text="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="chat-form" id="chat-form">
        <input name="body" autocomplete="off" maxlength="1000" placeholder="Message" aria-label="Message">
        <button class="btn small" type="submit">Send</button>
      </form>
    </div>`, 'chat-page');

  const form = $('#chat-form', el);
  const send = async (body, restore) => {
    try {
      await api('POST', `/rides/${ride.id}/messages`, { body });
    } catch (err) {
      if (restore) form.body.value = body;
      toast(err.message);
    }
  };

  onActions(el, {
    back: () => { open = null; closePage(); if (onClose) onClose(); },
    quick: (d) => send(d.text, false),
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    form.body.value = '';
    send(body, true);
  });

  try {
    const messages = await api('GET', `/rides/${ride.id}/messages`);
    const list = $('#chat-list', el);
    list.innerHTML = messages.length
      ? messages.map((m) => bubble(m, meId)).join('')
      : `<p class="muted center small">Send ${esc(otherName.split(' ')[0])} a message.</p>`;
    list.scrollTop = list.scrollHeight;
  } catch (err) {
    toast(err.message);
  }
}

// Called for every new message. Returns true if it was shown in the open chat.
export function chatMessage(message) {
  if (chatOpenFor() !== message.ride_id) return false;
  const list = $('#chat-list');
  if (!list) return false;
  if (list.querySelector('p')) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', bubble(message, open.meId));
  list.scrollTop = list.scrollHeight;
  return true;
}
