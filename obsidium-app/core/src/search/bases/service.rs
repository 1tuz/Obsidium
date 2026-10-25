use super::{evaluate, BaseEvaluation, BaseQuery};
use crate::search::error::SearchError;
use crate::search::paths::canonical_workspace;
use crate::search::service::SearchService;
use std::path::PathBuf;

impl SearchService {
    pub fn query_base(
        &self,
        workspace: &str,
        query: &BaseQuery,
    ) -> Result<BaseEvaluation, SearchError> {
        let rows = self.base_rows(workspace)?;
        let root = canonical_workspace(workspace).unwrap_or_else(|_| PathBuf::from(workspace));
        let rows = rows
            .into_iter()
            .map(|row| (row.path, row.fields))
            .collect::<Vec<_>>();
        if query.definition.summaries.is_empty() {
            return Ok(evaluate(&root, rows, query, None));
        }
        self.with_metadata(workspace, |_open, connection| {
            Ok(evaluate(&root, rows, query, Some(connection)))
        })
    }
}
