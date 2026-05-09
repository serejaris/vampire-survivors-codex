<!-- hq-readme-ru: 2026-05-09 -->
# vampire-survivors-codex

Коротко: Игровой прототип «vampire survivors codex».

## Что здесь

- Назначение: Игровой прототип «vampire survivors codex».
- Основной стек: HTML.
- Видимость: публичный репозиторий.
- Статус: активный репозиторий; актуальность проверять по issues и последним коммитам.

## Где смотреть работу

- Задачи и текущие решения: GitHub Issues этого репозитория.
- Код и материалы: файлы в корне и профильные папки проекта.
- Связь с HQ: если проект влияет на продукт, контент или воронку, сверяйте канон в `0_hq` и репозитории-владельце.

## Для агентов

- Сначала прочитайте этот README и открытые issues.
- Не переносите сюда канон соседних проектов без ссылки на источник.
- Перед правками проверьте существующие scripts, package.json/pyproject и локальные инструкции.

---

## Исходный README

# Vampire Survivors Codex Clone

Мини-клон Vampire Survivors:
- автосрельба по ближайшему врагу;
- рост сложности по времени;
- улучшения в процессе рана;
- отправка результата после `Game Over`;
- общий глобальный лидерборд.

## Стек

- Backend: `Node.js + Express`
- База: `PostgreSQL` (через `DATABASE_URL`)
- Frontend: `HTML/CSS/Canvas (vanilla JS)`

## Локальный запуск

```bash
npm install
npm run dev
```

Открыть: `http://localhost:3000`

Если `DATABASE_URL` не задан, сервер работает с in-memory рейтингом (для разработки).

## ENV

Скопируй `.env.example` и задай значения:

- `PORT` - порт сервера
- `DATABASE_URL` - строка подключения к Postgres
- `PGSSL=false` - удобно для локального Postgres без SSL

## API

- `GET /api/leaderboard?limit=25` - топ игроков по рейтингу
- `POST /api/scores` - сохранить результат рана

Пример тела:

```json
{
  "nickname": "BladeMaster",
  "score": 13250,
  "survivedSeconds": 278
}
```

## Railway deploy

1. Создай проект на Railway из этого репозитория.
2. Добавь сервис `PostgreSQL`.
3. В переменные backend-сервиса добавь:
   - `DATABASE_URL` (из Postgres сервиса)
   - `NODE_ENV=production`
4. Убедись, что стартовая команда: `npm start`.
5. Задеплой.

При старте сервер сам создаст таблицы `matches` и `player_ratings`.
