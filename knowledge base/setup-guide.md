# Установка окружения для Aquilum

## 1. Rust — обязательно

**Да, Rust нужно устанавливать.** Tauri v2 — это Rust-фреймворк. Без Rust проект не скомпилируется.

Rust используется для:
- Оболочки приложения (окно, меню, системные API)
- Команд бэкенда (чтение/запись файлов, watch, поиск Tantivy)
- Компиляции финального `.exe`

### Установка Rust на Windows

1. Скачать **rustup** (официальный установщик): https://rustup.rs
2. Запустить `rustup-init.exe`
3. Выбрать вариант `1` (стандартная установка)
4. После установки перезапустить терминал

Проверка:
```bash
rustc --version    # должно показать версию, например rustc 1.87.0
cargo --version    # пакетный менеджер Rust
```

### Перед Rust: нужен C++ Build Tools

Rust на Windows требует **Microsoft C++ Build Tools**. Два варианта:

**Вариант А** — Visual Studio Build Tools (рекомендуется):
- Скачать: https://visualstudio.microsoft.com/visual-cpp-build-tools/
- При установке выбрать **"Desktop development with C++"**

**Вариант Б** — Полная Visual Studio (если уже стоит):
- Убедиться, что установлен компонент "Desktop development with C++"

---

## 2. Node.js — обязательно

Для React-фронтенда и npm-пакетов.

- Скачать LTS: https://nodejs.org
- Рекомендуемая версия: **22.x LTS** или новее

Проверка:
```bash
node --version   # например v22.x.x
npm --version    # например 10.x.x
```

---

## 3. Tauri CLI — установится автоматически

После установки Rust и Node.js, Tauri CLI ставится через `cargo` или `npm`:

```bash
# Вариант через cargo (рекомендуется)
cargo install tauri-cli --version "^2"

# Или через npm
npm install -D @tauri-apps/cli@latest
```

---

## 4. Дополнительные инструменты (опционально, но полезно)

| Инструмент | Зачем |
|-----------|-------|
| **VS Code** | Редактор кода |
| **rust-analyzer** (расширение VS Code) | Автодополнение и проверка Rust |
| **Git** | Контроль версий |

---

## Порядок установки

```
1. Microsoft C++ Build Tools  →  обязательно, первым
2. Rust (rustup)              →  обязательно, вторым
3. Node.js LTS                →  обязательно
4. Перезапустить терминал
5. cargo install tauri-cli    →  после всего
```

После этого можно будет создать проект командой:
```bash
npm create tauri-app@latest
```
