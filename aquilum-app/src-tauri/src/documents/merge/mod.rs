mod char_edits;
mod line_diff;
mod merge;
mod utf16;

pub use char_edits::TextEdit;
pub use merge::merge_external_change;
pub use utf16::utf16_len;

#[cfg(test)]
mod tests;
