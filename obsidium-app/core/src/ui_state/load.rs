use super::database::UiStateDatabase;
use super::error::UiStateError;
use super::models::{
    parse_uuid_column, GraphCameraState, LoadedSession, LoadedTabState, LoadedViewState, TabKind,
    TabState,
};
use super::panes::{normalize_active_tabs, restore_layout};
use rusqlite::{params, OptionalExtension, Row};
use std::collections::HashSet;
use uuid::Uuid;

impl UiStateDatabase {
    pub fn load_session(
        &self,
        workspace_id: Uuid,
        window_id: &str,
    ) -> Result<LoadedSession, UiStateError> {
        let stored_session = self
            .connection
            .query_row(
                "SELECT CASE WHEN EXISTS(
                     SELECT 1 FROM tabs t WHERE t.workspace_id = sessions.workspace_id
                     AND t.window_id = sessions.window_id AND t.tab_id = sessions.active_tab_id
                 ) THEN active_tab_id ELSE NULL END, layout_json
                 FROM sessions WHERE workspace_id = ?1 AND window_id = ?2",
                params![workspace_id.to_string(), window_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()?
            .unwrap_or((None, None));
        let stored_active = stored_session
            .0
            .map(|value| parse_uuid_column(value, 0))
            .transpose()?;
        let mut tab_query = self.connection.prepare(
            "SELECT t.tab_id, t.document_id, t.kind, t.position, d.relative_path, t.pane_id,
                    (t.document_id IS NULL OR d.status = 'active')
             FROM tabs t LEFT JOIN documents d
                 ON d.workspace_id = t.workspace_id AND d.id = t.document_id
             WHERE t.workspace_id = ?1 AND t.window_id = ?2
             ORDER BY t.position, t.tab_id",
        )?;
        let stored_tabs = tab_query
            .query_map(params![workspace_id.to_string(), window_id], |row| {
                let tab_id = parse_uuid_column(row.get::<_, String>(0)?, 0)?;
                let document_id = row
                    .get::<_, Option<String>>(1)?
                    .map(|value| parse_uuid_column(value, 1))
                    .transpose()?;
                Ok((
                    LoadedTabState {
                        tab_id,
                        document_id,
                        kind: TabKind::parse(&row.get::<_, String>(2)?, 2)?,
                        position: row.get(3)?,
                        relative_path: row.get(4)?,
                        pane_id: row.get(5)?,
                    },
                    row.get::<_, bool>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut tab_states = stored_tabs
            .iter()
            .map(|(tab, _)| TabState {
                tab_id: tab.tab_id,
                document_id: tab.document_id,
                kind: tab.kind.clone(),
                position: tab.position,
                pane_id: tab.pane_id.clone(),
            })
            .collect::<Vec<_>>();
        let mut layout =
            restore_layout(stored_session.1.as_deref(), &mut tab_states, stored_active);
        let tabs = stored_tabs
            .into_iter()
            .zip(tab_states.iter())
            .filter_map(|((mut tab, visible), state)| {
                tab.pane_id = state.pane_id.clone();
                visible.then_some(tab)
            })
            .collect::<Vec<_>>();
        let visible_ids: HashSet<_> = tabs.iter().map(|tab| tab.tab_id).collect();
        tab_states.retain(|state| visible_ids.contains(&state.tab_id));
        let active = stored_active
            .filter(|active| tabs.iter().any(|tab| tab.tab_id == *active))
            .or_else(|| tabs.first().map(|tab| tab.tab_id));
        normalize_active_tabs(&mut layout, &tab_states, active);
        let views = self.load_open_views(workspace_id, window_id)?;
        let graph_camera = self.load_graph_camera(workspace_id, window_id)?;
        Ok(LoadedSession {
            active_tab_id: active,
            layout,
            tabs,
            views,
            graph_camera,
        })
    }

    fn load_graph_camera(
        &self,
        workspace_id: Uuid,
        window_id: &str,
    ) -> Result<Option<GraphCameraState>, UiStateError> {
        Ok(self
            .connection
            .query_row(
                "SELECT graph_center_x, graph_center_y, graph_scale FROM sessions
                 WHERE workspace_id = ?1 AND window_id = ?2",
                params![workspace_id.to_string(), window_id],
                |row| {
                    Ok(
                        match (
                            row.get::<_, Option<f64>>(0)?,
                            row.get::<_, Option<f64>>(1)?,
                            row.get::<_, Option<f64>>(2)?,
                        ) {
                            (Some(center_x), Some(center_y), Some(scale)) => {
                                Some(GraphCameraState {
                                    center_x,
                                    center_y,
                                    scale,
                                })
                            }
                            _ => None,
                        },
                    )
                },
            )
            .optional()?
            .flatten())
    }

    fn load_open_views(
        &self,
        workspace_id: Uuid,
        window_id: &str,
    ) -> Result<Vec<LoadedViewState>, UiStateError> {
        let mut query = self.connection.prepare(
            "SELECT document_id, pane_id, cursor_anchor, cursor_head, fallback_anchor,
                    fallback_head, scroll_anchor, fallback_scroll_anchor,
                    scroll_offset_px, focused_surface
             FROM view_states v WHERE workspace_id = ?1 AND window_id = ?2
             AND EXISTS(SELECT 1 FROM tabs t WHERE t.workspace_id = v.workspace_id
                 AND t.window_id = v.window_id AND t.document_id = v.document_id)",
        )?;
        let values = query.query_map(params![workspace_id.to_string(), window_id], map_view)?;
        Ok(values.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn load_view(
        &self,
        workspace_id: Uuid,
        window_id: &str,
        document_id: Uuid,
        pane_id: &str,
    ) -> Result<Option<LoadedViewState>, UiStateError> {
        Ok(self
            .connection
            .query_row(
                "SELECT document_id, pane_id, cursor_anchor, cursor_head, fallback_anchor,
                    fallback_head, scroll_anchor, fallback_scroll_anchor,
                    scroll_offset_px, focused_surface
             FROM view_states WHERE workspace_id = ?1 AND window_id = ?2
                 AND document_id = ?3 AND pane_id = ?4",
                params![
                    workspace_id.to_string(),
                    window_id,
                    document_id.to_string(),
                    pane_id
                ],
                map_view,
            )
            .optional()?)
    }
}

fn map_view(row: &Row<'_>) -> rusqlite::Result<LoadedViewState> {
    Ok(LoadedViewState {
        document_id: parse_uuid_column(row.get::<_, String>(0)?, 0)?,
        pane_id: row.get(1)?,
        cursor_anchor: row.get(2)?,
        cursor_head: row.get(3)?,
        fallback_anchor: row.get(4)?,
        fallback_head: row.get(5)?,
        scroll_anchor: row.get(6)?,
        fallback_scroll_anchor: row.get(7)?,
        scroll_offset_px: row.get(8)?,
        focused_surface: row.get(9)?,
    })
}
