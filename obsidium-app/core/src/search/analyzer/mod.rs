pub mod exclusions;
pub mod filters;
pub mod frontmatter;
pub mod morphology;
pub mod pipeline;
pub mod sanitize;
pub mod terms;

pub use frontmatter::set as frontmatter_set;
pub use frontmatter::{body as frontmatter_body, field as frontmatter_field};
pub use frontmatter::{unquote as frontmatter_unquote, yaml_block as frontmatter_yaml};
pub use terms::{term_count, text_terms, TermPart, TextTerms};

#[cfg(test)]
mod equivalence_tests;
#[cfg(test)]
mod tests;

pub use pipeline::{indexing_tokenizer, ANALYZER_VERSION, TOKENIZER_NAME};
