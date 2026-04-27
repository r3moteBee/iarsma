// memory-backend component.
//
// Pluggable MemoryBackend trait. Tier-1 default: SQLite-via-OPFS / Tauri filesystem. Tier-2 OB1 adapter lands in Phase 5+.
//
// WIT contract: wit/memory_backend.wit (lands in F-3 / Phase 0)
// Implementation: scaffold only — real code lands per implementation plan.

#![allow(dead_code)]

// wit_bindgen::generate!({
//     world: "memory_backend",
//     path: "wit/",
// });
