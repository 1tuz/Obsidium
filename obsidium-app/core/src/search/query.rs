use super::error::SearchError;
use super::index::SearchIndex;
use super::matching::{analyzed_query_terms, result_from_document};
use super::models::SearchResult;
use crate::settings::models::SearchIndexSettings;
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, TermQuery};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::{TantivyDocument, Term};

pub const MAX_RESULTS: usize = 100;
pub const MAX_WINDOW: usize = 1_000;
const MIN_PREFIX_CHARS: usize = 2;
const MIN_FUZZY_CHARS: usize = 5;
const MAX_SYNONYM_GROUP: usize = 8;

const TITLE_BOOST: f32 = 5.0;
const TAG_BOOST: f32 = 3.0;
const PATH_BOOST: f32 = 2.0;
const BODY_BOOST: f32 = 1.0;

pub struct Filters {
    pub tags: Vec<String>,
    pub titles: Vec<String>,
    pub folders: Vec<String>,
    pub extensions: Vec<String>,
}

impl Default for Filters {
    fn default() -> Self {
        Self {
            tags: Vec::new(),
            titles: Vec::new(),
            folders: Vec::new(),
            extensions: Vec::new(),
        }
    }
}

pub struct ParsedQuery {
    pub text: String,
    pub filters: Filters,
}

pub fn search(
    search_index: &SearchIndex,
    input: &str,
    limit: usize,
    settings: &SearchIndexSettings,
) -> Result<(Vec<String>, Vec<SearchResult>), SearchError> {
    let parsed = parse_query(input);
    let terms = analyzed_query_terms(&parsed.text);
    let filters = analyzed_filters(&parsed.filters);
    if (terms.is_empty() && filters.is_empty()) || limit == 0 {
        return Ok((terms, Vec::new()));
    }

    let query = combined_query(search_index, &terms, &filters, &settings.synonym_groups);
    let searcher = search_index.reader.searcher();
    let top_docs = searcher.search(
        &query,
        &TopDocs::with_limit(limit.min(MAX_WINDOW)).order_by_score(),
    )?;
    let mut results = Vec::with_capacity(top_docs.len());
    for (score, address) in top_docs {
        let document = searcher.doc::<TantivyDocument>(address)?;
        if let Some(result) = result_from_document(
            &document,
            search_index.fields,
            &search_index.content,
            &terms,
            score,
        ) {
            results.push(result);
        }
    }
    Ok((terms, results))
}

/// Splits `tag:`, `title:`, `folder:` and `ext:` prefixes from the free text.
/// An unknown prefix stays part of the text: a typo in a filter must not empty the result set.
pub fn parse_query(input: &str) -> ParsedQuery {
    let mut filters = Filters::default();
    let mut text = Vec::new();
    for token in tokens(input) {
        let (kind, value) = match token.split_once(':') {
            Some((kind, value)) => (kind.to_lowercase(), value),
            None => (String::new(), ""),
        };
        let value = value.trim_matches('"').trim_start_matches('.');
        if !value.is_empty() {
            let bucket = match kind.as_str() {
                "tag" => Some(&mut filters.tags),
                "title" => Some(&mut filters.titles),
                "folder" => Some(&mut filters.folders),
                "ext" => Some(&mut filters.extensions),
                _ => None,
            };
            if let Some(bucket) = bucket {
                bucket.push(value.to_owned());
                continue;
            }
        }
        text.push(token);
    }
    ParsedQuery {
        text: text.join(" "),
        filters,
    }
}

struct AnalyzedFilters {
    tags: Vec<String>,
    titles: Vec<String>,
    folders: Vec<String>,
    extensions: Vec<String>,
}

fn analyzed_filters(filters: &Filters) -> AnalyzedFilters {
    AnalyzedFilters {
        tags: analyze_all(&filters.tags),
        titles: analyze_all(&filters.titles),
        folders: analyze_all(&filters.folders),
        extensions: analyze_all(&filters.extensions),
    }
}

impl AnalyzedFilters {
    fn is_empty(&self) -> bool {
        self.tags.is_empty()
            && self.titles.is_empty()
            && self.folders.is_empty()
            && self.extensions.is_empty()
    }
}

fn analyze_all(values: &[String]) -> Vec<String> {
    let mut terms = Vec::new();
    for value in values {
        terms.extend(analyzed_query_terms(value));
    }
    terms.sort();
    terms.dedup();
    terms
}

fn tokens(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in input.chars() {
        match character {
            '"' => {
                quoted = !quoted;
                current.push(character);
            }
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn searchable_fields(index: &SearchIndex) -> [(Field, f32); 4] {
    [
        (index.fields.title, TITLE_BOOST),
        (index.fields.tags, TAG_BOOST),
        (index.fields.path, PATH_BOOST),
        (index.fields.body, BODY_BOOST),
    ]
}

fn combined_query(
    index: &SearchIndex,
    terms: &[String],
    filters: &AnalyzedFilters,
    synonyms: &[Vec<String>],
) -> BooleanQuery {
    let mut clauses = Vec::<(Occur, Box<dyn Query>)>::new();
    let mut exact_clauses = Vec::<(Occur, Box<dyn Query>)>::new();

    for text in terms {
        let variants = synonym_variants(text, synonyms);
        let mut field_matches = Vec::<(Occur, Box<dyn Query>)>::new();
        for (field, boost) in searchable_fields(index) {
            for variant in &variants {
                let term = Term::from_field_text(field, variant);
                field_matches.push((
                    Occur::Should,
                    Box::new(BoostQuery::new(field_matcher(&term, variant), boost)),
                ));
                exact_clauses.push((
                    Occur::Should,
                    Box::new(BoostQuery::new(
                        Box::new(TermQuery::new(term, IndexRecordOption::WithFreqs)),
                        boost * 2.0,
                    )),
                ));
            }
        }
        clauses.push((Occur::Should, Box::new(BooleanQuery::new(field_matches))));
    }

    if !terms.is_empty() {
        let any_term = BooleanQuery::with_minimum_required_clauses(clauses, 1);
        exact_clauses.push((Occur::Should, Box::new(any_term)));
    }

    let mut required = Vec::<(Occur, Box<dyn Query>)>::new();
    for (field, values) in [
        (index.fields.tags, &filters.tags),
        (index.fields.title, &filters.titles),
        (index.fields.path, &filters.folders),
        (index.fields.path, &filters.extensions),
    ] {
        for value in values {
            required.push((
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(field, value),
                    IndexRecordOption::WithFreqs,
                )),
            ));
        }
    }

    let mut all = required;
    all.extend(exact_clauses);
    BooleanQuery::new(all)
}

/// Query term plus every member of its synonym group, so a group is a single recall decision.
fn synonym_variants(term: &str, synonyms: &[Vec<String>]) -> Vec<String> {
    let mut variants = vec![term.to_owned()];
    for group in synonyms {
        if group.len() < 2 || group.len() > MAX_SYNONYM_GROUP {
            continue;
        }
        let analyzed = group
            .iter()
            .flat_map(|member| analyzed_query_terms(member))
            .collect::<Vec<_>>();
        if !analyzed.iter().any(|member| member == term) {
            continue;
        }
        for member in analyzed {
            if !variants.contains(&member) {
                variants.push(member);
            }
        }
    }
    variants
}

fn field_matcher(term: &Term, text: &str) -> Box<dyn Query> {
    let length = text.chars().count();
    if length < MIN_PREFIX_CHARS {
        return Box::new(TermQuery::new(term.clone(), IndexRecordOption::WithFreqs));
    }
    let distance = u8::from(length >= MIN_FUZZY_CHARS);
    Box::new(FuzzyTermQuery::new_prefix(term.clone(), distance, true))
}

#[cfg(test)]
mod tests {
    use super::{parse_query, synonym_variants};

    #[test]
    fn prefixes_become_filters_and_unknown_prefixes_stay_text() {
        let parsed = parse_query("tag:книги ext:.md план http:пример");
        assert_eq!(parsed.filters.tags, ["книги"]);
        assert_eq!(parsed.filters.extensions, ["md"]);
        assert!(parsed.filters.titles.is_empty());
        assert_eq!(parsed.text, "план http:пример");
    }

    #[test]
    fn quoted_filter_value_keeps_its_spaces() {
        let parsed = parse_query("title:\"план работ\" отчёт");
        assert_eq!(parsed.filters.titles, ["план работ"]);
        assert_eq!(parsed.text, "отчёт");
    }

    #[test]
    fn a_synonym_group_expands_only_for_its_own_member() {
        let groups = vec![vec!["машина".to_owned(), "автомобиль".to_owned()]];
        let машина = super::analyzed_query_terms("машина");
        let автомобиль = super::analyzed_query_terms("автомобиль");
        assert_eq!(
            synonym_variants(&машина[0], &groups),
            [машина[0].clone(), автомобиль[0].clone()]
        );
        let велосипед = super::analyzed_query_terms("велосипед");
        assert_eq!(
            synonym_variants(&велосипед[0], &groups),
            [велосипед[0].clone()]
        );
    }
}
