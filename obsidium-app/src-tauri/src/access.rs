use obsidium_core::access::PathGrants;
use std::path::Path;
use tauri::Manager;

pub fn allow_root<R: tauri::Runtime, M: Manager<R>>(manager: &M, root: &Path) -> tauri::Result<()> {
    manager.asset_protocol_scope().allow_directory(root, true)
}

pub fn allow_grants<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
    grants: &PathGrants,
) -> tauri::Result<()> {
    for root in grants.roots() {
        allow_root(manager, &root)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{allow_grants, allow_root};
    use obsidium_core::access::PathGrants;
    use std::fs;
    use std::path::PathBuf;
    use tauri::Manager;

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("obsidium-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        fs::canonicalize(path).unwrap()
    }

    fn app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }

    #[test]
    fn asset_scope_follows_the_granted_roots() {
        let app = app();
        let vault = scratch("asset-scope-vault");
        let cover = vault.join("Files").join("cover.png");
        fs::create_dir_all(cover.parent().unwrap()).unwrap();
        fs::write(&cover, b"cover").unwrap();
        let outside_root = scratch("asset-scope-outside");
        let outside = outside_root.join("secret.txt");
        fs::write(&outside, b"secret").unwrap();
        let grants = PathGrants::new();

        let scope = app.asset_protocol_scope();
        assert!(!scope.is_allowed(&cover));

        assert!(grants.grant_root(&vault));
        allow_grants(&app, &grants).unwrap();

        assert!(scope.is_allowed(&cover));
        assert!(!scope.is_allowed(&outside));

        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(&outside_root);
    }

    #[test]
    fn picked_root_is_served_immediately() {
        let app = app();
        let vault = scratch("asset-scope-picked");
        let image = vault.join("Files").join("picked.png");
        fs::create_dir_all(image.parent().unwrap()).unwrap();
        fs::write(&image, b"picked").unwrap();

        let scope = app.asset_protocol_scope();
        assert!(!scope.is_allowed(&image));

        allow_root(&app, &vault).unwrap();

        assert!(scope.is_allowed(&image));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn shipped_config_starts_with_an_empty_asset_scope() {
        let config: tauri::utils::config::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();

        assert!(config
            .app
            .security
            .asset_protocol
            .scope
            .allowed_paths()
            .is_empty());
    }
}
