//! Iarsma — Tauri 2 desktop wrap.
//!
//! Phase 0 deliberately keeps this trivial: spin up the default Tauri
//! runtime over the bundled webview, no custom commands. Native API
//! integration (system tray, native notifications, native filesystem)
//! lands in Phase 6 — the scaffold here exists so the Tauri build
//! pipeline is exercised end-to-end before we depend on it.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
