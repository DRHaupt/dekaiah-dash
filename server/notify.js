// Phone notifications (Web Push) and text messages (Twilio).
const webpush = require('web-push');
const db = require('./db');

const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (pushReady) {
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT || 'mailto:' + (process.env.DRIVER_EMAIL || 'admin@example.com'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const smsReady = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

async function push(userId, title, body, tag) {
  if (!pushReady || !userId) return;
  const subs = await db.query('SELECT id, subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
  const payload = JSON.stringify({ title, body, tag });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub.subscription, payload, { TTL: 600, urgency: 'high' });
    } catch (err) {
      // 404/410 means the phone unsubscribed or the app was removed.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('Push failed:', err.statusCode || err.message);
      }
    }
  }
}

// Turns what people type into +15551234567 form. 10-digit numbers get the default country code.
function toE164(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const country = (process.env.SMS_COUNTRY_CODE || '+1').replace(/[^\d+]/g, '');
  if (digits.length === 10) return country + digits;
  if (digits.length === 11 && digits.startsWith('1') && country === '+1') return '+' + digits;
  return '+' + digits;
}

async function sms(phone, text) {
  if (!smsReady || !phone) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = new URLSearchParams({ To: toE164(phone), From: process.env.TWILIO_FROM, Body: text });
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) console.error('SMS failed:', res.status, await res.text());
  } catch (err) {
    console.error('SMS failed:', err.message);
  }
}

// Sends a push notification, and a text too when withSms is true.
async function tell(user, title, body, { withSms = false, tag } = {}) {
  if (!user) return;
  await Promise.all([
    push(user.id, title, body, tag),
    withSms ? sms(user.phone, ['Dekaiah Dash: ' + title, body].filter(Boolean).join('\n')) : null,
  ]);
}

module.exports = { pushReady, smsReady, push, sms, tell, toE164 };
