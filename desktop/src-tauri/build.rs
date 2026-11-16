fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "fs_stat", "fs_read", "fs_write", "fs_list", "fs_mkdir", "fs_touch", "fs_remove", "fs_rename", "pick_dir", "pick_files", "pick_save", "take_pending",
    ])))
    .expect("tauri build");
}
