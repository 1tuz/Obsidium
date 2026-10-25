use super::sanitize::sanitize_for_search;
use super::{indexing_tokenizer, term_count, text_terms, TermPart, TextTerms};
use std::collections::HashMap;
use tantivy::tokenizer::{TextAnalyzer, TokenStream};

const TEXTS: &[(&str, &str)] = &[
    ("", ""),
    ("заметка", ""),
    ("новая книга", "про новую книгу и про книги"),
    ("Ёлка", "мёд и ёжик под ёлкой, ель и елка"),
    ("machines", "about machines and machine and machining"),
    ("Mixed", "Python и Rust, markdown editor и Markdown Editor"),
    ("Цифры", "2024 год, 42 задачи, версия 0.5.20, API v2"),
    ("Один", "a b c ab cd ef"),
    (
        "Заголовок",
        "машина машины машине машиной машин машинный машинист",
    ),
    (
        "Architecture",
        "architecture architectural architectures architecting architect",
    ),
    (
        "Длинное слово",
        "короткое и оченндлинноесловокотороенепоместитсявфильтр \
         оченндлинноесловокотороенепоместитсявфильтроченндлинноесловокотороенепоместитсявфильтроченндлинноесловокотороенепоместитсявфильтр конец",
    ),
    (
        "Frontmatter",
        "---\ntype: book\nauthor: Isaac Asimov\ntags: [sci-fi]\n---\nFoundation trilogy content",
    ),
    (
        "Смешанный алфавит",
        "машинa programming машинa programming машинa",
    ),
    (
        "Пунктуация",
        "слово, слово. слово! (слово) «слово» — слово; слово: слово",
    ),
    ("Повторы", "книга книга книга книга книга книгу"),
    ("Пробелы", "   табуляция\tи\nпереводы\r\nстрок   "),
];

const URL_TEXTS: &[(&str, &str)] = &[
    (
        "Ссылки",
        "see [NeuroNet docs](https://example.ru/path/example) and https://site.com/example/path end",
    ),
    (
        "Сайты",
        "open www.example.org/machines/example and http://machines.example.com/example",
    ),
    (
        "Вики",
        "see [[NeuroNet]] and [[Path/Note|alias]] plus https://notes.example.ru/machines",
    ),
];

fn legacy_frequencies(text: &str) -> HashMap<String, u32> {
    let mut frequencies = HashMap::new();
    indexing_tokenizer()
        .token_stream(text)
        .process(&mut |token| {
            if token.text.chars().count() >= 2 {
                let count = frequencies.entry(token.text.clone()).or_insert(0u32);
                *count = count.saturating_add(1);
            }
        });
    frequencies
}

fn legacy_labels(title: &str, body: &str) -> HashMap<String, String> {
    let mut tokenizer = indexing_tokenizer();
    let mut by_stem: HashMap<String, HashMap<String, u32>> = HashMap::new();
    for text in [title, body] {
        for surface in alphanumeric_words(text) {
            if surface.chars().count() < 2 {
                continue;
            }
            let Some(stem) = legacy_stem(&mut tokenizer, surface) else {
                continue;
            };
            if stem.chars().count() < 2 {
                continue;
            }
            let count = by_stem
                .entry(stem)
                .or_default()
                .entry(surface.to_owned())
                .or_insert(0);
            *count += 1;
        }
    }
    by_stem
        .into_iter()
        .filter_map(|(stem, surfaces)| {
            surfaces
                .into_iter()
                .max_by(|(left, left_count), (right, right_count)| {
                    left_count
                        .cmp(right_count)
                        .then_with(|| right.chars().count().cmp(&left.chars().count()))
                        .then_with(|| right.cmp(left))
                })
                .map(|(surface, _)| (stem, surface))
        })
        .collect()
}

fn legacy_stem(tokenizer: &mut TextAnalyzer, surface: &str) -> Option<String> {
    let mut stem = None;
    tokenizer.token_stream(surface).process(&mut |token| {
        if stem.is_none() && !token.text.is_empty() {
            stem = Some(token.text.clone());
        }
    });
    stem
}

fn alphanumeric_words(text: &str) -> impl Iterator<Item = &str> {
    WordSpans { text, cursor: 0 }
}

struct WordSpans<'a> {
    text: &'a str,
    cursor: usize,
}

impl<'a> Iterator for WordSpans<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        while self.cursor < self.text.len() {
            let ch = self.text[self.cursor..].chars().next()?;
            if ch.is_alphanumeric() {
                break;
            }
            self.cursor += ch.len_utf8();
        }
        if self.cursor >= self.text.len() {
            return None;
        }
        let start = self.cursor;
        while self.cursor < self.text.len() {
            let ch = self.text[self.cursor..].chars().next()?;
            if !ch.is_alphanumeric() {
                break;
            }
            self.cursor += ch.len_utf8();
        }
        Some(&self.text[start..self.cursor])
    }
}

fn weighted(title: &str, body: &str) -> HashMap<String, u32> {
    let mut frequencies = legacy_frequencies(body);
    for (term, frequency) in legacy_frequencies(title) {
        let value = frequencies.entry(term).or_insert(0);
        *value = value.saturating_add(frequency.saturating_mul(3));
    }
    frequencies
}

fn single_pass(title: &str, body: &str) -> TextTerms {
    text_terms(&[
        TermPart {
            text: title,
            frequency_weight: 3,
            label_weight: 1,
        },
        TermPart {
            text: body,
            frequency_weight: 1,
            label_weight: 1,
        },
    ])
}

#[test]
fn single_pass_matches_legacy_frequencies_and_labels() {
    for (title, body) in TEXTS {
        let expected = weighted(title, body);
        let actual = single_pass(title, body);
        assert_eq!(
            actual.frequencies, expected,
            "frequencies diverged for title={title:?} body={body:?}"
        );
        let legacy = legacy_labels(title, body);
        for stem in actual.frequencies.keys() {
            assert_eq!(
                actual.labels.get(stem),
                legacy.get(stem),
                "label for stem {stem:?} diverged for title={title:?} body={body:?}"
            );
        }
    }
}

#[test]
fn single_pass_matches_legacy_frequencies_for_urls() {
    for (title, body) in URL_TEXTS {
        let expected = weighted(title, body);
        let actual = single_pass(title, body);
        assert_eq!(
            actual.frequencies, expected,
            "frequencies diverged for title={title:?} body={body:?}"
        );
        assert_eq!(
            actual.labels.keys().collect::<Vec<_>>().len(),
            expected.len(),
            "label coverage diverged for title={title:?} body={body:?}"
        );
        for label in actual.labels.values() {
            let cleaned = sanitize_for_search(label);
            assert!(
                !label.contains("http") && !label.contains("www") && !label.contains("example"),
                "url crumbs leaked into label {label:?}"
            );
            assert!(!cleaned.is_empty());
        }
    }
}

#[test]
fn term_count_matches_legacy_token_total() {
    for (title, body) in TEXTS.iter().chain(URL_TEXTS) {
        for text in [title, body] {
            let expected: u32 = legacy_frequencies(text).values().sum();
            assert_eq!(
                term_count(text),
                expected as usize,
                "term count diverged for {text:?}"
            );
        }
    }
}
