//! Workspace file I/O Tauri commands (§3.4 migration).
//!
//! Reads and writes `.gitwand-workspace.json` files that describe a
//! Launchpad workspace (a named collection of repo paths). The actual
//! `workspace_*_all` commands that aggregate status / PRs / issues
//! across the repos live in lib.rs for now — they depend on libgit2
//! helpers that haven't been extracted yet.

use crate::types::*;

/// Read a `.gitwand-workspace.json` from the given directory.
#[tauri::command]
pub(crate) fn workspace_read(path: String) -> Result<WorkspaceConfig, String> {
    let dir = std::path::Path::new(&path);
    let file = dir.join(".gitwand-workspace.json");
    if !file.exists() {
        return Err(format!("No workspace file found at {}", file.display()));
    }
    let content = std::fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read workspace: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspace: {}", e))
}

/// Write a `.gitwand-workspace.json` to the given directory.
#[tauri::command]
pub(crate) fn workspace_write(path: String, workspace: WorkspaceConfig) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    let file = dir.join(".gitwand-workspace.json");
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    let content = serde_json::to_string_pretty(&workspace)
        .map_err(|e| format!("Failed to serialize workspace: {}", e))?;
    std::fs::write(&file, content)
        .map_err(|e| format!("Failed to write workspace: {}", e))
}
