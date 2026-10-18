# Markdown reading mode

Markdown reading mode keeps the note title and metadata above the body and gives the CodeMirror body the primary vertical scrollport for regular notes. The editor container remains scrollable as a fallback so wheel input over the title, metadata, or container still moves the note; otherwise the outer container can move independently of CodeMirror's virtual viewport, which makes long notes jump or render gaps. Notes with an active cover/book page keep `.q-book-page` as their scrollport so the cover and note content remain in one continuous page.

Keep the body wrapper flexible with `min-height: 0`, and let its CodeMirror scroller fill that space on regular notes. Editing mode keeps the editor container's existing continuous scroll behavior. When changing this layout, verify short notes, long notes, and notes with tables and expanded metadata so neither the body viewport nor content above it gets clipped.
