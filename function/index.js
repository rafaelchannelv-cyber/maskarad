// MaskShow: приём анкет и библиотека участников.
// Yandex Cloud Function (Node.js 18+), точка входа index.handler.
// Переменные окружения: YDB_ENDPOINT (строка «Эндпоинт» из консоли YDB), ADMIN_TOKEN (пароль библиотеки),
// ALLOWED_ORIGIN (адрес сайта, например https://maskshow.ru; «*» на время тестов),
// TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (необязательно: куда слать поздравление о новой регистрации).
const { Driver, getCredentialsFromEnv, TypedValues, TypedData } = require("ydb-sdk");
const crypto = require("crypto");

const CONSENT_TEXT = "Я согласен(на) на отправку и обработку моих персональных данных.";
const CONTINENTS = ["Европа", "Азия", "Африка", "Северная Америка", "Южная Америка", "Австралия и Океания"];

let driver;
async function db() {
  if (!driver) {
    driver = new Driver({ connectionString: process.env.YDB_ENDPOINT, authService: getCredentialsFromEnv() });
    if (!(await driver.ready(10000))) { driver = null; throw new Error("YDB недоступна"); }
  }
  return driver;
}

function reply(code, body) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

const clean = (v, max) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);

function sameToken(given) {
  const want = process.env.ADMIN_TOKEN || "";
  const a = Buffer.from(String(given || "")), b = Buffer.from(want);
  return want.length >= 12 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ageOf(iso) {
  const b = new Date(iso + "T00:00:00Z"); if (isNaN(b)) return NaN;
  const t = new Date(); let a = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

async function register(d) {
  if (d.website) return reply(200, { ok: true }); // ловушка для ботов: поле скрыто от людей
  const row = {
    name: clean(d.name, 24),
    continent: clean(d.continent, 40),
    birthday: clean(d.birthday, 10),
    lastname: clean(d.lastname, 60),
    phone: clean(d.phone, 30),
    email: clean(d.email, 120),
  };
  if (!row.name) return reply(400, { error: "Впишите имя." });
  if (!CONTINENTS.includes(row.continent)) return reply(400, { error: "Выберите континент." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.birthday)) return reply(400, { error: "Укажите день рождения." });
  const age = ageOf(row.birthday);
  if (!(age >= 14 && age <= 110)) return reply(400, { error: "Участвовать можно с 14 лет." });
  if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) return reply(400, { error: "Проверьте e-mail." });
  if (d.agree !== true) return reply(400, { error: "Нужно согласие на обработку персональных данных." });

  const id = crypto.randomUUID(), created = new Date().toISOString();
  const params = { $id: id, $created: created, $consent: CONSENT_TEXT, ...Object.fromEntries(Object.entries(row).map(([k, v]) => ["$" + k, v])) };
  const names = Object.keys(params);
  const q = names.map(n => `DECLARE ${n} AS Utf8;`).join("\n") +
    `\nUPSERT INTO anketa (${names.map(n => n.slice(1)).join(", ")}) VALUES (${names.join(", ")});`;
  const typed = Object.fromEntries(names.map(n => [n, TypedValues.utf8(params[n])]));
  let number = null;
  await (await db()).tableClient.withSession(async s => {
    await s.executeQuery(q, typed);
    const res = await s.executeQuery("SELECT COUNT(*) AS cnt FROM anketa;");
    number = Number(TypedData.createNativeObjects(res.resultSets[0])[0].cnt);
  });
  await announce({ name: row.name, continent: row.continent, age, number });
  return reply(200, { ok: true, public: { name: row.name, continent: row.continent, age, number } });
}

// В Telegram уходят только публичные данные: имя, континент, возраст, номер участника.
// Фамилия, телефон и e-mail туда не отправляются.
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
async function announce(p) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
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
  } catch (e) { console.error("Telegram:", e.message); } // анкета уже сохранена, сбой Telegram её не отменяет
}
function years(n) {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return "лет";
  return b === 1 ? "год" : b >= 2 && b <= 4 ? "года" : "лет";
}

async function list() {
  const rows = [];
  await (await db()).tableClient.withSession(async s => {
    const res = await s.executeQuery("SELECT id, created, name, continent, birthday, lastname, phone, email, consent FROM anketa ORDER BY created DESC LIMIT 1000;");
    for (const r of TypedData.createNativeObjects(res.resultSets[0])) rows.push({ ...r });
  });
  return reply(200, { ok: true, rows });
}

async function remove(id) {
  const q = "DECLARE $id AS Utf8;\nDELETE FROM anketa WHERE id = $id;";
  await (await db()).tableClient.withSession(s => s.executeQuery(q, { $id: TypedValues.utf8(clean(id, 64)) }));
  return reply(200, { ok: true });
}

module.exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return reply(204, {});
  if (event.httpMethod !== "POST") return reply(405, { error: "Только POST" });
  let d;
  try { d = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body || "{}"); }
  catch { return reply(400, { error: "Неверный формат запроса" }); }
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
};
