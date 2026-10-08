use super::models::{OpenSessionInput, SaveStateBatchInput};
use super::tests::{batch, setup};
use serde_json::{json, Value};
use uuid::Uuid;

fn pane(id: &str, active: Uuid) -> Value {
    json!({"kind": "pane", "paneId": id, "activeTabId": active})
}

fn value(workspace: Uuid, document: Uuid, epoch: Uuid) -> Value {
    let left = Uuid::new_v4();
    let right = Uuid::new_v4();
    json!({
        "workspaceId": workspace, "windowId": "main", "epoch": epoch,
        "sequence": 1, "nowMs": 10, "views": [],
        "session": {
            "activeTabId": right,
            "tabs": [
                {"tabId": left, "documentId": document, "kind": "document", "position": 0, "paneId": "left"},
                {"tabId": right, "documentId": document, "kind": "document", "position": 1, "paneId": "right"}
            ],
            "layout": {"kind": "split", "direction": "horizontal", "ratio": 0.4,
                "children": [pane("left", left), pane("right", right)]}
        }
    })
}

fn input(workspace: Uuid, document: Uuid, epoch: Uuid) -> SaveStateBatchInput {
    serde_json::from_value(value(workspace, document, epoch)).unwrap()
}

#[test]
fn panes_and_active_tabs_survive_session_reopen() {
    let (mut database, workspace, document, epoch) = setup();
    let expected = value(workspace, document, epoch);
    let input = serde_json::from_value(expected.clone()).unwrap();
    database.save_batch(&input).unwrap();
    let loaded = serde_json::to_value(
        database
            .open_session(&OpenSessionInput {
                workspace_id: workspace,
                window_id: "main".to_owned(),
                epoch: Uuid::new_v4(),
                now_ms: 20,
            })
            .unwrap(),
    )
    .unwrap();
    assert_eq!(loaded["layout"], expected["session"]["layout"]);
    assert_eq!(loaded["tabs"][0]["paneId"], "left");
    assert_eq!(loaded["tabs"][1]["paneId"], "right");
}

#[test]
fn invalid_panes_are_rejected_without_replacing_saved_tabs() {
    let (mut database, workspace, document, epoch) = setup();
    let initial = batch(workspace, document, epoch, 1, 0);
    database.save_batch(&initial).unwrap();
    let before = database.load_session(workspace, "main").unwrap();
    let mut value = value(workspace, document, epoch);
    value["sequence"] = json!(2);
    let mut invalid = Vec::new();
    let mut duplicate = value.clone();
    duplicate["session"]["layout"]["children"][1]["paneId"] = json!("left");
    invalid.push(duplicate);
    let mut ratio = value.clone();
    ratio["session"]["layout"]["ratio"] = json!(0.95);
    invalid.push(ratio);
    let mut missing = value.clone();
    missing["session"]["tabs"][1]["paneId"] = json!("absent");
    invalid.push(missing);
    let mut active = value.clone();
    active["session"]["layout"]["children"][0]["activeTabId"] =
        value["session"]["tabs"][1]["tabId"].clone();
    invalid.push(active);
    let mut global = value.clone();
    global["session"]["activeTabId"] = json!(Uuid::new_v4());
    invalid.push(global);
    let mut too_many = value.clone();
    let mut layout = json!({"kind": "pane", "paneId": "p0", "activeTabId": null});
    for index in 1..5 {
        layout = json!({"kind": "split", "direction": "vertical", "ratio": 0.5,
            "children": [layout, {"kind": "pane", "paneId": format!("p{index}"), "activeTabId": null}]});
    }
    too_many["session"]["tabs"] = json!([]);
    too_many["session"]["activeTabId"] = Value::Null;
    too_many["session"]["layout"] = layout;
    invalid.push(too_many);
    for value in invalid {
        let input = serde_json::from_value(value).unwrap();
        assert!(database.save_batch(&input).is_err());
        assert_eq!(database.load_session(workspace, "main").unwrap(), before);
    }
}

#[test]
fn corrupt_layout_recovers_all_tabs_in_main_pane() {
    let (mut database, workspace, document, epoch) = setup();
    let input = input(workspace, document, epoch);
    database.save_batch(&input).unwrap();
    for layout in [
        "{broken",
        r#"{"kind":"pane","paneId":"unknown","activeTabId":null}"#,
    ] {
        database
            .connection
            .execute("UPDATE sessions SET layout_json = ?1", [layout])
            .unwrap();
        let loaded =
            serde_json::to_value(database.load_session(workspace, "main").unwrap()).unwrap();
        assert_eq!(loaded["tabs"].as_array().unwrap().len(), 2);
        assert!(loaded["tabs"]
            .as_array()
            .unwrap()
            .iter()
            .all(|tab| tab["paneId"] == "main"));
        assert_eq!(
            loaded["layout"],
            pane(
                "main",
                input.session.as_ref().unwrap().active_tab_id.unwrap()
            )
        );
    }
}

#[test]
fn active_only_batch_updates_owning_pane_without_collapsing_layout() {
    let (mut database, workspace, document, epoch) = setup();
    let mut next = value(workspace, document, epoch);
    let second_left = Uuid::new_v4();
    next["session"]["tabs"].as_array_mut().unwrap().push(json!({
        "tabId": second_left,
        "documentId": document,
        "kind": "document",
        "position": 2,
        "paneId": "left"
    }));
    let initial = serde_json::from_value(next.clone()).unwrap();
    database.save_batch(&initial).unwrap();
    let layout = next["session"]["layout"].clone();
    next["sequence"] = json!(2);
    next["session"] = json!({"activeTabId": second_left, "tabs": null});
    database
        .save_batch(&serde_json::from_value(next).unwrap())
        .unwrap();
    let persisted: String = database
        .connection
        .query_row(
            "SELECT layout_json FROM sessions WHERE workspace_id = ?1 AND window_id = ?2",
            [workspace.to_string(), "main".to_owned()],
            |row| row.get(0),
        )
        .unwrap();
    let persisted: Value = serde_json::from_str(&persisted).unwrap();
    assert_eq!(persisted["children"][0]["activeTabId"], json!(second_left));
    let loaded = serde_json::to_value(database.load_session(workspace, "main").unwrap()).unwrap();
    assert_eq!(
        loaded["layout"]["children"][0]["activeTabId"],
        json!(second_left)
    );
    assert_eq!(loaded["layout"]["children"][1], layout["children"][1]);
    assert_eq!(loaded["activeTabId"], json!(second_left));
}

#[test]
fn missing_document_does_not_destroy_other_panes() {
    let (mut database, workspace, document, epoch) = setup();
    let second = database.resolve_document(workspace, "second.md").unwrap();
    let mut value = value(workspace, document, epoch);
    value["session"]["tabs"][1]["documentId"] = json!(second);
    database
        .save_batch(&serde_json::from_value(value).unwrap())
        .unwrap();
    database.mark_document_missing(document, 10).unwrap();
    let loaded = serde_json::to_value(database.load_session(workspace, "main").unwrap()).unwrap();
    assert_eq!(loaded["tabs"].as_array().unwrap().len(), 1);
    assert_eq!(loaded["layout"]["kind"], "split");
    assert_eq!(loaded["layout"]["children"][0]["activeTabId"], Value::Null);
    assert_eq!(
        loaded["layout"]["children"][1]["activeTabId"],
        loaded["tabs"][0]["tabId"]
    );
}

#[test]
fn database_failure_rolls_back_tabs_layout_and_sequence() {
    let (mut database, workspace, document, epoch) = setup();
    let initial = input(workspace, document, epoch);
    database.save_batch(&initial).unwrap();
    let before = database.load_session(workspace, "main").unwrap();
    let mut next = value(workspace, document, epoch);
    next["sequence"] = json!(2);
    next["session"]["tabs"][1]["documentId"] = json!(Uuid::new_v4());
    assert!(database
        .save_batch(&serde_json::from_value(next.clone()).unwrap())
        .is_err());
    assert_eq!(database.load_session(workspace, "main").unwrap(), before);
    next["session"]["tabs"][1]["documentId"] = json!(document);
    assert!(database
        .save_batch(&serde_json::from_value(next).unwrap())
        .unwrap());
}

#[test]
fn partial_save_repairs_corrupt_pane_membership_in_storage() {
    let (mut database, workspace, document, epoch) = setup();
    let initial = input(workspace, document, epoch);
    database.save_batch(&initial).unwrap();
    database
        .connection
        .execute("UPDATE sessions SET layout_json = '{broken'", [])
        .unwrap();
    let mut next = serde_json::to_value(&initial).unwrap();
    next["sequence"] = json!(2);
    next["session"] = json!({"activeTabId": next["session"]["activeTabId"], "tabs": null});
    database
        .save_batch(&serde_json::from_value(next).unwrap())
        .unwrap();
    let invalid: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM tabs WHERE pane_id != 'main'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(invalid, 0);
}
