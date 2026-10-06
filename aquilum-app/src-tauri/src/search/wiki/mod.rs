mod backlinks;
mod edges;
mod outgoing;
mod parser;
mod rename;
mod repository;
mod resolver;
mod service;
mod target;

const LINK_LIST_LIMIT: usize = 200;

pub use backlinks::backlinks;
pub(crate) use edges::{for_each_link, read_documents};
pub use outgoing::outgoing_links;
pub use rename::{plan_for_rename, LinkRewrite};
pub use repository::{candidate_sources, index_document, open_schema, remove_document};
pub use resolver::resolve_many;
