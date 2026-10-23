const HELP: &str = r#"Obsidium CLI — тонкий клиент инструментов MCP.

Использование:
  obsidium [--workspace PATH] [--json] [--compact] <команда> [аргументы]

Команды:
  context search "запрос" [--folder F] [--tags a,b] [--limit N] [--max-chars N]
                        [--graph-depth N] [--seeds A,B] [--deep]
  context connections "тема" | --notes A,B [--depth N] [--limit N]
  knowledge review [--folder F] [--tags a,b] [--checks LIST] [--stale-days N]
                   [--offset N] [--limit N]
  search <query...> [--folder F] [--limit N] [--offset N]
  note read <path> [--heading H] [--offset N] [--limit N]
  note create <path> [--content TEXT | --stdin] [--version-name NAME]
  note update <path> [--content TEXT | --stdin] [--mode MODE] [--find TEXT]
                 [--heading H] [--all] [--expected-hash H] [--version-name NAME]
  note rename <path> <title> | --title TITLE
  note move <path> [folder] | --folder F [--to-workspace W]
  note delete <path>
  note outline <path>
  note context <path> [--sections LIST] [--limit N] [--no-content]
  task list [note] [--note N] [--folder F] [--status open|done|all]
                 [--query Q] [--offset N] [--limit N]
  task add <note> <text...> [--text T | --stdin] [--heading H]
  task update <note> <text...> [--text T | --stdin] [--task-id ID] [--line N]
  task toggle <note> [--task-id ID] [--line N] [--done | --undone]
  task delete <note> [--task-id ID] [--line N]
  links suggest <note> [--limit N]
  links add <note> <target> [--kind K] [--preview] [--version-name NAME]
  links remove <note> <target> [--kind K] [--preview] [--version-name NAME]
  graph neighborhood <note> [--depth N] [--direction in|out|both] [--limit N]
  query <dataview text...>
  transaction preview [--file plan.json | --stdin]
  transaction apply [--file plan.json | --stdin] [--version-name NAME]
  transaction rollback [--transaction-id ID | --file plan.json | --stdin]
  workspaces
  history <path> [--offset N] [--limit N]
  backlinks <path>
  mcp stdio [--workspace PATH]
  help

Флаги:
  --workspace PATH   база знаний: путь или address из list_workspaces
  --json             только JSON в stdout, диагностика в stderr
  --compact          убрать frontmatter, content и snippets из ответа
  --stdin            текст или JSON-план из stdin
  --content TEXT     текст заметки или замены
  --mode MODE        append, prepend, replace, findReplace, underHeading, replaceSection;
                     у note update по умолчанию replace — заменяется весь текст заметки
  --offset N         пропустить первые N результатов или версий
  --limit N          размер выдачи
  --file plan.json   JSON-план транзакции: {"edits": [...]} или {"transactionId": "..."}
  --sections LIST    через запятую: frontmatter, outline, content, tasks, backlinks,
                     outgoing, related
  --tags a,b         фильтр по тегам
  --checks LIST      какие проверки выполнять: stale, duplicates, brokenLinks,
                     unlinkedMentions, fieldInconsistency, volatile
  --max-chars N      бюджет ответа search_context в символах
  --graph-depth N    глубина обхода связей в search_context, 0..2
  --deep             режим deep: дополнительное ранжирование через BM25F и Adamic-Adar
  --seeds A,B        исходные заметки для search_context
  --version-name N   название версии в истории заметки
  --kind K           вид связи: wiki, parent, related, depends_on, blocks
  --expected-hash H  hash из read_note: защита от параллельной правки

Переменные окружения:
  OBSIDIUM_WORKSPACE   база знаний по умолчанию
  OBSIDIUM_DATA_DIR    каталог данных Obsidium

Команда и инструмент MCP:
  context search       search_context
  context connections  discover_connections
  knowledge review     review_knowledge
  search               search_notes
  note read            read_note
  note create          create_note
  note update          update_note
  note rename          rename_note
  note move            move_note
  note delete          delete_note
  note outline         note_outline
  note context         get_note_context
  task list            list_tasks
  task add             create_task
  task update          update_task
  task toggle          toggle_task
  task delete          delete_task
  links suggest        suggest_links
  links add            link_notes
  links remove         unlink_notes
  graph neighborhood   get_graph_neighborhood
  query                query_notes
  transaction preview  preview_transaction
  transaction apply    apply_transaction
  transaction rollback rollback_transaction
  workspaces           list_workspaces
  history              note_history
  backlinks            backlinks

Коды выхода:
  | Код | Значение          |
  |-----|-------------------|
  | 0   | успех             |
  | 1   | ошибка ввода      |
  | 2   | ошибка выполнения |
  | 3   | конфликт хэша     |

Коды выхода по ситуациям:
  | Код | Когда                                                        |
  |-----|--------------------------------------------------------------|
  | 0   | инструмент вернул результат                                  |
  | 1   | неизвестная команда, нет аргумента, неверный флаг или JSON   |
  | 2   | инструмент вернул ошибку, нет базы знаний, сбой индекса      |
  | 3   | файл изменился на диске или hash не совпал с expectedHash    |
"#;

pub fn print() {
    println!("{}", HELP);
}
