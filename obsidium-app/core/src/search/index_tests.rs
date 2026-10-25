use super::index::SearchIndex;
use super::matching::{find_prefix_matches, make_excerpt, query_terms};
use tantivy::doc;

#[test]
fn normalizes_case_and_deduplicates_query_terms() {
    assert_eq!(
        query_terms("Obsidium ОБСИД obsidium"),
        vec!["obsidium".to_string(), "обсид".to_string()]
    );
}

#[test]
fn normalizes_diacritics_for_matching_and_highlighting() {
    assert_eq!(query_terms("BRÛLÉE"), vec!["brulee".to_string()]);
    let matches = find_prefix_matches("Crème brûlée", &["brulee".to_string()]);
    assert_eq!(&"Crème brûlée"[matches[0].0..matches[0].1], "brûlée");
}

#[test]
fn matches_only_word_prefixes_case_insensitively() {
    let matches = find_prefix_matches("Документ и псевдодокумент", &["док".to_string()]);
    assert_eq!(matches.len(), 1);
    assert_eq!(
        &"Документ и псевдодокумент"[matches[0].0..matches[0].1],
        "Док"
    );
}

#[test]
fn excerpt_is_stable_and_keeps_the_first_match_visible() {
    let body = format!("{}needle {}", "word ".repeat(100), "tail ".repeat(100));
    let offset = body.find("needle").unwrap();
    let excerpt = make_excerpt(&body, Some(offset));
    assert!(excerpt.contains("needle"));
    assert!(excerpt.starts_with("..."));
    assert!(excerpt.ends_with("..."));
}

fn indexed(documents: &[(&str, &str, &str)]) -> (tempfile::TempDir, SearchIndex) {
    let tagged = documents
        .iter()
        .map(|(path, title, body)| (*path, *title, *body, ""))
        .collect::<Vec<_>>();
    indexed_tagged(&tagged)
}

fn indexed_tagged(documents: &[(&str, &str, &str, &str)]) -> (tempfile::TempDir, SearchIndex) {
    let directory = tempfile::tempdir().unwrap();
    for (path, _title, body, _tags) in documents {
        let target = directory.path().join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(target, body).unwrap();
    }
    let index = SearchIndex::open(&directory.path().join("index")).unwrap();
    let mut writer = index.index.writer(15_000_000).unwrap();
    for (path, title, body, tags) in documents {
        writer
            .add_document(doc!(
                index.fields.id => absolute(directory.path(), path),
                index.fields.path => *path,
                index.fields.title => *title,
                index.fields.tags => *tags,
                index.fields.body => *body,
                index.fields.headings => super::index_document::headings_text(*body),
            ))
            .unwrap();
    }
    writer.commit().unwrap();
    index.reload().unwrap();
    (directory, index)
}

fn absolute(root: &std::path::Path, path: &str) -> String {
    root.join(path).to_string_lossy().into_owned()
}

#[test]
fn a_tag_match_lifts_a_note_above_a_body_only_match() {
    let (_directory, index) = indexed_tagged(&[
        ("notes/Alpha.md", "Alpha", "проект и план", "проект"),
        ("notes/Beta.md", "Beta", "проект и план", ""),
    ]);

    let results = index.search_defaults("проект", 10).unwrap().1;

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].title, "Alpha");
    assert_eq!(results[0].matched_tags, ["проект"]);
    assert!(results[1].matched_tags.is_empty());
}

#[test]
fn a_tag_filter_keeps_only_notes_carrying_the_tag() {
    let (_directory, index) = indexed_tagged(&[
        ("notes/Alpha.md", "Alpha", "план", "проект"),
        ("notes/Beta.md", "Beta", "план", "книги"),
    ]);

    let results = index.search_defaults("tag:проект план", 10).unwrap().1;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Alpha");
}

#[test]
fn a_folder_filter_narrows_the_path_and_an_extension_filter_uses_its_tokens() {
    let (_directory, index) = indexed(&[
        ("Проекты/план.md", "План", "сроки"),
        ("Архив/план.md", "План", "сроки"),
        ("Проекты/Доска.canvas", "Доска", "сроки"),
    ]);

    let in_folder = index.search_defaults("folder:проекты сроки", 10).unwrap().1;
    assert_eq!(in_folder.len(), 2);

    let markdown = index.search_defaults("ext:md сроки", 10).unwrap().1;
    assert_eq!(markdown.len(), 2);

    let both = index
        .search_defaults("folder:проекты ext:canvas сроки", 10)
        .unwrap()
        .1;
    assert_eq!(both.len(), 1);
    assert_eq!(both[0].title, "Доска");
}

#[test]
fn disk_index_searches_title_and_body_by_case_insensitive_prefix() {
    let (_guard, index) = indexed(&[(
        "C:/vault/Квантовая заметка.md",
        "Квантовая заметка",
        "Внутри есть быстрый поиск и ещё один поиск.",
    )]);

    assert_eq!(index.search_defaults("КВАН", 10).unwrap().1.len(), 1);
    let body_results = index.search_defaults("ПОИ", 10).unwrap().1;
    assert_eq!(body_results[0].match_count, 2);
    assert!(body_results[0].snippet.contains("поиск"));
}

#[test]
fn a_multi_word_query_ranks_partial_matches_instead_of_returning_nothing() {
    let (_guard, index) = indexed(&[
        (
            "C:/vault/Камера.md",
            "Камера",
            "# Ощущение камеры\n\nФизика тика влияет на кадр.\n",
        ),
        (
            "C:/vault/Свет.md",
            "Свет",
            "# Освещение\n\nОдин источник на всю сцену.\n",
        ),
        (
            "C:/vault/Быстрота.md",
            "Быстрота",
            "# Плавность\n\nКадр рисуется быстро.\n",
        ),
    ]);

    let (_terms, results) = index
        .search_defaults("физика тика кадр плавность", 10)
        .unwrap();
    assert_eq!(
        results.len(),
        2,
        "ни одна заметка не содержит все слова, но частичные совпадения возвращаются"
    );
    assert!(
        results[0].path.ends_with("C:/vault/Камера.md"),
        "заметка с большим числом совпавших слов идёт первой"
    );
    assert_eq!(results[0].matched_terms.len(), 3);
    assert_eq!(results[1].matched_terms.len(), 2);
    assert_eq!(
        results[0].heading.as_deref(),
        Some("Ощущение камеры"),
        "фрагмент подписан разделом, в котором нашлось совпадение"
    );
}

#[test]
fn a_yo_word_is_found_by_a_ye_query_and_back() {
    let (_directory, index) = indexed(&[(
        "notes/Ёлка.md",
        "Ёлка",
        "# Ёлка\n\nЗелёная ёлка стоит в углу.\n",
    )]);

    assert_eq!(
        index.search_defaults("елка", 10).unwrap().1.len(),
        1,
        "запрос с `е` находит заметку с `ё`"
    );
    assert_eq!(
        index.search_defaults("ёлка", 10).unwrap().1.len(),
        1,
        "запрос с `ё` находит заметку с `ё`"
    );

    let (_directory, index) = indexed(&[(
        "notes/Елка.md",
        "Елка",
        "# Елка\n\nПушистая елка стоит дома.\n",
    )]);

    assert_eq!(
        index.search_defaults("ёлка", 10).unwrap().1.len(),
        1,
        "запрос с `ё` находит заметку с `е`"
    );
    assert_eq!(index.search_defaults("елка", 10).unwrap().1.len(), 1);
}

#[test]
fn a_section_filter_narrows_results_to_notes_with_that_heading() {
    let (_directory, index) = indexed(&[
        (
            "notes/Риски.md",
            "Риски",
            "# Риски\n\nПлан работ на квартал.\n",
        ),
        ("notes/План.md", "План", "# План\n\nБез рисков.\n"),
    ]);

    let (_terms, results) = index.search_defaults("section:Риски план", 10).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Риски");
}

#[test]
fn a_section_filter_alone_is_case_insensitive() {
    let (_directory, index) = indexed(&[
        ("notes/Риски.md", "Риски", "# Риски\n\nТекст.\n"),
        ("notes/Итоги.md", "Итоги", "# Итоги\n\nТекст.\n"),
    ]);

    let results = index.search_defaults("section:риски", 10).unwrap().1;
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Риски");
}

#[test]
fn two_section_filters_intersect() {
    let (_directory, index) = indexed(&[
        ("notes/Риски.md", "Риски", "# Риски\n\nТекст.\n"),
        ("notes/План.md", "План", "# Риски\n\n## План\n\nТекст.\n"),
        ("notes/Итоги.md", "Итоги", "# План\n\nТекст.\n"),
    ]);

    let results = index
        .search_defaults("section:Риски section:План", 10)
        .unwrap()
        .1;
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "План");
}

#[test]
fn an_empty_section_filter_narrows_nothing() {
    let (_directory, index) = indexed(&[
        ("notes/Риски.md", "Риски", "# Риски\n\nплан\n"),
        ("notes/Прочее.md", "Прочее", "# Прочее\n\nплан\n"),
    ]);

    let results = index.search_defaults("section: план", 10).unwrap().1;
    assert_eq!(results.len(), 2);
    assert!(index.search_defaults("section:", 10).unwrap().1.is_empty());
}
