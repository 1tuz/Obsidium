# Релиз и автообновление

## Статус: обязательно соблюдать

Исходный код и бинарники живут в **разных местах**. `git push` не публикует
установщик. Updater качает файлы только с **публичного** GitHub Release.

**Сейчас релиз Windows — только локально на ПК.** GitHub Actions для сборки
отключён: private-репо упирается в лимит минут. macOS/Linux — позже, когда
появится отдельный способ сборки.

**Node.js нужен только тебе при сборке** (`npm run release:local`). У пользователя
Node.js нет: приложение обновляется через Tauri updater + NSIS `setup.exe`.

## Два репозитория

| Репозиторий | Доступ | Содержимое |
|-------------|--------|------------|
| [Freaction/Aquilum-source](https://github.com/Freaction/Aquilum-source) | **private** | рабочие исходники с полной историей |
| [Freaction/Aquilum](https://github.com/Freaction/Aquilum) | **public** | страница приложения, снимок исходников под AGPL-3.0, установщики + `latest.json` |

Updater смотрит сюда:

```
https://github.com/Freaction/Aquilum/releases/latest/download/latest.json
```

Private-репо для Releases **не подходит** — файлы качаются без авторизации.

## Пайплайн: Windows с ПК

### Один раз

1. Ключ подписи: `%USERPROFILE%\.tauri\aquilum.key`
2. Пароль в env (постоянно):
   ```bat
   setx TAURI_SIGNING_PRIVATE_KEY_PASSWORD "пароль"
   ```
   После `setx` открой **новый** терминал.
3. `gh auth login` — если заливаешь через CLI

### Каждый релиз

Сначала выполнить пункты [[tech-debt]] с пометкой «В следующем релизе» (сейчас таких нет): это правки,
которые нельзя делать в dev раньше выпуска, потому что dev и релиз делят данные приложения.

```bash
cd aquilum-app
# 1) Версия в package.json (например 0.1.8)
# 2) Сборка
npm run release:local
```

`npm run release` делает то же самое (локальная сборка, без push в Actions).

Результат: `.artifacts/releases/<version>/`

- `aquilum-app_<ver>_x64-setup.exe` — установщик (NSIS)
- `latest.json` — манифест updater (`windows-x86_64` → этот setup.exe)
- `UPLOAD.txt` — короткая шпаргалка

### Залить руками в Aquilum

**UI:** https://github.com/Freaction/Aquilum/releases/new  
Tag `v<ver>`, прикрепить `setup.exe` + `latest.json` → Publish.

**CLI** (из папки артефактов):

```bash
cd "../.artifacts/releases/<version>"
gh release create v<version> "aquilum-app_<version>_x64-setup.exe" latest.json --repo Freaction/Aquilum --title "v<version>" --notes ""
```

Если tag/release уже есть — замени assets, особенно `latest.json`.

После Publish старые установленные клиенты подтянут обновление при следующем запуске.

## Исходники и лицензия

Код открыт под **AGPL-3.0-only** (`LICENSE` в корне, поле `license` в `package.json` и
`Cargo.toml`). AGPL выбрана потому, что, в отличие от GPL, обязывает открыть изменённый код и
тех, кто отдаёт приложение пользователям как сетевой сервис: взять Aquilum, доработать и
продавать закрытым SaaS нельзя. `-only`, а не `-or-later`: условия не меняются будущими
версиями лицензии без решения автора. Автор как единственный правообладатель сохраняет право
выдавать отдельную коммерческую лицензию; если начнём принимать чужие pull request, без
соглашения контрибьютора (CLA) это право на их код теряется.

Публичный репозиторий получает **снимок без истории**, а не зеркало private-репо: в истории
лежали личные заметки автора и сторонние файлы, которые в дереве давно удалены. Зеркалирование
истории (`git push` private → public) опубликует их все, поэтому запрещено.

Обновление снимка (обычно вместе с релизом), из корня private-репо после коммита:

```bash
git archive HEAD -- aquilum-app "knowledge base" AGENTS.md LICENSE .gitattributes .gitignore .gitmodules | tar -x -C release-repo-update
git show HEAD:README.md > release-repo-update/DEVELOPMENT.md
cd release-repo-update
git update-index --add --cacheinfo 160000,<sha foliate-js>,aquilum-app/vendor/foliate-js
git add -A && git commit -m "исходники <версия>" && git push
```

`git archive` берёт только закоммиченное и не берёт ignored-файлы. Удалённые в private-репо
файлы снимок сам не удалит — перед распаковкой очистить в `release-repo-update` каталоги
`aquilum-app` и `knowledge base`. Подмодуль `foliate-js` архив не содержит: в публичном репо он
подключается тем же `.gitmodules` и gitlink на коммит из `git submodule status`. `README.md` у
публичного репо свой (страница приложения), поэтому README разработчика едет как `DEVELOPMENT.md`.
`.github/` не публикуется: оба workflow — отключённые заглушки.

## Подпись

- **Публичный ключ** — `tauri.conf.json` → `plugins.updater.pubkey` (в git)
- **Приватный** — `%USERPROFILE%\.tauri\aquilum.key` (только локально)
- **Пароль** — `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Updater проверяет minisign до установки. Без ключа или с чужой подписью
апдейт отклонится. Это не Authenticode/SmartScreen — сертификат Windows на
обновления не влияет.

## Как работает updater у пользователя

Настройки → Система → Обновления. По умолчанию включено «Обновлять автоматически»
(`updates.auto` в `settings.json`): при запуске приложение само проверяет и ставит новую версию.
Если выключить, автоматической проверки нет, а в той же секции появляется кнопка «Проверить
обновления»; когда на GitHub есть версия новее, кнопка становится «Установить». Настройка
действует со следующего запуска: автоматическая проверка идёт ровно один раз, при старте.

1. `latest.json`; офлайн/ошибка сети — при автообновлении тихий пропуск, при ручной проверке —
   сообщение с причиной
2. Версия на GitHub новее → splash «Загружаем обновление» с процентами
3. Качается `setup.exe`, проверка подписи
4. NSIS тихо: `installMode: quiet` → `/S /R`, без окна установщика → перезапуск

Механизм один на оба пути (`src-tauri/src/updater.rs`): `check_for_update` спрашивает версию,
`install_update` заново проверяет и ставит. Повторная проверка перед установкой дешевле, чем
хранить найденное обновление между вызовами, и не даёт поставить то, что успели отозвать.
Установка защищена флагом `INSTALLING`: второй вызов, пока идёт первый (двойной щелчок или щелчок
во время автообновления), ничего не делает.

### Прогресс идёт через `Channel`, автообновление запускает фронт

`install_update` принимает `tauri::ipc::Channel<UpdateProgress>` и шлёт в него `downloading`
(размер куска и общий размер) и `installing`. Фронт (`src/modules/updates`) копит байты в маленьком
сторе, `UpdateSplash` читает его через `useSyncExternalStore`. Splash одинаково показывается и при
автообновлении, и при ручной установке из настроек.

Автообновление при старте запускает фронт (`installUpdateOnStartup` в `App`, один раз после первой
загрузки настроек), а не `setup()` в Rust. Раньше backend сам стартовал установку в `setup()` и
слал глобальные события `aquilum://update-status`; они уходили до того, как WebView загрузился и
подписался, событие «downloading» терялось, и splash не появлялся вовсе: приложение молча
закрывалось на установку. Канал привязан к конкретному вызову, поэтому потерять начало нельзя.
Вернуть запуск в `setup()` — значит вернуть эту гонку.

### Установка тихая, прогресс показывает splash

Установщик работает в `quiet` (`/S /R`): никаких окон и подтверждений, после установки приложение
перезапускается само. Видимую часть берёт на себя `UpdateSplash` — проценты загрузки и «Устанавливаем».
Между закрытием приложения (Windows закрывает его сразу после запуска установщика) и перезапуском
несколько секунд не видно ничего — это осознанная цена фоновой установки. В 0.2.0 был `passive` с
окном NSIS; владелец вернул тихий режим: окно установщика выглядело как просьба что-то подтвердить.
С точки зрения Defender разницы почти нет — ложное `Wacatac!ml` снимает только подпись Authenticode.

Плагин updater есть только в release-сборке (`--features updater`). В dev модуль подставляет
заглушку того же вида, и команды отвечают `unavailable` — настройки показывают «доступно только в
установленной версии», а не ошибку сети.

Зависимость `tauri-plugin-updater` в `Cargo.toml` объявлена `optional = true`, а фича
`updater = ["dep:tauri-plugin-updater"]` её включает: dev-сборка и `cargo test` плагин не
компилируют вовсе. В capability `default.json` разрешения `updater:default` нет: фронтенд не зовёт
JS-API плагина, проверку и установку делают наши команды `check_for_update` / `install_update` из
Rust, а им ACL не нужен. Что сломается, если вернуть `updater:default`: сборка без фичи падает в
`tauri-build` («Permission updater:default not found»), потому что плагина в ней нет. Обе сборки
проверяются `cargo check` и `cargo check --features updater`.

Конфиг: `nsis.installMode: currentUser` (профиль пользователя, без UAC) +
`plugins.updater.windows.installMode: quiet`.

Код: `src-tauri/src/updater.rs`, `src/modules/updates`, `src/components/Settings/sections/SystemSection.tsx`,
`src/components/Common/UpdateSplash.tsx`.

## Предупреждения Windows («троян», SmartScreen)

Установщик не подписан сертификатом Authenticode. Подпись minisign проверяет только updater, Windows
о ней не знает. Отсюда два разных предупреждения:

- **SmartScreen** («Windows защитила ваш компьютер») — у файла нет репутации. Лечится только
  подписью Authenticode: OV-сертификат копит репутацию постепенно, EV или Azure Trusted Signing дают
  её почти сразу.
- **Defender** («Trojan:Win32/…», обычно `Wacatac`/`Sabsik` с суффиксом `!ml`) — ML-эвристика на
  неподписанный exe, который другой процесс скачивает во временную папку и запускает. Локальная
  проверка `MpCmdRun -Scan` установщика 0.1.9 угроз не нашла, значит срабатывает поведение, а не
  сигнатура. Каждую такую сборку можно отправить как ложное срабатывание:
  https://www.microsoft.com/wdsi/filesubmission (Software developer → Incorrectly detected).
  Надёжно убирает проблему только подпись Authenticode.

## Автозапуск

`tauri-plugin-autostart` пишет в `HKCU\...\CurrentVersion\Run` значение с именем продукта
(`Aquilum`) и путём к текущему exe. Имя одинаковое у dev и release, поэтому включение автозапуска в
dev перезаписывало запись путём к `target\debugquilum-app.exe`, и при входе в Windows стартовала
dev-сборка (или ошибка, если её папки уже нет). Поэтому:

- в dev переключатель выключен с подсказкой «доступно только в установленной версии»;
- release при старте, если автозапуск включён, переписывает запись на свой текущий путь
  (`src-tauri/src/autostart.rs`) — это лечит старые записи и переустановку в другую папку.

## Windows: только NSIS, не MSI

Updater обязан получать NSIS (`*-setup.exe`). MSI в quiet зависает на
«Приложение откроется автоматически» (нужен UAC / другой путь установки).

Локальный `release:local` кладёт в `latest.json` сразу правильный URL на setup.exe.
В `bundle.targets` MSI нет (`nsis`, плюс пакеты других ОС на будущее).

| Ключ | Смысл |
|------|--------|
| `windows-x86_64` | то, что качает updater — должен быть setup.exe |
| `windows-x86_64-nsis` / `-msi` | явные слоты; дефолтный слот важнее |

## Тест автообновления

1. Поставить старую release-сборку (не dev)
2. Выпустить новую через `release:local` + Publish в Aquilum
3. Запустить старую без переустановки
4. Splash с процентами → окно NSIS с прогрессом → перезапуск на новой версии
5. В `latest.json` у `windows-x86_64.url` — `*-setup.exe`, не `.msi`

## Частые ошибки

| Симптом | Причина | Решение |
|---------|---------|---------|
| Actions: payments / spending limit | Private + hosted runners, минуты кончились | Релиз только `release:local`, CI отключён |
| `latest.json` → 404 | Release не опубликован | Publish в Aquilum |
| Скачало 100%, зависло на «откроется автоматически» | В манифесте был MSI | Пересобрать `release:local`, залить новый `latest.json` |
| Updater молчит в dev | Норма | Нужна release-сборка |
| «No private key» | Нет ключа/пароля | `aquilum.key` + `setx TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| `failed to decode base64 secret key` | Битый ключ в env | Перечитать файл ключа без лишних пробелов |
