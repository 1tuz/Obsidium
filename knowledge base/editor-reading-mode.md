# Markdown reading mode

Markdown reading mode keeps the note title and metadata above the body and gives the CodeMirror body the primary vertical scrollport for regular notes. The editor container remains scrollable as a fallback so wheel input over the title, metadata, or container still moves the note; otherwise the outer container can move independently of CodeMirror's virtual viewport, which makes long notes jump or render gaps. Notes with an active cover/book page keep `.q-book-page` as their scrollport so the cover and note content remain in one continuous page.

Keep the body wrapper flexible with `min-height: 0`, and let its CodeMirror scroller fill that space on regular notes. Editing mode keeps the editor container's existing continuous scroll behavior. When changing this layout, verify short notes, long notes, and notes with tables and expanded metadata so neither the body viewport nor content above it gets clipped.

## Ширина текста

Ширина колонки задаётся `--q-editor-max-width`: это `max-width` колонки текста, значение в `ch`, по
умолчанию 100 символов (было 65 — на широком окне текст занимал меньше половины панели). Для
reading-стилей ширина увеличивается на два боковых отступа (`--q-reading-gutter`), иначе поля съедали
бы разницу.

Настройка «На всю ширину» (`editor.fullWidth`) снимает ограничение полностью: `max-width: none` и
для обычного режима, и для reading-стиля (правило с `data-full-width="true"`). Это отдельный
переключатель, а не значение `ch = 1000`: пользователь, которому нужна колонка на всю панель, не
должен угадывать число символов, при котором ограничение перестаёт срабатывать.

Старое сохранённое значение 65 при загрузке конфигурации поднимается до нового дефолта
(`widenLegacyWidth`). Иначе у всех, кто никогда не трогал настройку, текст остался бы узким, потому
что 65 уже лежит в `settings.json`. Осознанно выставленная другая ширина сохраняется как есть.
