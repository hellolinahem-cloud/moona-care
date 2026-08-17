// ============================================================
//  Moona Care — Telegram webhook
//  Receives messages from the bot and links a parent's chat.
//  Deploy:  supabase functions deploy telegram-webhook --no-verify-jwt
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const HOOK_SECRET   = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')!;
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function say(chat_id: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
}

const T = {
  linked: '✅ <b>Moona Care</b>\n\nតភ្ជាប់បានជោគជ័យ។ អ្នកនឹងទទួលការរំលឹកអំពីទឹកដោះ វ៉ាក់សាំង និង ប.ស.ស នៅទីនេះ។\n\nConnected. You will get reminders about stored milk, vaccinations and NSSF visits here.\n\n/stop ដើម្បីឈប់ · to stop',
  bad:    '⚠️ លេខកូដនេះមិនត្រឹមត្រូវ ឬផុតកំណត់ហើយ។\n\nThat code is not valid or has expired. Open Moona Care and tap Connect Telegram again.',
  plain:  '👋 <b>Moona Care</b>\n\nសូមបើកកម្មវិធី Moona Care រួចចុច «តភ្ជាប់ Telegram»។\n\nOpen the Moona Care app and tap Connect Telegram to link this chat.',
  stopped:'🔕 ឈប់ផ្ញើការរំលឹកហើយ។\n\nReminders stopped. Link again any time from the app.',
  none:   'មិនទាន់តភ្ជាប់ទេ · Not linked yet.',
  ok:     '✅ តភ្ជាប់រួចរាល់ · Linked and active.'
};

Deno.serve(async (req) => {
  // Telegram signs every call with the secret we registered
  if (req.headers.get('x-telegram-bot-api-secret-token') !== HOOK_SECRET) {
    return new Response('no', { status: 401 });
  }

  let update: any;
  try { update = await req.json(); } catch { return new Response('ok'); }

  const msg = update.message ?? update.edited_message;
  const chat_id = msg?.chat?.id;
  const text: string = (msg?.text ?? '').trim();
  if (!chat_id) return new Response('ok');

  // ---- /start <token> ----
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) { await say(chat_id, T.plain); return new Response('ok'); }

    const { data: row } = await db.from('telegram_tokens')
      .select('token,user_id,expires_at,used_at').eq('token', token).maybeSingle();

    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      await say(chat_id, T.bad); return new Response('ok');
    }

    await db.from('telegram_links').upsert({
      user_id: row.user_id, chat_id, username: msg.chat.username ?? null, linked_at: new Date().toISOString()
    });
    await db.from('telegram_tokens').update({ used_at: new Date().toISOString() }).eq('token', token);
    await db.from('notify_prefs').upsert({ user_id: row.user_id }, { onConflict: 'user_id', ignoreDuplicates: true });

    await say(chat_id, T.linked);
    return new Response('ok');
  }

  // ---- /stop ----
  if (text.startsWith('/stop')) {
    await db.from('telegram_links').delete().eq('chat_id', chat_id);
    await say(chat_id, T.stopped);
    return new Response('ok');
  }

  // ---- /status ----
  if (text.startsWith('/status')) {
    const { data } = await db.from('telegram_links').select('user_id').eq('chat_id', chat_id).maybeSingle();
    await say(chat_id, data ? T.ok : T.none);
    return new Response('ok');
  }

  await say(chat_id, T.plain);
  return new Response('ok');
});