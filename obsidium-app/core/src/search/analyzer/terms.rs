use super::pipeline::sanitized_text_tokenizer;
use super::sanitize::sanitize_for_search;
use std::collections::HashMap;
use tantivy::tokenizer::TokenStream;

pub struct TextTerms {
    pub frequencies: HashMap<String, u32>,
    pub labels: HashMap<String, String>,
}

pub struct TermPart<'a> {
    pub text: &'a str,
    pub frequency_weight: u32,
    pub label_weight: u32,
}

#[derive(Default)]
struct StemStats<'a> {
    frequency: u32,
    surfaces: HashMap<&'a str, u32>,
}

pub fn text_terms(parts: &[TermPart<'_>]) -> TextTerms {
    let sanitized: Vec<String> = parts
        .iter()
        .map(|part| sanitize_for_search(part.text))
        .collect();
    let mut stems: HashMap<String, StemStats<'_>> = HashMap::new();
    let mut tokenizer = sanitized_text_tokenizer();
    for (part, text) in parts.iter().zip(&sanitized) {
        tokenizer.token_stream(text).process(&mut |token| {
            if !two_or_more_chars(&token.text) {
                return;
            }
            let surface = &text[token.offset_from..token.offset_to];
            let stats = match stems.get_mut(token.text.as_str()) {
                Some(stats) => stats,
                None => stems.entry(token.text.clone()).or_default(),
            };
            stats.frequency = stats.frequency.saturating_add(part.frequency_weight);
            if part.label_weight == 0 || !two_or_more_chars(surface) {
                return;
            }
            let count = stats.surfaces.entry(surface).or_insert(0);
            *count = count.saturating_add(part.label_weight);
        });
    }
    finish(stems)
}

pub fn term_count(text: &str) -> usize {
    let sanitized = sanitize_for_search(text);
    let mut count = 0usize;
    sanitized_text_tokenizer()
        .token_stream(&sanitized)
        .process(&mut |token| {
            if two_or_more_chars(&token.text) {
                count += 1;
            }
        });
    count
}

fn two_or_more_chars(text: &str) -> bool {
    text.chars().nth(1).is_some()
}

fn finish(stems: HashMap<String, StemStats<'_>>) -> TextTerms {
    let mut frequencies = HashMap::with_capacity(stems.len());
    let mut labels = HashMap::with_capacity(stems.len());
    for (stem, stats) in stems {
        if stats.frequency > 0 {
            frequencies.insert(stem.clone(), stats.frequency);
        }
        let best = stats.surfaces.into_iter().max_by(
            |(left_surface, left_count), (right_surface, right_count)| {
                left_count
                    .cmp(right_count)
                    .then_with(|| {
                        right_surface
                            .chars()
                            .count()
                            .cmp(&left_surface.chars().count())
                    })
                    .then_with(|| right_surface.cmp(left_surface))
            },
        );
        if let Some((surface, _)) = best {
            labels.insert(stem, surface.to_owned());
        }
    }
    TextTerms {
        frequencies,
        labels,
    }
}
