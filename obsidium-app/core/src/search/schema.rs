use super::analyzer::{indexing_tokenizer, TOKENIZER_NAME};
use super::error::SearchError;
use super::index::SearchFields;
use std::collections::HashMap;
use tantivy::schema::{IndexRecordOption, Schema, TextFieldIndexing, TextOptions, STORED, STRING};
use tantivy::tokenizer::TokenStream;
use tantivy::{Index, IndexReader, ReloadPolicy};

pub fn build() -> Schema {
    let mut builder = Schema::builder();
    builder.add_text_field("id", STRING | STORED);
    builder.add_text_field("path", text_options(Store::Never));
    builder.add_text_field("title", text_options(Store::Never));
    builder.add_text_field("tags", text_options(Store::Always));
    builder.add_text_field("body", text_options(Store::Never));
    builder.build()
}

pub fn register_tokenizer(index: &Index) {
    index
        .tokenizers()
        .register(TOKENIZER_NAME, indexing_tokenizer());
}

pub fn term_frequencies(text: &str) -> HashMap<String, u32> {
    token_statistics(text).frequencies
}

pub struct TokenStatistics {
    pub frequencies: HashMap<String, u32>,
}

pub fn token_statistics(text: &str) -> TokenStatistics {
    let mut frequencies = HashMap::new();
    indexing_tokenizer()
        .token_stream(text)
        .process(&mut |token| {
            if token.text.chars().count() >= 2 {
                let frequency = frequencies.entry(token.text.clone()).or_insert(0u32);
                *frequency = frequency.saturating_add(1);
            }
        });
    TokenStatistics { frequencies }
}

pub fn fields(schema: &Schema) -> Result<SearchFields, SearchError> {
    Ok(SearchFields {
        id: field(schema, "id")?,
        path: field(schema, "path")?,
        title: field(schema, "title")?,
        tags: field(schema, "tags")?,
        body: field(schema, "body")?,
    })
}

pub fn reader(index: &Index) -> Result<IndexReader, SearchError> {
    Ok(index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()?)
}

#[derive(Clone, Copy)]
enum Store {
    Always,
    Never,
}

fn text_options(store: Store) -> TextOptions {
    let indexing = TextFieldIndexing::default()
        .set_tokenizer(TOKENIZER_NAME)
        .set_index_option(IndexRecordOption::WithFreqs);
    let options = TextOptions::default().set_indexing_options(indexing);
    match store {
        Store::Always => options.set_stored(),
        Store::Never => options,
    }
}

fn field(schema: &Schema, name: &str) -> Result<tantivy::schema::Field, SearchError> {
    schema.get_field(name).map_err(|error| SearchError::Index {
        message: error.to_string(),
    })
}
