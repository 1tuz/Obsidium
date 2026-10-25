use super::service::{link_target, list_dates, note_path, today};
use super::{JournalError, JournalSettings};
use crate::search::note_date;
use crate::settings::models::AppConfig;
use std::fs;
use std::path::Path;

fn today_date(path: &Path) -> (i64, i64, i64) {
    let stem = path.file_stem().unwrap().to_str().unwrap();
    note_date::civil_date(stem).unwrap()
}

#[test]
fn today_creates_the_note_once_and_never_overwrites_it() {
    let vault = tempfile::tempdir().unwrap();
    let settings = JournalSettings::default();

    let first = today(vault.path(), &settings).unwrap();
    assert!(first.created);
    assert_eq!(
        first.path.parent().unwrap(),
        vault.path().join("journal").as_path()
    );
    assert_eq!(first.path.extension().unwrap().to_str().unwrap(), "md");
    let (year, month, day) = today_date(&first.path);
    assert_eq!(
        fs::read_to_string(&first.path).unwrap(),
        format!("---\ncreated: {year:04}-{month:02}-{day:02}\n---\n")
    );

    fs::write(&first.path, "правка пользователя").unwrap();
    let second = today(vault.path(), &settings).unwrap();
    assert!(!second.created);
    assert_eq!(second.path, first.path);
    assert_eq!(
        fs::read_to_string(&first.path).unwrap(),
        "правка пользователя"
    );
}

#[test]
fn a_template_fills_date_time_and_title() {
    let vault = tempfile::tempdir().unwrap();
    fs::create_dir_all(vault.path().join("Templates")).unwrap();
    fs::write(
        vault.path().join("Templates/Daily.md"),
        "# {{title}}\ncreated: {{date}}\ntime: {{time}}\nkept: {{unknown}}\n",
    )
    .unwrap();
    let settings = JournalSettings {
        template_path: Some("Templates/Daily.md".to_owned()),
        ..JournalSettings::default()
    };

    let note = today(vault.path(), &settings).unwrap();
    let content = fs::read_to_string(&note.path).unwrap();
    let name = note.path.file_stem().unwrap().to_str().unwrap();
    let (year, month, day) = today_date(&note.path);
    let time = content
        .lines()
        .find_map(|line| line.strip_prefix("time: "))
        .unwrap();

    assert_eq!(name, format!("{year:04}-{month:02}-{day:02}"));
    assert!(content.starts_with(&format!("# {name}\ncreated: {name}\n")));
    assert_eq!(time.len(), 5);
    let digits = time.as_bytes();
    assert_eq!(digits[2], b':');
    assert!(digits[..2].iter().all(u8::is_ascii_digit));
    assert!(digits[3..].iter().all(u8::is_ascii_digit));
    assert!(content.ends_with("kept: {{unknown}}\n"));
    assert_eq!(
        fs::read_to_string(vault.path().join("Templates/Daily.md")).unwrap(),
        "# {{title}}\ncreated: {{date}}\ntime: {{time}}\nkept: {{unknown}}\n"
    );

    fs::remove_file(vault.path().join("Templates/Daily.md")).unwrap();
    let again = today(vault.path(), &settings).unwrap();
    assert!(!again.created);
    assert_eq!(again.path, note.path);
    assert_eq!(fs::read_to_string(&note.path).unwrap(), content);
}

#[test]
fn a_custom_format_names_the_file_and_keeps_created_in_iso() {
    let vault = tempfile::tempdir().unwrap();
    let settings = JournalSettings {
        folder: "Дневник".to_owned(),
        date_format: "DD.MM.YYYY".to_owned(),
        ..JournalSettings::default()
    };

    let note = today(vault.path(), &settings).unwrap();

    assert_eq!(
        note.path.parent().unwrap(),
        vault.path().join("Дневник").as_path()
    );
    let dates = list_dates(vault.path(), &settings);
    assert_eq!(dates.len(), 1);
    let (year, month, day) = dates[0];
    assert_eq!(
        note.path.file_name().unwrap().to_str().unwrap(),
        format!("{day:02}.{month:02}.{year:04}.md")
    );
    assert_eq!(
        fs::read_to_string(&note.path).unwrap(),
        format!("---\ncreated: {year:04}-{month:02}-{day:02}\n---\n")
    );
}

#[test]
fn list_dates_skips_garbage_and_sorts() {
    let vault = tempfile::tempdir().unwrap();
    let settings = JournalSettings::default();
    let folder = vault.path().join("journal");
    fs::create_dir_all(&folder).unwrap();
    for name in [
        "2026-10-26.md",
        "2026-10-25.md",
        "2026-02-30.md",
        "2026-10-2.md",
        "2026-10-25-extra.md",
        "2026-10-25.txt",
        "заметка.md",
        ".md",
    ] {
        fs::write(folder.join(name), "").unwrap();
    }
    fs::create_dir_all(folder.join("2026-10-27.md")).unwrap();

    assert_eq!(
        list_dates(vault.path(), &settings),
        vec![(2026, 10, 25), (2026, 10, 26)]
    );
}

#[test]
fn list_dates_reads_the_configured_format_and_tolerates_absence() {
    let vault = tempfile::tempdir().unwrap();
    let settings = JournalSettings {
        date_format: "DD.MM.YYYY".to_owned(),
        ..JournalSettings::default()
    };
    assert!(list_dates(vault.path(), &settings).is_empty());

    let folder = vault.path().join("journal");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("25.10.2026.md"), "").unwrap();
    fs::write(folder.join("2026-10-26.md"), "").unwrap();
    assert_eq!(list_dates(vault.path(), &settings), vec![(2026, 10, 25)]);

    let broken = JournalSettings {
        date_format: "YYYY-MM-DD HH:mm".to_owned(),
        ..JournalSettings::default()
    };
    assert!(list_dates(vault.path(), &broken).is_empty());
}

#[test]
fn note_path_formats_the_folder_and_the_date() {
    let vault = tempfile::tempdir().unwrap();
    let settings = JournalSettings {
        folder: "Journal/Daily".to_owned(),
        date_format: "DD.MM.YYYY".to_owned(),
        ..JournalSettings::default()
    };

    assert_eq!(
        note_path(vault.path(), &settings, (2026, 10, 5)).unwrap(),
        vault.path().join("Journal/Daily/05.10.2026.md")
    );
    assert_eq!(
        note_path(vault.path(), &JournalSettings::default(), (2026, 10, 5)).unwrap(),
        vault.path().join("journal/2026-10-05.md")
    );
}

#[test]
fn an_invalid_date_format_is_a_settings_error() {
    let vault = tempfile::tempdir().unwrap();
    for format in [
        "YYYY-MM-DD HH:mm",
        "yyyy-MM-dd",
        "YYYY-MM-DDD",
        "YYYY-MM",
        "MM-DD",
        "YYYY-MM-DD-DD",
        "  ",
    ] {
        let settings = JournalSettings {
            date_format: format.to_owned(),
            ..JournalSettings::default()
        };
        assert!(
            matches!(
                note_path(vault.path(), &settings, (2026, 10, 25)),
                Err(JournalError::Settings { .. })
            ),
            "{format}"
        );
    }
}

#[test]
fn a_date_that_does_not_exist_is_rejected() {
    let vault = tempfile::tempdir().unwrap();
    let settings = JournalSettings::default();
    for date in [(2026, 2, 30), (2026, 13, 1), (2026, 0, 1), (0, 1, 1)] {
        assert!(
            matches!(
                note_path(vault.path(), &settings, date),
                Err(JournalError::Date { .. })
            ),
            "{date:?}"
        );
    }
    assert!(note_path(vault.path(), &settings, (2024, 2, 29)).is_ok());
}

#[test]
fn a_template_outside_the_vault_or_missing_is_an_error() {
    let vault = tempfile::tempdir().unwrap();
    let outside = JournalSettings {
        template_path: Some("../outside.md".to_owned()),
        ..JournalSettings::default()
    };
    assert!(matches!(
        today(vault.path(), &outside),
        Err(JournalError::Settings { .. })
    ));

    let missing = JournalSettings {
        template_path: Some("Templates/Missing.md".to_owned()),
        ..JournalSettings::default()
    };
    assert!(matches!(
        today(vault.path(), &missing),
        Err(JournalError::Template { .. })
    ));
    assert!(!vault.path().join("journal").exists());
}

#[test]
fn link_target_is_always_canonical_iso() {
    assert_eq!(link_target((2026, 10, 25)), "[[2026-10-25]]");
    assert_eq!(link_target((2026, 1, 2)), "[[2026-01-02]]");
}

#[test]
fn the_journal_section_defaults_and_round_trips_through_the_config() {
    let config: AppConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(config.journal.folder, "journal");
    assert_eq!(config.journal.date_format, "YYYY-MM-DD");
    assert!(config.journal.template_path.is_none());

    let config: AppConfig = serde_json::from_str(
        r#"{"journal":{"folder":"Дневник","dateFormat":"DD.MM.YYYY","templatePath":"Templates/Daily.md"}}"#,
    )
    .unwrap();
    assert_eq!(config.journal.folder, "Дневник");
    assert_eq!(config.journal.date_format, "DD.MM.YYYY");
    assert_eq!(
        config.journal.template_path.as_deref(),
        Some("Templates/Daily.md")
    );

    let restored: AppConfig =
        serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
    assert_eq!(restored.journal.date_format, "DD.MM.YYYY");
}
