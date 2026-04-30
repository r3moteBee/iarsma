// Phase 0 work item 11 — minimal native shell.
//
// Delegates to `iarsma_lib::run` so the desktop entry point and the
// (future, Phase 6) mobile entry points share a single implementation.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    iarsma_lib::run();
}
