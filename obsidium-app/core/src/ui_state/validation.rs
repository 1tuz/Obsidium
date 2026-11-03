use super::error::UiStateError;
use super::models::{OpenSessionInput, SaveStateBatchInput, TabKind};
use super::panes::validate_layout;
use std::collections::HashSet;

fn invalid(message: impl Into<String>) -> UiStateError {
    UiStateError::InvalidInput {
        message: message.into(),
    }
}

fn validate_label(value: &str, name: &str) -> Result<(), UiStateError> {
    if value.is_empty() || value.len() > 128 {
        return Err(invalid(format!("invalid {name}")));
    }
    Ok(())
}

pub fn validate_open_session(input: &OpenSessionInput) -> Result<(), UiStateError> {
    validate_label(&input.window_id, "window id")
}

pub fn validate_batch(input: &SaveStateBatchInput) -> Result<(), UiStateError> {
    validate_label(&input.window_id, "window id")?;
    if input.sequence < 0 {
        return Err(invalid("sequence must not be negative"));
    }
    if let Some(session) = &input.session {
        let tabs = session.tabs.as_deref().unwrap_or(&[]);
        let mut tab_ids = HashSet::with_capacity(tabs.len());
        for tab in tabs {
            validate_label(&tab.pane_id, "pane id")?;
            if !tab_ids.insert(tab.tab_id) {
                return Err(invalid("duplicate tab id"));
            }
            match (&tab.kind, tab.document_id, tab.url.as_deref()) {
                (TabKind::Document, None, _)
                | (TabKind::Document, Some(_), Some(_))
                | (TabKind::Empty | TabKind::Graph, Some(_), _)
                | (TabKind::Empty | TabKind::Graph, None, Some(_))
                | (TabKind::Web, Some(_), _)
                | (TabKind::Web, None, None) => {
                    return Err(invalid("tab kind does not match document id"));
                }
                (TabKind::Web, None, Some(url)) if !valid_web_url(url) => {
                    return Err(invalid("invalid web tab URL"));
                }
                _ => {}
            }
        }
        if let Some(layout) = &session.layout {
            if session.tabs.is_some() {
                validate_layout(layout, tabs)?;
            }
        }
        if session.tabs.is_some()
            && session
                .active_tab_id
                .is_some_and(|active| !tab_ids.contains(&active))
        {
            return Err(invalid("active tab is not present"));
        }
    }
    if let Some(camera) = &input.graph_camera {
        if !camera.center_x.is_finite() || !camera.center_y.is_finite() {
            return Err(invalid("graph camera centre must be finite"));
        }
        if !camera.scale.is_finite() || camera.scale <= 0.0 {
            return Err(invalid("graph camera scale must be positive"));
        }
    }
    for view in &input.views {
        validate_label(&view.pane_id, "pane id")?;
        validate_label(&view.focused_surface, "focused surface")?;
        if view.fallback_anchor < 0 || view.fallback_head < 0 || view.fallback_scroll_anchor < 0 {
            return Err(invalid("fallback position must not be negative"));
        }
        if !view.scroll_offset_px.is_finite() {
            return Err(invalid("scroll offset must be finite"));
        }
        if view.cursor_anchor.len() > 4_096
            || view.cursor_head.len() > 4_096
            || view.scroll_anchor.len() > 4_096
        {
            return Err(invalid("relative position is too large"));
        }
    }
    Ok(())
}

fn valid_web_url(value: &str) -> bool {
    if value.is_empty() || value.len() > 8192 || value.chars().any(char::is_control) {
        return false;
    }
    let Some((scheme, remainder)) = value.split_once("://") else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    let authority = remainder.split(['/', '?', '#']).next().unwrap_or_default();
    !authority.is_empty() && !authority.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::validate_batch;
    use crate::ui_state::models::SaveStateBatchInput;
    use uuid::Uuid;

    #[test]
    fn web_tabs_require_absolute_http_or_https_urls() {
        use super::valid_web_url;

        assert!(valid_web_url("https://example.com/path"));
        assert!(valid_web_url("http://localhost:8080"));
        assert!(!valid_web_url("javascript:alert(1)"));
        assert!(!valid_web_url("https://"));
        assert!(!valid_web_url("https://example.com/\n"));
    }

    #[test]
    fn stale_or_malformed_batch_is_rejected_before_storage() {
        let input = SaveStateBatchInput {
            workspace_id: Uuid::new_v4(),
            window_id: "main".to_owned(),
            epoch: Uuid::new_v4(),
            sequence: -1,
            now_ms: 1,
            session: None,
            views: Vec::new(),
            graph_camera: None,
        };
        assert!(validate_batch(&input).is_err());
    }
}
