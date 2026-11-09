# MaskShow

Сайт бала MaskShow с анкетой участников. Анкеты сохраняются в Google Таблицу, поздравления о новых участниках уходят в Telegram.

| Файл | Что это | Где работает |
|---|---|---|
| `index.html` | Сайт с анкетой и чатом | GitHub Pages |
| `google/Code.gs` | Скрипт приёма анкет: запись в таблицу и пост в Telegram | Google Apps Script |
| `docs/INSTRUKCIYA.md` | Пошаговая настройка | — |
| `.github/workflows/pages.yml` | Публикация сайта | GitHub Actions |

Токены и пароли в репозитории не хранятся. Токен Telegram задаётся только в свойствах скрипта Google.

Подключение анкеты: в `index.html` строка `const ANKETA_URL="";`. Впишите туда URL веб-приложения Apps Script. Пока строка пустая, сайт работает в демо-режиме.
