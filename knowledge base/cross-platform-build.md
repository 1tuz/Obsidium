# Cross-Platform Build

## Автоматическая сборка через GitHub Actions

### Настройка (один раз):
1. Создать токен: https://github.com/settings/tokens/new
   - Права: `repo` (все)
2. Добавить в secrets: https://github.com/Freaction/Aquilum-source/settings/secrets/actions
   - Имя: `RELEASE_TOKEN`

### Релиз:
```bash
cd aquilum-app
npm version 0.1.4
npm run release
```

Сборка ~10 минут параллельно. Draft release появится в `Aquilum` со всеми файлами:
- `aquilum-app_0.1.4_x64-setup.exe`
- `aquilum-app_0.1.4_x86_64-apple-darwin.dmg`
- `aquilum-app_0.1.4_aarch64-apple-darwin.dmg`
- `aquilum-app_0.1.4_amd64.AppImage`

Прогресс: https://github.com/Freaction/Aquilum-source/actions

### Локальная сборка (Windows):
```bash
npm run release:local
```

## macOS
Установка без подписи Apple: правый клик → "Открыть". Для публичного релиза нужен Apple Developer ($99/год).

## Детали
- Workflow: `.github/workflows/release.yml`
- Публикация в `Freaction/Aquilum`
- Параллельная сборка всех платформ
- `tauri.conf.json`: `targets: "all"`

## Дефекты, видимые только в релизе

Если что-то работает в `tauri dev` и не работает в собранном приложении — [[release-vs-dev-csp]].
Там перечислены все различия двух режимов и порядок поиска причины без devtools.
