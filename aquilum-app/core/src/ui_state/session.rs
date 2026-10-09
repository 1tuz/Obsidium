use super::error::UiStateError;
use super::models::{parse_uuid_column, PaneLayout, SaveStateBatchInput, TabKind, TabState};
use super::panes::{main_layout, normalize_active_tabs, restore_layout, validate_layout};
use rusqlite::{params, OptionalExtension, Transaction};
use uuid::Uuid;

pub fn save_session(
    transaction: &Transaction<'_>,
    input: &SaveStateBatchInput,
) -> Result<(), UiStateError> {
    let Some(session) = &input.session else {
        return Ok(());
    };
    let workspace = input.workspace_id.to_string();
    if session.tabs.is_none() && session.layout.is_none() {
        let active_pane = if let Some(active) = session.active_tab_id {
            let pane = transaction
                .query_row(
                    "SELECT pane_id FROM tabs WHERE workspace_id = ?1 AND window_id = ?2 AND tab_id = ?3",
                    params![workspace, input.window_id, active.to_string()],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if pane.is_none() {
                return Err(UiStateError::InvalidInput {
                    message: "active tab is not present".to_owned(),
                });
            }
            pane
        } else {
            None
        };
        let raw = transaction
            .query_row(
                "SELECT layout_json FROM sessions WHERE workspace_id = ?1 AND window_id = ?2",
                params![workspace, input.window_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let parsed_layout = raw
            .as_deref()
            .map(serde_json::from_str::<PaneLayout>)
            .transpose();
        let malformed_layout = parsed_layout.is_err();
        let mut layout = parsed_layout
            .ok()
            .flatten()
            .unwrap_or_else(|| main_layout(session.active_tab_id));
        let valid_owner = active_pane.as_deref().map_or(true, |pane_id| {
            set_active_tab(&mut layout, pane_id, session.active_tab_id)
        });
        if malformed_layout || !valid_owner {
            layout = main_layout(session.active_tab_id);
            transaction.execute(
                "UPDATE tabs SET pane_id = 'main' WHERE workspace_id = ?1 AND window_id = ?2",
                params![workspace, input.window_id],
            )?;
        }
        let layout =
            serde_json::to_string(&layout).map_err(|error| UiStateError::InvalidInput {
                message: error.to_string(),
            })?;
        transaction.execute(
            "UPDATE sessions SET active_tab_id = ?3, layout_json = ?4 WHERE workspace_id = ?1 AND window_id = ?2",
            params![workspace, input.window_id, session.active_tab_id.map(|id| id.to_string()), layout],
        )?;
        return Ok(());
    }
    let mut query = transaction.prepare(
        "SELECT tab_id, document_id, kind, position, pane_id FROM tabs
         WHERE workspace_id = ?1 AND window_id = ?2 ORDER BY position, tab_id",
    )?;
    let mut stored = query
        .query_map(params![workspace, input.window_id], |row| {
            Ok(TabState {
                tab_id: parse_uuid_column(row.get(0)?, 0)?,
                document_id: row
                    .get::<_, Option<String>>(1)?
                    .map(|id| parse_uuid_column(id, 1))
                    .transpose()?,
                kind: TabKind::parse(&row.get::<_, String>(2)?, 2)?,
                position: row.get(3)?,
                pane_id: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let raw = transaction
        .query_row(
            "SELECT layout_json FROM sessions WHERE workspace_id = ?1 AND window_id = ?2",
            params![workspace, input.window_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let stored_has_other_panes = stored.iter().any(|tab| tab.pane_id != "main");
    let mut layout = session
        .layout
        .clone()
        .unwrap_or_else(|| restore_layout(raw.as_deref(), &mut stored, None));
    let tabs = session.tabs.as_deref().unwrap_or(&stored);
    if session
        .active_tab_id
        .is_some_and(|active| !tabs.iter().any(|tab| tab.tab_id == active))
    {
        return Err(UiStateError::InvalidInput {
            message: "active tab is not present".to_owned(),
        });
    }
    if session.layout.is_none() {
        normalize_active_tabs(&mut layout, tabs, session.active_tab_id);
    }
    validate_layout(&layout, tabs)?;
    let layout_json =
        serde_json::to_string(&layout).map_err(|error| UiStateError::InvalidInput {
            message: error.to_string(),
        })?;
    if let Some(tabs) = &session.tabs {
        transaction.execute(
            "DELETE FROM tabs WHERE workspace_id = ?1 AND window_id = ?2",
            params![workspace, input.window_id],
        )?;
        for tab in tabs {
            transaction.execute(
                "INSERT INTO tabs(workspace_id, window_id, tab_id, document_id, kind, position, pane_id)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![workspace, input.window_id, tab.tab_id.to_string(),
                    tab.document_id.map(|id| id.to_string()), tab.kind.as_str(), tab.position, tab.pane_id],
            )?;
        }
    } else if session.layout.is_none()
        && stored_has_other_panes
        && matches!(&layout, PaneLayout::Pane { pane_id, .. } if pane_id == "main")
    {
        transaction.execute(
            "UPDATE tabs SET pane_id = 'main' WHERE workspace_id = ?1 AND window_id = ?2",
            params![workspace, input.window_id],
        )?;
    }
    transaction.execute(
        "UPDATE sessions SET active_tab_id = ?3, layout_json = ?4
         WHERE workspace_id = ?1 AND window_id = ?2",
        params![
            workspace,
            input.window_id,
            session.active_tab_id.map(|id| id.to_string()),
            layout_json
        ],
    )?;
    Ok(())
}

fn set_active_tab(layout: &mut PaneLayout, pane_id: &str, active_tab_id: Option<Uuid>) -> bool {
    match layout {
        PaneLayout::Pane {
            pane_id: candidate,
            active_tab_id: active,
        } if candidate == pane_id => {
            *active = active_tab_id;
            true
        }
        PaneLayout::Split { children, .. } => {
            set_active_tab(&mut children[0], pane_id, active_tab_id)
                || set_active_tab(&mut children[1], pane_id, active_tab_id)
        }
        _ => false,
    }
}
