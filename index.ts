// ============================================================
//  Moona Care — reminder sender
//  Runs on a schedule, works out what each family needs to know,
//  and sends one Telegram message per parent.
//  Deploy:  supabase functions deploy send-reminders --no-verify-jwt
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const BOT_TOKEN    = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const CRON_SECRET  = Deno.env.get('CRON_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const HOUR = 3600_000, DAY = 86400_000;
const LIMIT: Record<string, number> = { room: 4*HOUR, fridge: 4*DAY, freezer: 180*DAY, thawed: 24*HOUR };

// Cambodia is UTC+7 — reminders are worked out in local time
const khNow = () => new Date(Date.now() + 7*HOUR);
const khToday = () => khNow().toISOString().slice(0, 10);
const dayGap = (iso: string) => Math.round(
  (new Date(iso + 'T00:00:00Z').getTime() - new Date(khToday() + 'T00:00:00Z').getTime()) / DAY
);
const label = (n: number) => 'MC-' + String(n ?? 0).padStart(4, '0');
const riel  = (n: number) => '៛' + Number(n || 0).toLocaleString('en-US');

const VAX: Record<string, [number, string, string]> = {
  bcg:[0,'BCG','BCG (រោគរបេង)'], hepb0:[0,'Hepatitis B birth dose','រលាកថ្លើម B ដូសកំណើត'],
  penta1:[42,'Pentavalent 1','វ៉ាក់សាំង៥ក្នុង១ លើកទី១'], opv1:[42,'Polio 1','ប៉ូលីយ៉ូ លើកទី១'],
  pcv1:[42,'PCV 1','PCV លើកទី១'], rota1:[42,'Rotavirus 1','រ៉ូតាវីរុស លើកទី១'],
  penta2:[70,'Pentavalent 2','វ៉ាក់សាំង៥ក្នុង១ លើកទី២'], opv2:[70,'Polio 2','ប៉ូលីយ៉ូ លើកទី២'],
  pcv2:[70,'PCV 2','PCV លើកទី២'], rota2:[70,'Rotavirus 2','រ៉ូតាវីរុស លើកទី២'],
  penta3:[98,'Pentavalent 3','វ៉ាក់សាំង៥ក្នុង១ លើកទី៣'], opv3:[98,'Polio 3','ប៉ូលីយ៉ូ លើកទី៣'],
  pcv3:[98,'PCV 3','PCV លើកទី៣'], ipv:[98,'IPV','IPV'],
  mr1:[274,'Measles-Rubella 1','កញ្ជ្រិល-ស្អូច លើកទី១'], je:[274,'Japanese encephalitis','រលាកខួរក្បាលជប៉ុន'],
  mr2:[548,'Measles-Rubella 2','កញ្ជ្រិល-ស្អូច លើកទី២']
};

async function send(chat_id: number, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return r.ok;
}

/** returns true the first time this exact reminder is raised today */
async function once(user_id: string, kind: string, ref: string) {
  const { error } = await db.from('notify_log')
    .insert({ user_id, kind, ref, sent_on: khToday() });
  return !error;            // duplicate key means it already went out
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = req.headers.get('x-cron-key') ?? url.searchParams.get('key');
  if (key !== CRON_SECRET) return new Response('no', { status: 401 });

  const { data: links } = await db.from('telegram_links').select('user_id, chat_id');
  if (!links?.length) return Response.json({ sent: 0, note: 'nobody linked' });

  const { data: prefsRows } = await db.from('notify_prefs').select('*');
  const prefs = new Map((prefsRows ?? []).map(p => [p.user_id, p]));

  let sent = 0;

  for (const link of links) {
    const p = prefs.get(link.user_id) ?? { milk: true, vaccine: true, nssf: true, lang: 'kh' };
    const kh = p.lang !== 'en';

    const { data: mem } = await db.from('family_members')
      .select('family_id').eq('user_id', link.user_id);
    if (!mem?.length) continue;
    const famIds = mem.map(m => m.family_id);

    const { data: babies } = await db.from('babies').select('*').in('family_id', famIds);
    if (!babies?.length) continue;

    const lines: string[] = [];

    for (const baby of babies) {
      // ---------- milk about to expire ----------
      if (p.milk) {
        const { data: bags } = await db.from('milk_batches')
          .select('*').eq('baby_id', baby.id).is('used_at', null);
        for (const b of bags ?? []) {
          const exp = new Date(b.place_at).getTime() + (LIMIT[b.place] ?? DAY);
          const left = exp - Date.now();
          if (left > 0 && left <= 12*HOUR && await once(link.user_id, 'milk', b.id)) {
            const hrs = Math.max(1, Math.round(left / HOUR));
            lines.push(kh
              ? `🍼 ទឹកដោះ <b>${label(b.label_no)}</b> (${b.ml}ml) នឹងផុតកំណត់ក្នុង ${hrs} ម៉ោង`
              : `🍼 Milk <b>${label(b.label_no)}</b> (${b.ml}ml) is good for about ${hrs} more hours`);
          }
        }
      }

      // ---------- vaccinations ----------
      if (p.vaccine && baby.dob) {
        const { data: done } = await db.from('vaccinations').select('code').eq('baby_id', baby.id);
        const had = new Set((done ?? []).map(d => d.code));
        const born = new Date(baby.dob + 'T00:00:00Z').getTime();
        for (const [code, [off, en, khName]] of Object.entries(VAX)) {
          if (had.has(code)) continue;
          const dueIso = new Date(born + off*DAY).toISOString().slice(0, 10);
          const gap = dayGap(dueIso);
          if ((gap === 7 || gap === 1 || gap === 0 || gap === -7)
              && await once(link.user_id, 'vax', `${baby.id}:${code}`)) {
            const when = gap > 0 ? (kh ? `ក្នុងរយៈពេល ${gap} ថ្ងៃ` : `in ${gap} days`)
                       : gap === 0 ? (kh ? 'ថ្ងៃនេះ' : 'today')
                       : (kh ? `យឺត ${-gap} ថ្ងៃ` : `${-gap} days late`);
            lines.push(kh
              ? `💉 ${baby.name}: វ៉ាក់សាំង <b>${khName}</b> — ${when}`
              : `💉 ${baby.name}: <b>${en}</b> vaccination — ${when}`);
          }
        }
      }

      // ---------- NSSF money ----------
      if (p.nssf) {
        const { data: visits } = await db.from('nssf_visits')
          .select('*').eq('baby_id', baby.id).is('done_at', null);
        for (const v of visits ?? []) {
          if (v.skipped) continue;
          const end = v.window_end || v.due_date;
          const toDue = dayGap(v.due_date), toEnd = dayGap(end);
          if (toEnd < 0) continue;                       // already lost, no point nagging

          let msg = '';
          if (toDue === 2)      msg = kh ? `ក្នុងរយៈពេល ២ ថ្ងៃ` : `in 2 days`;
          else if (toDue === 0) msg = kh ? `ថ្ងៃនេះ` : `today`;
          else if (toEnd === 1) msg = kh ? `⚠️ ថ្ងៃស្អែកជាថ្ងៃចុងក្រោយ` : `⚠️ tomorrow is the last day`;
          if (!msg) continue;

          if (await once(link.user_id, 'nssf', `${v.id}:${toDue}:${toEnd}`)) {
            lines.push(kh
              ? `៛ ការណាត់ ប.ស.ស ${msg} — <b>${riel(v.amount)}</b>\n   យកប័ណ្ណ ប.ស.ស និងអត្តសញ្ញាណប័ណ្ណទៅជាមួយ`
              : `៛ NSSF check-up ${msg} — <b>${riel(v.amount)}</b>\n   Bring your NSSF card and ID`);
          }
        }
      }
    }

    if (lines.length) {
      const head = kh ? '🌙 <b>Moona Care</b>\n\n' : '🌙 <b>Moona Care</b>\n\n';
      if (await send(link.chat_id, head + lines.join('\n\n'))) sent++;
    }
  }

  return Response.json({ sent, checked: links.length });
});