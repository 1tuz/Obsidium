use super::query;
use super::{as_object, head_fields, NoteFieldRows, NoteFields};
use crate::search::error::SearchError;
use crate::search::models::SearchIndexState;
use crate::search::paths::canonical_path;
use crate::search::service::SearchService;
use std::path::Path;

impl SearchService {
    pub fn note_fields(
        &self,
        workspace: &str,
        paths: &[String],
    ) -> Result<Vec<NoteFields>, SearchError> {
        let requested = paths
            .iter()
            .map(|path| (path.clone(), canonical_path(Path::new(path))))
            .collect::<Vec<_>>();
        Ok(self.with_metadata(workspace, |open, connection| {
            let requested = requested
                .iter()
                .map(|(path, canonical)| {
                    (
                        path.clone(),
                        canonical
                            .starts_with(&open.root)
                            .then(|| canonical.to_string_lossy().into_owned()),
                    )
                })
                .collect::<Vec<_>>();
            let inside = requested
                .iter()
                .filter_map(|(_, canonical)| canonical.clone())
                .collect::<Vec<_>>();
            let mut indexed = query::read(connection, &inside)?;
            Ok(requested
                .into_iter()
                .map(|(path, canonical)| {
                    let found = canonical
                        .map(|canonical| {
                            indexed
                                .remove(&canonical)
                                .unwrap_or_else(|| head_fields(Path::new(&canonical)))
                        })
                        .unwrap_or_default();
                    NoteFields {
                        path,
                        fields: as_object(&found),
                    }
                })
                .collect())
        })?)
    }

    pub fn note_fields_for_filter(
        &self,
        workspace: &str,
        equals: &[(String, String)],
        has: &[String],
    ) -> Result<Option<NoteFieldRows>, SearchError> {
        if self.ready_metadata(workspace).is_none() {
            return Ok(None);
        }
        Ok(Some(self.with_metadata(
            workspace,
            |_open, connection| {
                let paths = query::candidates(connection, equals, has)?;
                let mut fields = query::read(connection, &paths)?;
                Ok(paths
                    .into_iter()
                    .map(|path| {
                        let found = fields.remove(&path).unwrap_or_default();
                        (path, found)
                    })
                    .collect())
            },
        )?))
    }

    pub fn base_rows(&self, workspace: &str) -> Result<Vec<NoteFields>, SearchError> {
        let Some(rows) = self.note_fields_for_filter(workspace, &[], &[])? else {
            return Ok(Vec::new());
        };
        Ok(rows
            .into_iter()
            .map(|(path, fields)| NoteFields {
                path,
                fields: as_object(&fields),
            })
            .collect())
    }

    fn ready_metadata(&self, workspace: &str) -> Option<()> {
        self.with_index(workspace, |open| {
            let status = open.progress.snapshot();
            Ok((status.state == SearchIndexState::Ready && !status.updating).then_some(()))
        })
        .ok()
        .flatten()
    }
}
