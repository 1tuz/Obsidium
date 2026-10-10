use super::error::UiStateError;
use super::models::{PaneLayout, TabState};
use std::collections::HashMap;
use uuid::Uuid;

fn invalid(message: &str) -> UiStateError {
    UiStateError::InvalidInput {
        message: message.to_owned(),
    }
}

pub fn validate_layout(layout: &PaneLayout, tabs: &[TabState]) -> Result<(), UiStateError> {
    let mut panes = HashMap::new();
    collect_panes(layout, &mut panes, 0)?;
    for tab in tabs {
        if !panes.contains_key(tab.pane_id.as_str()) {
            return Err(invalid("tab pane is not present"));
        }
    }
    for (pane_id, active) in panes {
        if active.is_some_and(|id| {
            !tabs
                .iter()
                .any(|tab| tab.tab_id == id && tab.pane_id == pane_id)
        }) {
            return Err(invalid("pane active tab is not present in pane"));
        }
    }
    Ok(())
}

fn collect_panes<'a>(
    layout: &'a PaneLayout,
    panes: &mut HashMap<&'a str, Option<Uuid>>,
    depth: usize,
) -> Result<(), UiStateError> {
    if depth > 3 {
        return Err(invalid("pane layout is too deep"));
    }
    match layout {
        PaneLayout::Pane {
            pane_id,
            active_tab_id,
        } => {
            if pane_id.is_empty() || pane_id.len() > 128 {
                return Err(invalid("invalid pane id"));
            }
            if panes.insert(pane_id, *active_tab_id).is_some() {
                return Err(invalid("duplicate pane id"));
            }
            if panes.len() > 4 {
                return Err(invalid("at most four panes are supported"));
            }
        }
        PaneLayout::Split {
            ratio, children, ..
        } => {
            if !ratio.is_finite() || !(0.1..=0.9).contains(ratio) {
                return Err(invalid("split ratio must be between 0.1 and 0.9"));
            }
            for child in children {
                collect_panes(child, panes, depth + 1)?;
            }
        }
    }
    Ok(())
}

pub fn main_layout(active_tab_id: Option<Uuid>) -> PaneLayout {
    PaneLayout::Pane {
        pane_id: "main".to_owned(),
        active_tab_id,
    }
}

pub fn normalize_active_tabs(layout: &mut PaneLayout, tabs: &[TabState], focused: Option<Uuid>) {
    match layout {
        PaneLayout::Pane {
            pane_id,
            active_tab_id,
        } => {
            let candidates = || tabs.iter().filter(|tab| tab.pane_id == *pane_id);
            let focused = focused.filter(|id| candidates().any(|tab| tab.tab_id == *id));
            let existing = active_tab_id.filter(|id| candidates().any(|tab| tab.tab_id == *id));
            *active_tab_id = focused
                .or(existing)
                .or_else(|| candidates().next().map(|tab| tab.tab_id));
        }
        PaneLayout::Split { children, .. } => {
            for child in children {
                normalize_active_tabs(child, tabs, focused);
            }
        }
    }
}

pub fn restore_layout(
    raw: Option<&str>,
    tabs: &mut [TabState],
    active: Option<Uuid>,
) -> PaneLayout {
    let parsed = raw
        .and_then(|json| serde_json::from_str::<PaneLayout>(json).ok())
        .filter(|layout| validate_layout(layout, tabs).is_ok());
    parsed.unwrap_or_else(|| {
        for tab in tabs.iter_mut() {
            tab.pane_id = "main".to_owned();
        }
        main_layout(active.or_else(|| tabs.first().map(|tab| tab.tab_id)))
    })
}
