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
        Ok(evaluate(
            &root,
            rows.into_iter().map(|row| (row.path, row.fields)).collect(),
            query,
        ))
    }
}
