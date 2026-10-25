use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RemoveLongFilter, TextAnalyzer, Token, TokenFilter,
    TokenStream, Tokenizer,
};

use super::filters::{ExclusionFilter, SanitizingTokenizer};
use super::morphology::StemFilter;

pub const TOKENIZER_NAME: &str = "obsidium_text";
pub const ANALYZER_VERSION: u32 = 17;

pub fn indexing_tokenizer() -> TextAnalyzer {
    TextAnalyzer::builder(SanitizingTokenizer::default())
        .filter(RemoveLongFilter::limit(120))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .filter(CyrillicFoldFilter)
        .filter(StemFilter)
        .filter(ExclusionFilter)
        .build()
}

#[derive(Clone, Default)]
pub struct CyrillicFoldFilter;

impl TokenFilter for CyrillicFoldFilter {
    type Tokenizer<T: Tokenizer> = CyrillicFoldTokenizer<T>;

    fn transform<T: Tokenizer>(self, tokenizer: T) -> Self::Tokenizer<T> {
        CyrillicFoldTokenizer { inner: tokenizer }
    }
}

#[derive(Clone)]
pub struct CyrillicFoldTokenizer<T> {
    inner: T,
}

impl<T: Tokenizer> Tokenizer for CyrillicFoldTokenizer<T> {
    type TokenStream<'a> = CyrillicFoldTokenStream<T::TokenStream<'a>>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        CyrillicFoldTokenStream {
            tail: self.inner.token_stream(text),
        }
    }
}

pub struct CyrillicFoldTokenStream<T> {
    tail: T,
}

impl<T: TokenStream> TokenStream for CyrillicFoldTokenStream<T> {
    fn advance(&mut self) -> bool {
        if !self.tail.advance() {
            return false;
        }
        let text = &mut self.tail.token_mut().text;
        if text.contains('ё') || text.contains('Ё') {
            let folded = text
                .chars()
                .map(|character| match character {
                    'ё' => 'е',
                    'Ё' => 'Е',
                    other => other,
                })
                .collect();
            *text = folded;
        }
        true
    }

    fn token(&self) -> &Token {
        self.tail.token()
    }

    fn token_mut(&mut self) -> &mut Token {
        self.tail.token_mut()
    }
}
