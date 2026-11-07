# Markdown reading mode

Markdown reading mode keeps the note title and metadata above the body and gives the CodeMirror body the primary vertical scrollport for regular notes. The editor container remains scrollable as a fallback so wheel input over the title, metadata, or container still moves the note; otherwise the outer container can move independently of CodeMirror's virtual viewport, which makes long notes jump or render gaps. Notes with an active cover/book page keep `.q-book-page` as their scrollport so the cover and note content remain in one continuous page.

Keep the body wrapper flexible with `min-height: 0`, and let its CodeMirror scroller fill that space on regular notes. Editing mode keeps the editor container's existing continuous scroll behavior. When changing this layout, verify short notes, long notes, and notes with tables and expanded metadata so neither the body viewport nor content above it gets clipped.

The chain is `.q-editor-content__body` → the CodeMirror host `<div class="q-editor-content__cm">` →
`.cm-editor` → `.cm-scroller`, and every link needs a definite height: `height: 100%` resolves
against a parent only when that parent has one. The host has no size of its own, so without its rule
`height: 100%` on `.cm-editor` computes to `auto`, the scroller grows to the full content height and
never scrolls — the editor container silently becomes the scrollport instead. CodeMirror then sees a
viewport as tall as the document, renders every line, and every consumer of the resolved scrollport
(minimap, scroll restore) reads an element whose `scrollTop` stays 0. Measured check: in reading mode
`.cm-scroller` must have `scrollHeight > clientHeight` while `.q-editor-container` has
`scrollHeight === clientHeight`.

Two more links can silently break that chain. The book wrapper `.q-book-content-wrapper` and
`.q-book-page` are `display: contents` in the regular layout, so the flex parent of
`.q-editor-content` is `.q-book-editor-container`: without `flex: 1 1 auto; min-height: 0` on it
(the rule scoped by `:has(.q-editor-content--reading)`) the container never grows, the body collapses
to zero and the minimap visible region becomes empty — the rail sticks to the top of the document.
The second trap is `padding-bottom: var(--q-editor-scroll-past-end)` on `.cm-scroller`: with
`box-sizing: border-box` the padding counts into the flex item height and becomes an unshrinkable
floor (675px plus the top padding), so the scroller cannot get shorter than its padding even at
`height: 0`. In reading mode that padding moves to `.cm-content`: scroll-past-end stays, the scroller
shrinks to the body height.

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
