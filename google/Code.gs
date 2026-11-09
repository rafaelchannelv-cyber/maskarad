/**
 * MaskShow: приём анкет в Google Таблицу + поздравление в Telegram.
 * Таблица → Расширения → Apps Script → вставить этот код → Развернуть → Веб-приложение
 * (Запуск от имени: «Я», Доступ: «Все»).
 * Telegram (необязательно): Настройки проекта → Свойства скрипта → TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
 */
var SHEET = 'Анкеты';
var HEAD = ['№', 'Дата', 'Имя', 'Континент', 'Возраст', 'День рождения', 'Фамилия', 'Мобильный', 'E-mail', 'Согласие'];
var CONSENT_TEXT = 'Я согласен(на) на отправку и обработку моих персональных данных.';
var CONTINENTS = ['Европа', 'Азия', 'Африка', 'Северная Америка', 'Южная Америка', 'Австралия и Океания'];

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out({ error: 'Неверный формат запроса' }); }
  if (d.website) return out({ ok: true }); // ловушка для ботов

  var row = {
    name: clean(d.name, 24), continent: clean(d.continent, 40), birthday: clean(d.birthday, 10),
    lastname: clean(d.lastname, 60), phone: clean(d.phone, 30), email: clean(d.email, 120)
  };
  if (!row.name) return out({ error: 'Впишите имя.' });
  if (CONTINENTS.indexOf(row.continent) < 0) return out({ error: 'Выберите континент.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.birthday)) return out({ error: 'Укажите день рождения.' });
  var age = ageOf(row.birthday);
  if (!(age >= 14 && age <= 110)) return out({ error: 'Участвовать можно с 14 лет.' });
  if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) return out({ error: 'Проверьте e-mail.' });
  if (d.agree !== true) return out({ error: 'Нужно согласие на обработку персональных данных.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var no;
  try {
    var sh = sheet();
    // Номер участника не повторяется, даже если строки удаляли: счётчик хранится в свойствах скрипта.
    var props = PropertiesService.getScriptProperties();
    var target = nextRow(sh);
    no = Math.max(Number(props.getProperty('LAST_NO') || 0), maxNo(sh)) + 1;
    props.setProperty('LAST_NO', String(no));
    var bd = row.birthday.split('-').reverse().join('.');
    // Пишем строго в колонки A–J следующей пустой строки.
    var range = sh.getRange(target, 1, 1, HEAD.length);
    range.setNumberFormats([['0', 'dd.MM.yyyy HH:mm', '@', '@', '0', '@', '@', '@', '@', '@']]);
    range.setValues([[no, new Date(), safe(row.name), row.continent, age, bd, safe(row.lastname), safe(row.phone), safe(row.email), CONSENT_TEXT]]);
  } finally { lock.releaseLock(); }

  announce(row.name, row.continent, age, no);
  return out({ ok: true, public: { name: row.name, continent: row.continent, age: age, number: no } });
}

// Первая пустая строка по колонке A (№), ниже последней заполненной.
function nextRow(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 2;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) if (col[i][0] !== '' && col[i][0] !== null) return i + 3;
  return 2;
}
function maxNo(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  return sh.getRange(2, 1, last - 1, 1).getValues().reduce(function (m, r) { var n = Number(r[0]); return n > m ? n : m; }, 0);
}

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('dd.MM.yyyy HH:mm');
  }
  return sh;
}

// В Telegram уходят только публичные данные: имя, континент, возраст, номер участника.
function announce(name, continent, age, no) {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('TELEGRAM_BOT_TOKEN'), chat = p.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  var text = '🎉 <b>Поздравляем с новой регистрацией!</b>\n\n' +
    '🎭 <b>' + esc(name) + '</b>\n🌍 ' + esc(continent) + '\n🎂 ' + age + ' ' + years(age) +
    '\n\n🎟 Участник №' + no;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chat, text: text, parse_mode: 'HTML' })
    });
  } catch (err) { console.error('Telegram: ' + err); } // анкета уже сохранена
}

/** Запустите вручную из редактора, чтобы проверить таблицу и Telegram. */
function test() {
  var r = doPost({ postData: { contents: JSON.stringify({ name: 'Тест', continent: 'Европа', birthday: '2000-01-01', agree: true }) } });
  console.log(r.getContent());
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function clean(v, max) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max); }
function safe(v) { return /^=/.test(v) ? "'" + v : v; } // чтобы «=…» не стало формулой
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function years(n) { var a = n % 100, b = n % 10; if (a >= 11 && a <= 14) return 'лет'; return b === 1 ? 'год' : (b >= 2 && b <= 4 ? 'года' : 'лет'); }
function ageOf(iso) {
  var b = new Date(iso + 'T00:00:00Z'); if (isNaN(b)) return NaN;
  var t = new Date(), a = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
