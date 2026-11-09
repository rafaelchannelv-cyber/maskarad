// MaskShow: приём анкет, библиотека участников и поздравления в Telegram.
// Supabase Edge Function. Секреты (Edge Functions → Secrets):
//   ADMIN_TOKEN (пароль библиотеки, от 12 символов), ALLOWED_ORIGIN (https://rafaelchannelv-cyber.github.io),
//   TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (необязательно).
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k) => Deno.env.get(k) || "";
const CONSENT_TEXT = "Я согласен(на) на отправку и обработку моих персональных данных.";
const CONTINENTS = ["Европа", "Азия", "Африка", "Северная Америка", "Южная Америка", "Австралия и Океания"];

let sb;
const db = () => sb ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

function reply(code, body) {
  return new Response(code === 204 ? null : JSON.stringify(body), {
    status: code,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": env("ALLOWED_ORIGIN") || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
    },
  });
}

const clean = (v, max) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);

function sameToken(given) {
  const want = env("ADMIN_TOKEN"), g = String(given || "");
  if (want.length < 12 || g.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ g.charCodeAt(i);
  return diff === 0;
}

function ageOf(iso) {
  const b = new Date(iso + "T00:00:00Z"); if (isNaN(+b)) return NaN;
  const t = new Date(); let a = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

async function register(d) {
  if (d.website) return reply(200, { ok: true }); // ловушка для ботов: поле скрыто от людей
  const row = {
    name: clean(d.name, 24), continent: clean(d.continent, 40), birthday: clean(d.birthday, 10),
    lastname: clean(d.lastname, 60) || null, phone: clean(d.phone, 30) || null, email: clean(d.email, 120) || null,
  };
  if (!row.name) return reply(400, { error: "Впишите имя." });
  if (!CONTINENTS.includes(row.continent)) return reply(400, { error: "Выберите континент." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.birthday)) return reply(400, { error: "Укажите день рождения." });
  const age = ageOf(row.birthday);
  if (!(age >= 14 && age <= 110)) return reply(400, { error: "Участвовать можно с 14 лет." });
  if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) return reply(400, { error: "Проверьте e-mail." });
  if (d.agree !== true) return reply(400, { error: "Нужно согласие на обработку персональных данных." });

  const { data, error } = await db().from("anketa").insert({ ...row, consent: CONSENT_TEXT }).select("no").single();
  if (error) throw error;
  await announce({ name: row.name, continent: row.continent, age, number: data.no });
  return reply(200, { ok: true, public: { name: row.name, continent: row.continent, age, number: data.no } });
}

// В Telegram уходят только публичные данные: имя, континент, возраст, номер участника.
const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function years(n) {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return "лет";
  return b === 1 ? "год" : b >= 2 && b <= 4 ? "года" : "лет";
}
async function announce(p) {
  const token = env("TELEGRAM_BOT_TOKEN"), chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  const text = `🎉 <b>Поздравляем с новой регистрацией!</b>\n\n` +
    `🎭 <b>${escHtml(p.name)}</b>\n🌍 ${escHtml(p.continent)}\n🎂 ${p.age} ${years(p.age)}` +
    (p.number ? `\n\n🎟 Участник №${p.number}` : "");
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) console.error("Telegram:", r.status, await r.text());
  } catch (e) { console.error("Telegram:", e.message); } // анкета уже сохранена
}

async function list() {
  const { data, error } = await db().from("anketa")
    .select("id, no, created, name, continent, birthday, lastname, phone, email, consent")
    .order("no", { ascending: false }).limit(5000);
  if (error) throw error;
  return reply(200, { ok: true, rows: data });
}

async function remove(id) {
  const { error } = await db().from("anketa").delete().eq("id", clean(id, 64));
  if (error) throw error;
  return reply(200, { ok: true });
}

export async function handle(req) {
  if (req.method === "OPTIONS") return reply(204, {});
  if (req.method !== "POST") return reply(405, { error: "Только POST" });
  let d;
  try { d = JSON.parse((await req.text()) || "{}"); } catch { return reply(400, { error: "Неверный формат запроса" }); }
  try {
    if (!d.action || d.action === "register") return await register(d);
    if (!sameToken(d.token)) return reply(403, { error: "Неверный пароль библиотеки" });
    if (d.action === "list") return await list();
    if (d.action === "delete") return await remove(d.id);
    return reply(400, { error: "Неизвестное действие" });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "Сервер временно недоступен, попробуйте позже." });
  }
}

if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(handle);
