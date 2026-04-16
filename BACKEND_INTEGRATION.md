# Интеграция aero4 с 1С-Битрикс: план и спецификация

## 1. Общая архитектура

```
┌─────────────────────────────────────────────────────────┐
│  Браузер (aero4 frontend)                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Fabric.js   │  │ projectMgr   │  │ apiClient.js   │  │
│  │ Canvas      │→ │ .vnet/JSON   │→ │ (новый модуль) │  │
│  └─────────────┘  └──────────────┘  └───────┬────────┘  │
└─────────────────────────────────────────────┼───────────┘
                                              │ REST API (JSON)
┌─────────────────────────────────────────────┼───────────┐
│  1С-Битрикс                                 ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  /api/aero/  — кастомный REST-контроллер          │   │
│  │  (модуль aero.projects или local/modules/aero)    │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │  ORM / D7 Table Classes                           │   │
│  │  aero_projects, aero_project_versions             │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │  MySQL / MariaDB                                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Личный кабинет пользователя (Битрикс)            │   │
│  │  — список проектов, открытие, удаление            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Формат данных: .vnet → JSON

### Текущий формат .vnet
```
AERONET1\x01<base64(JSON)>
```
Внутри base64 — обычный JSON:
```json
{
  "canvas": { ... },          // Fabric.js toJSON() — объекты, позиции, свойства
  "layers": [ ... ],          // Массив слоёв {id, name, visible, locked, color}
  "crossLayerConnections": [],// Связи между слоями
  "sealedNodes": ["x_y", ...] // Запечатанные тупики
}
```

### Для хранения в БД: чистый JSON
Обёртка .vnet (magic + base64) нужна только для файлового формата. В БД хранить **чистый JSON** — тот самый объект `projectData` из `saveDrawing()`. Никакой конвертации не требуется — это уже JSON.

### Кастомные свойства Fabric.js (сохраняются через CUSTOM_PROPS)
```javascript
['id', 'properties', 'pointIndex', 'pointData',
 'lineStartsFromObject', 'startObject', 'airVolumeText', 'isPreview']
```
Поле `properties` содержит все расчётные данные ветви/объекта (длина, площадь, сопротивление, расход и т.д.).

---

## 3. Структура базы данных

### Таблица `aero_projects`
```sql
CREATE TABLE aero_projects (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,           -- b_user.ID (Битрикс)
    name            VARCHAR(255) NOT NULL DEFAULT '', -- Название проекта
    description     TEXT,                             -- Описание
    preview_base64  MEDIUMTEXT,                       -- Превью-скриншот (data:image/png;base64,...)
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_deleted      TINYINT(1) NOT NULL DEFAULT 0,   -- Мягкое удаление

    INDEX ix_user (user_id),
    INDEX ix_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Таблица `aero_project_versions` (история версий)
```sql
CREATE TABLE aero_project_versions (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id      INT UNSIGNED NOT NULL,
    version         INT UNSIGNED NOT NULL DEFAULT 1,
    project_data    LONGTEXT NOT NULL,               -- JSON (тот самый projectData)
    meta            JSON,                             -- {objectCount, lineCount, lastCalcResult: {depression, flow}}
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    size_bytes       INT UNSIGNED DEFAULT 0,          -- Размер JSON для квот

    INDEX ix_project (project_id, version),
    FOREIGN KEY (project_id) REFERENCES aero_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Зачем две таблицы
- `aero_projects` — лёгкая, для списков и поиска
- `aero_project_versions` — тяжёлая (JSON 1–20 МБ), загружается только при открытии
- Версионность позволяет откатываться к предыдущим сохранениям
- `meta` — денормализованные данные для отображения в списке без парсинга JSON

---

## 4. REST API (Битрикс-модуль)

### Эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/aero/projects/` | Список проектов текущего пользователя |
| POST | `/api/aero/projects/` | Создать новый проект |
| GET | `/api/aero/projects/{id}/` | Получить проект (последняя версия JSON) |
| PUT | `/api/aero/projects/{id}/` | Обновить проект (создать новую версию) |
| DELETE | `/api/aero/projects/{id}/` | Мягкое удаление |
| GET | `/api/aero/projects/{id}/versions/` | Список версий |
| GET | `/api/aero/projects/{id}/versions/{ver}/` | Конкретная версия |
| POST | `/api/aero/projects/{id}/preview/` | Загрузить превью-скриншот |

### Аутентификация
Битрикс-сессия (cookie `PHPSESSID` + `sessid` токен). Пользователь уже авторизован в личном кабинете.

### Пример ответов

**GET /api/aero/projects/**
```json
{
  "status": "ok",
  "data": [
    {
      "id": 42,
      "name": "Шахта Северная — главная схема",
      "description": "Основная вентиляционная сеть",
      "objectCount": 156,
      "lastCalcDepression": 245.8,
      "updatedAt": "2026-04-15T14:30:00",
      "previewUrl": "/upload/aero/previews/42.png"
    }
  ]
}
```

**GET /api/aero/projects/42/**
```json
{
  "status": "ok",
  "data": {
    "id": 42,
    "name": "Шахта Северная — главная схема",
    "version": 7,
    "projectData": {
      "canvas": { ... },
      "layers": [ ... ],
      "crossLayerConnections": [],
      "sealedNodes": []
    }
  }
}
```

**PUT /api/aero/projects/42/**
```json
// Request body:
{
  "name": "Шахта Северная — главная схема",
  "projectData": { "canvas": {...}, "layers": [...], ... },
  "meta": { "objectCount": 156, "lineCount": 89 }
}
// Response:
{ "status": "ok", "data": { "id": 42, "version": 8 } }
```

---

## 5. Фронтенд: новый модуль `apiClient.js`

### Что добавить
Новый IIFE-модуль `js-for-index4/apiClient.js`, загружается после `projectManager.js`.

### Функции

```javascript
// Конфигурация
const API_BASE = '/api/aero';

// Получить список проектов
async function apiGetProjects()

// Загрузить проект с сервера
async function apiLoadProject(projectId)

// Сохранить проект на сервер (создать или обновить)
async function apiSaveProject(projectId, name, projectData, meta)

// Удалить проект
async function apiDeleteProject(projectId)

// Загрузить превью
async function apiUploadPreview(projectId, canvas)

// Автосохранение на сервер (debounce 10 сек, реже чем localStorage)
const debouncedServerAutoSave = debounce(serverAutoSave, 10000);
```

### Интеграция с существующим saveDrawing()
```javascript
// В projectManager.js — добавить вызов серверного сохранения:
global.saveDrawing = function() {
    // ... существующая логика (localStorage + файл) ...

    // Серверное сохранение (если авторизован)
    if (typeof apiSaveProject === 'function' && window.currentProjectId) {
        apiSaveProject(window.currentProjectId, projectName, projectData, meta)
            .then(() => showNotification('Сохранено на сервер', 'success'))
            .catch(err => showNotification('Ошибка сервера: ' + err.message, 'warning'));
    }
};
```

### Новые глобальные переменные (main5.js)
```javascript
let currentProjectId = null;      // ID проекта на сервере (null = локальный)
let currentProjectName = '';      // Название
let currentProjectVersion = 0;    // Последняя версия
let isServerMode = false;         // true если открыт из личного кабинета
```

---

## 6. Модуль 1С-Битрикс

### Структура модуля

```
local/modules/aero.projects/
├── install/
│   ├── index.php                    — установщик модуля
│   └── db/
│       └── mysql/
│           ├── install.sql          — CREATE TABLE
│           └── uninstall.sql        — DROP TABLE
├── lib/
│   ├── ProjectTable.php             — ORM-класс для aero_projects
│   ├── ProjectVersionTable.php      — ORM-класс для aero_project_versions
│   └── Controller/
│       └── ProjectController.php    — REST-контроллер (/api/aero/*)
├── include.php
└── .settings.php
```

### ORM-класс (D7)
```php
namespace Aero\Projects;

use Bitrix\Main\ORM\Data\DataManager;
use Bitrix\Main\ORM\Fields;

class ProjectTable extends DataManager
{
    public static function getTableName(): string
    {
        return 'aero_projects';
    }

    public static function getMap(): array
    {
        return [
            new Fields\IntegerField('id', ['primary' => true, 'autocomplete' => true]),
            new Fields\IntegerField('user_id', ['required' => true]),
            new Fields\StringField('name', ['required' => true, 'size' => 255]),
            new Fields\TextField('description'),
            new Fields\TextField('preview_base64'),
            new Fields\DatetimeField('created_at'),
            new Fields\DatetimeField('updated_at'),
            new Fields\BooleanField('is_deleted', ['default_value' => false]),
        ];
    }
}
```

### REST-контроллер
```php
namespace Aero\Projects\Controller;

use Bitrix\Main\Engine\Controller;
use Bitrix\Main\Engine\ActionFilter;

class ProjectController extends Controller
{
    protected function getDefaultPreFilters(): array
    {
        return [
            new ActionFilter\Authentication(),   // только авторизованные
            new ActionFilter\HttpMethod(['GET', 'POST', 'PUT', 'DELETE']),
            new ActionFilter\Csrf(),             // CSRF-защита
        ];
    }

    public function listAction(): array { /* ... */ }
    public function getAction(int $id): array { /* ... */ }
    public function saveAction(int $id = 0): array { /* ... */ }
    public function deleteAction(int $id): array { /* ... */ }
}
```

---

## 7. Личный кабинет: UI для списка проектов

### Страница `/personal/projects/`

Компонент Битрикс или Vue.js-виджет со списком:

```
┌──────────────────────────────────────────────────┐
│  Мои проекты вентиляции           [+ Новый проект] │
├──────────────────────────────────────────────────┤
│  ┌────────┐  Шахта Северная — главная схема      │
│  │ превью │  156 объектов · Депрессия: 245.8 Па  │
│  │  .png  │  Обновлено: 15.04.2026 14:30         │
│  └────────┘  [Открыть]  [Скачать .vnet]  [🗑]    │
├──────────────────────────────────────────────────┤
│  ┌────────┐  Шахта Южная — аварийный режим       │
│  │ превью │  89 объектов · Депрессия: 180.2 Па   │
│  │  .png  │  Обновлено: 10.04.2026 09:15         │
│  └────────┘  [Открыть]  [Скачать .vnet]  [🗑]    │
└──────────────────────────────────────────────────┘
```

### Открытие проекта
Кнопка "Открыть" переходит на `/tools/aero/?project=42`. Приложение aero4:
1. Парсит `?project=42` из URL
2. Вызывает `apiLoadProject(42)`
3. Получает JSON, вызывает `restoreCanvasFromJSON(json)`
4. Устанавливает `currentProjectId = 42`, `isServerMode = true`
5. Все последующие Ctrl+S сохраняют и на сервер тоже

---

## 8. Что менять в существующем коде

### projectManager.js
- Добавить вызов `apiSaveProject()` в `saveDrawing()` (если `isServerMode`)
- Добавить функцию `saveToServer()` как отдельный экспорт
- Модифицировать `loadDrawing()` — показывать выбор: "из файла" / "с сервера"

### main5.js
- Добавить глобальные переменные: `currentProjectId`, `isServerMode`
- В `DOMContentLoaded`: проверить `?project=ID` в URL → загрузить с сервера
- Серверное автосохранение (debounce 10 сек) параллельно с localStorage

### index.html
- Добавить `<script src="js-for-index4/apiClient.js"></script>` после projectManager.js
- Добавить диалог "Сохранить как" (название проекта) при первом серверном сохранении
- Индикатор синхронизации в хедере (облако + статус)

---

## 9. Безопасность

| Угроза | Защита |
|--------|--------|
| Чужие проекты | Фильтр `user_id = текущий` во всех запросах |
| XSS в JSON | JSON хранится как есть, не рендерится как HTML |
| CSRF | Битрикс sessid токен в каждом запросе |
| Размер | Лимит JSON: 20 МБ на версию, 50 версий на проект |
| SQL injection | ORM D7 — параметризованные запросы |
| DoS | Rate limit: 60 запросов/мин на пользователя |

---

## 10. Миграция существующих .vnet файлов

### Импорт из файла на сервер
В личном кабинете кнопка "Импортировать .vnet":
1. Пользователь выбирает файл
2. JS распаковывает .vnet → JSON (функция `unpackFile()` уже есть)
3. Отправляет JSON на `POST /api/aero/projects/`
4. Сервер сохраняет в БД

### Экспорт с сервера в файл
Кнопка "Скачать .vnet" в списке проектов:
1. `GET /api/aero/projects/{id}/`
2. JS получает JSON
3. `packFile(JSON.stringify(projectData))` → Blob → download

Обратная совместимость: приложение продолжает работать полностью офлайн если сервер недоступен. Серверное сохранение — дополнение, а не замена.

---

## 11. Порядок реализации

### Фаза 1: Бэкенд (1С-Битрикс)
1. Создать модуль `aero.projects`
2. Создать таблицы в БД
3. Написать ORM-классы
4. Реализовать REST-контроллер с CRUD
5. Настроить маршрутизацию `/api/aero/*`
6. Тесты API (Postman/curl)

### Фаза 2: Фронтенд-интеграция
1. Создать `apiClient.js`
2. Модифицировать `projectManager.js` — двойное сохранение
3. Модифицировать `main5.js` — загрузка по `?project=ID`
4. Добавить UI индикатор синхронизации
5. Добавить диалог "Сохранить как" (название проекта)

### Фаза 3: Личный кабинет
1. Создать страницу `/personal/projects/`
2. Компонент списка проектов с превью
3. Импорт/экспорт .vnet
4. Версионирование (откат к предыдущей версии)

### Фаза 4: Улучшения
1. Совместная работа (блокировка проекта при редактировании)
2. Шаринг проектов между пользователями (read-only ссылки)
3. Сжатие JSON (gzip перед отправкой)
4. Превью-генерация (canvas.toDataURL при сохранении)
