use std::path::{Path, PathBuf};

use aquilum_core::bases::BaseColumn;
use masonry::core::{NewWidget, PropertySet, Widget, WidgetId};
use masonry::kurbo::Axis;
use masonry::layout::Length;
use masonry::properties::types::{CrossAxisAlignment, MainAxisAlignment};
use masonry::properties::{Background, Gap, Padding};
use masonry::widgets::{Flex, SizedBox};
use serde_json::Value;

use super::scroll::ScrollArea;
use super::text::label;
use super::tokens::size;
use super::widgets::{DocumentItem, IconButton, Rule, TextButton, Variant, Wrap};
use super::{icons, theme};
use crate::i18n::t;

pub enum KanbanStatus {
    Loading,
    Ready,
    Error(String),
    NoWorkspace,
}

#[derive(Clone, Debug, PartialEq)]
pub enum KanbanAction {
    OpenNote(PathBuf),
    OpenBoard(PathBuf),
    ClosePicker,
    CreateBoard,
    CreateCard {
        column: Value,
    },
    MoveCard {
        path: PathBuf,
        expected: Value,
        target: Value,
    },
    SelectView(usize),
}

pub struct KanbanView;

impl KanbanView {
    pub fn new(
        columns: &[BaseColumn],
        status: KanbanStatus,
        editable: bool,
        views: &[String],
        selected_view: usize,
    ) -> (NewWidget<dyn Widget>, Vec<(WidgetId, KanbanAction)>) {
        let tm = theme::current();
        let mut actions = Vec::new();
        let create_board = NewWidget::new(TextButton::new(t("kanban.newBoard"), Variant::Ghost));
        let create_board_id = create_board.id();
        actions.push((create_board_id, KanbanAction::CreateBoard));
        let mut header = Flex::row()
            .cross_axis_alignment(CrossAxisAlignment::Center)
            .with_fixed(label(
                &t("kanban.title"),
                tm.text_primary,
                None,
                size::SIZE_24 as f32,
            ));
        for (index, name) in views.iter().enumerate() {
            let name = if name.is_empty() {
                format!("{} {}", t("kanban.view"), index + 1)
            } else {
                name.clone()
            };
            let view_button = NewWidget::new(
                TextButton::new(name, Variant::Ghost).pressed(index == selected_view),
            );
            let view_id = view_button.id();
            actions.push((view_id, KanbanAction::SelectView(index)));
            header = header.with_fixed(view_button);
        }
        header = header.with_fixed(create_board);
        let header = NewWidget::new(header).with_props(
            PropertySet::new()
                .with(Gap::new(Length::px(size::SPACE_8)))
                .with(Padding::all(Length::px(size::SPACE_16)))
                .with(Background::Color(tm.tabs_bg)),
        );
        let body = match status {
            KanbanStatus::Loading => status_page(&t("kanban.loading"), tm.text_secondary),
            KanbanStatus::Error(error) => status_page(&error, tm.text_danger),
            KanbanStatus::NoWorkspace => status_page(&t("kanban.noWorkspace"), tm.text_secondary),
            KanbanStatus::Ready => board(columns, editable, &mut actions),
        };
        let page = Flex::column()
            .cross_axis_alignment(CrossAxisAlignment::Stretch)
            .with_fixed(header)
            .with_fixed(Rule::new(Axis::Horizontal, || {
                theme::current().sidebar_border
            }))
            .with(body, 1.0);
        (
            NewWidget::new(page)
                .with_props(PropertySet::new().with(Background::Color(tm.editor_bg)))
                .erased(),
            actions,
        )
    }
}

pub struct BoardPicker;

impl BoardPicker {
    pub fn new(boards: &[PathBuf]) -> (NewWidget<dyn Widget>, Vec<(WidgetId, KanbanAction)>) {
        let tm = theme::current();
        let mut actions = Vec::new();
        let create = NewWidget::new(TextButton::new(t("kanban.newBoard"), Variant::Primary));
        actions.push((create.id(), KanbanAction::CreateBoard));
        let mut rows = Flex::column()
            .cross_axis_alignment(CrossAxisAlignment::Stretch)
            .with_fixed(create);
        for path in boards {
            let title = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            let item = DocumentItem::new(
                title,
                path.parent().and_then(Path::to_str).map(str::to_owned),
            );
            actions.push((item.id(), KanbanAction::OpenBoard(path.clone())));
            rows = rows.with_fixed(item);
        }
        if boards.is_empty() {
            rows = rows.with_fixed(label(
                &t("kanban.noBoards"),
                tm.text_secondary,
                None,
                size::SIZE_20 as f32,
            ));
        }
        let content = NewWidget::new(ScrollArea::new(NewWidget::new(rows))).erased();
        let close = NewWidget::new(IconButton::new(icons::X, t("common.close")));
        actions.push((close.id(), KanbanAction::ClosePicker));
        let title = NewWidget::new(
            Flex::row()
                .cross_axis_alignment(CrossAxisAlignment::Center)
                .with(
                    label(
                        &t("kanban.boards"),
                        tm.text_primary,
                        None,
                        size::SIZE_24 as f32,
                    ),
                    1.0,
                )
                .with_fixed(close),
        )
        .with_props(PropertySet::new().with(Padding::all(Length::px(size::SPACE_16))));
        let page = Flex::column()
            .cross_axis_alignment(CrossAxisAlignment::Stretch)
            .with_fixed(title)
            .with(content, 1.0);
        (
            NewWidget::new(page)
                .with_props(PropertySet::new().with(Background::Color(tm.editor_bg)))
                .erased(),
            actions,
        )
    }
}

fn status_page(message: &str, color: masonry::peniko::Color) -> NewWidget<dyn Widget> {
    let content = Flex::column()
        .main_axis_alignment(MainAxisAlignment::Center)
        .cross_axis_alignment(CrossAxisAlignment::Center)
        .with_fixed(label(message, color, None, size::SIZE_20 as f32));
    NewWidget::new(content)
        .with_props(PropertySet::new().with(Padding::all(Length::px(size::SPACE_24))))
        .erased()
}

fn board(
    columns: &[BaseColumn],
    editable: bool,
    actions: &mut Vec<(WidgetId, KanbanAction)>,
) -> NewWidget<dyn Widget> {
    let tm = theme::current();
    if columns.is_empty() {
        return status_page(&t("kanban.noColumns"), tm.text_secondary);
    }
    let mut widgets = Vec::with_capacity(columns.len());
    for (column_index, column) in columns.iter().enumerate() {
        let value = column.value.clone();
        let title = group_title(&value);
        let heading = NewWidget::new(Flex::row().with_fixed(label(
            &title,
            tm.text_primary,
            None,
            size::SIZE_20 as f32,
        )));
        let mut cards = Flex::column().cross_axis_alignment(CrossAxisAlignment::Stretch);
        if column.rows.is_empty() {
            cards = cards.with_fixed(label(
                &t("kanban.noCards"),
                tm.text_tertiary,
                None,
                size::SIZE_16 as f32,
            ));
        }
        for row in &column.rows {
            let path = PathBuf::from(&row.path);
            let title = row
                .fields
                .get("title")
                .and_then(Value::as_str)
                .filter(|title| !title.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    path.file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_owned()
                });
            let item = DocumentItem::new(&title, None);
            actions.push((item.id(), KanbanAction::OpenNote(path.clone())));
            let mut card = Flex::row()
                .cross_axis_alignment(CrossAxisAlignment::Center)
                .with(item, 1.0);
            if editable && column_index > 0 {
                let target = columns[column_index - 1].value.clone();
                let button =
                    NewWidget::new(IconButton::new(icons::ARROW_LEFT, t("kanban.movePrevious")));
                actions.push((
                    button.id(),
                    KanbanAction::MoveCard {
                        path: path.clone(),
                        expected: value.clone(),
                        target,
                    },
                ));
                card = card.with_fixed(button);
            }
            if editable && column_index + 1 < columns.len() {
                let target = columns[column_index + 1].value.clone();
                let button =
                    NewWidget::new(IconButton::new(icons::ARROW_RIGHT, t("kanban.moveNext")));
                actions.push((
                    button.id(),
                    KanbanAction::MoveCard {
                        path,
                        expected: value.clone(),
                        target,
                    },
                ));
                card = card.with_fixed(button);
            }
            cards = cards.with_fixed(
                NewWidget::new(card).with_props(
                    PropertySet::new()
                        .with(Background::Color(tm.sidebar_bg))
                        .with(Padding::all(Length::px(size::SPACE_6))),
                ),
            );
        }
        let list = NewWidget::new(ScrollArea::new(NewWidget::new(cards))).erased();
        let column_widget = Flex::column()
            .cross_axis_alignment(CrossAxisAlignment::Stretch)
            .with_fixed(heading)
            .with(list, 1.0);
        let column_widget = if editable {
            let create = NewWidget::new(TextButton::new(t("kanban.addCard"), Variant::Ghost));
            actions.push((create.id(), KanbanAction::CreateCard { column: value }));
            column_widget.with_fixed(create)
        } else {
            column_widget
        };
        let column_widget = NewWidget::new(
            SizedBox::new(NewWidget::new(column_widget)).width(Length::px(size::BACKLINKS_WIDTH)),
        )
        .with_props(
            PropertySet::new()
                .with(Background::Color(tm.sidebar_bg))
                .with(Padding::all(Length::px(size::SPACE_12))),
        );
        widgets.push(column_widget.erased());
    }
    let layout = Wrap::new(widgets, size::SPACE_12);
    NewWidget::new(ScrollArea::new(layout)).erased()
}

fn group_title(value: &Value) -> String {
    match value {
        Value::Null => t("kanban.unassigned"),
        Value::String(value) => value.clone(),
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::group_title;
    use serde_json::json;

    #[test]
    fn group_title_keeps_scalar_values_and_names_unassigned() {
        assert!(!group_title(&json!(null)).is_empty());
        assert_eq!(group_title(&json!("Doing")), "Doing");
        assert_eq!(group_title(&json!(3)), "3");
        assert_eq!(group_title(&json!(true)), "true");
    }
}
