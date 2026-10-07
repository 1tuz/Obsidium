# CSS snippets Obsidian

Obsidium reads CSS snippets only from `.obsidian/snippets/*.css` in the open vault. The dedicated
`list_vault_snippets` command skips non-CSS files and paths that resolve outside the vault. It does
not create or rewrite `.obsidian` files.

The Files settings list discovered snippets. Enabled file names are stored in `ui.enabledSnippets`
inside the normal app settings; switching vaults applies only that vault's matching names. Snippet
contents are loaded on demand and inserted as stylesheet text. There is no polling or hot reload;
reopen Settings after adding a snippet, then toggle it.

Snippets can style only elements and variables that exist in Obsidium. Obsidian-specific selectors
that depend on Obsidian's DOM have no effect, and snippets are not sandboxed from the rest of the UI.
