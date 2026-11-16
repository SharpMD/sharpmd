// SharpMD for Windows, macOS and Linux. The window shows sharpmd.app, so the app is always the current one, and shim.js
// gives it the disk through the commands below. The disk commands only reach what the person picked in a dialog or
// opened from the system (a double click, "Open with", a file dragged onto the icon): those roots are remembered
// between launches, and anything outside them is refused.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;

const APP_URL: &str = "https://sharpmd.app/src/app.html";
const HOST: &str = "sharpmd.app";
const SHIM: &str = include_str!("shim.js");

#[derive(Default)]
struct Disk {
    roots: Mutex<Vec<PathBuf>>,
    pending: Mutex<Vec<Opened>>,
    file: PathBuf,
}

#[derive(Clone, Serialize)]
struct Opened {
    path: String,
    dir: bool,
}

#[derive(Serialize)]
struct Stat {
    kind: &'static str,
    size: u64,
    mtime: u64,
}

#[derive(Serialize)]
struct Entry {
    name: String,
    dir: bool,
}

#[derive(Deserialize)]
struct Filter {
    name: String,
    exts: Vec<String>,
}

fn err<E: std::fmt::Display>(code: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{code}: {e}")
}

fn io(e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => format!("NotFoundError: {e}"),
        std::io::ErrorKind::PermissionDenied => format!("NoModificationAllowedError: {e}"),
        _ => format!("InvalidModificationError: {e}"),
    }
}

// The real path, without "\\?\" on Windows. A path that does not exist yet is its real parent plus its name.
fn real(p: &Path) -> Option<PathBuf> {
    if !p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    if let Ok(r) = dunce::canonicalize(p) {
        return Some(r);
    }
    let parent = dunce::canonicalize(p.parent()?).ok()?;
    Some(parent.join(p.file_name()?))
}

fn same_or_under(p: &Path, root: &Path) -> bool {
    if cfg!(windows) {
        let a = p.to_string_lossy().to_lowercase();
        let b = root.to_string_lossy().to_lowercase();
        a == b || a.starts_with(&(b.trim_end_matches('\\').to_string() + "\\"))
    } else {
        p.starts_with(root)
    }
}

impl Disk {
    fn load(file: PathBuf) -> Self {
        let roots = fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .unwrap_or_default();
        Disk { roots: Mutex::new(roots), pending: Mutex::new(vec![]), file }
    }
    fn grant(&self, p: &Path) {
        let Some(r) = real(p) else { return };
        let mut roots = self.roots.lock().unwrap();
        if roots.iter().any(|x| same_or_under(&r, x)) {
            return;
        }
        roots.retain(|x| !same_or_under(x, &r));
        roots.push(r);
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(&self.file, serde_json::to_string(&*roots).unwrap_or_default());
    }
    fn check(&self, p: &str) -> Result<PathBuf, String> {
        let r = real(Path::new(p)).ok_or_else(|| "NotAllowedError: path".to_string())?;
        if self.roots.lock().unwrap().iter().any(|x| same_or_under(&r, x)) {
            Ok(r)
        } else {
            Err("NotAllowedError: SharpMD can only reach what you opened".into())
        }
    }
}

fn mtime(m: &fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[tauri::command]
fn fs_stat(disk: State<Disk>, path: String) -> Result<Stat, String> {
    let p = disk.check(&path)?;
    Ok(match fs::metadata(&p) {
        Ok(m) => Stat { kind: if m.is_dir() { "dir" } else { "file" }, size: m.len(), mtime: mtime(&m) },
        Err(_) => Stat { kind: "none", size: 0, mtime: 0 },
    })
}

#[tauri::command]
fn fs_read(disk: State<Disk>, path: String) -> Result<Response, String> {
    let p = disk.check(&path)?;
    fs::read(p).map(Response::new).map_err(io)
}

// Written next to the file and renamed over it, so a crash or a full disk never leaves half a note.
#[tauri::command]
fn fs_write(disk: State<Disk>, request: Request) -> Result<(), String> {
    let raw = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("NotAllowedError: path")?;
    let path = percent_decode(raw);
    let p = disk.check(&path)?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("TypeMismatchError: body".into()) };
    if p.is_dir() {
        return Err("TypeMismatchError: is a folder".into());
    }
    let name = p.file_name().ok_or("NotAllowedError: path")?.to_string_lossy().to_string();
    let tmp = p.with_file_name(format!(".{name}.sharpmd-tmp"));
    fs::write(&tmp, bytes).map_err(io)?;
    if let Err(e) = fs::rename(&tmp, &p) {
        let _ = fs::remove_file(&tmp);
        // Some synced or locked folders refuse the rename: write in place.
        fs::write(&p, bytes).map_err(|_| io(e))?;
    }
    Ok(())
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn fs_list(disk: State<Disk>, path: String) -> Result<Vec<Entry>, String> {
    let p = disk.check(&path)?;
    let mut out = vec![];
    for e in fs::read_dir(p).map_err(io)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(".sharpmd-tmp") {
            continue;
        }
        let dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(Entry { name, dir });
    }
    Ok(out)
}

#[tauri::command]
fn fs_mkdir(disk: State<Disk>, path: String) -> Result<(), String> {
    fs::create_dir_all(disk.check(&path)?).map_err(io)
}

#[tauri::command]
fn fs_touch(disk: State<Disk>, path: String) -> Result<(), String> {
    let p = disk.check(&path)?;
    fs::OpenOptions::new().create(true).append(true).open(p).map(|_| ()).map_err(io)
}

#[tauri::command]
fn fs_remove(disk: State<Disk>, path: String, recursive: bool) -> Result<(), String> {
    let p = disk.check(&path)?;
    let m = fs::metadata(&p).map_err(io)?;
    if m.is_dir() {
        if recursive { fs::remove_dir_all(p) } else { fs::remove_dir(p) }.map_err(io)
    } else {
        fs::remove_file(p).map_err(io)
    }
}

#[tauri::command]
fn fs_rename(disk: State<Disk>, from: String, to: String) -> Result<(), String> {
    let a = disk.check(&from)?;
    let b = disk.check(&to)?;
    if b.exists() {
        return Err("InvalidModificationError: already exists".into());
    }
    fs::rename(a, b).map_err(io)
}

fn add_filters<R: tauri::Runtime>(mut d: tauri_plugin_dialog::FileDialogBuilder<R>, filters: &[Filter]) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    for f in filters {
        let exts: Vec<&str> = f.exts.iter().map(|s| s.as_str()).collect();
        d = d.add_filter(&f.name, &exts);
    }
    d
}

#[tauri::command]
async fn pick_dir(app: AppHandle, disk: State<'_, Disk>) -> Result<Option<String>, String> {
    let Some(p) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
    let p = p.into_path().map_err(err("NotAllowedError"))?;
    disk.grant(&p);
    Ok(real(&p).map(|r| r.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn pick_files(app: AppHandle, disk: State<'_, Disk>, multiple: bool, filters: Vec<Filter>) -> Result<Vec<String>, String> {
    let d = add_filters(app.dialog().file(), &filters);
    let picked = if multiple { d.blocking_pick_files().unwrap_or_default() } else { d.blocking_pick_file().into_iter().collect() };
    let mut out = vec![];
    for f in picked {
        if let Ok(p) = f.into_path() {
            disk.grant(&p);
            if let Some(r) = real(&p) {
                out.push(r.to_string_lossy().into_owned());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
async fn pick_save(app: AppHandle, disk: State<'_, Disk>, name: String, filters: Vec<Filter>) -> Result<Option<String>, String> {
    let mut d = add_filters(app.dialog().file(), &filters);
    if !name.is_empty() {
        d = d.set_file_name(&name);
    }
    let Some(p) = d.blocking_save_file() else { return Ok(None) };
    let p = p.into_path().map_err(err("NotAllowedError"))?;
    if !p.exists() {
        fs::write(&p, b"").map_err(io)?;
    }
    disk.grant(&p);
    Ok(real(&p).map(|r| r.to_string_lossy().into_owned()))
}

#[tauri::command]
fn take_pending(disk: State<Disk>) -> Vec<Opened> {
    std::mem::take(&mut *disk.pending.lock().unwrap())
}

// A file or folder handed over by the system: it becomes reachable, and the app opens it.
fn open_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    let disk = app.state::<Disk>();
    let mut any = false;
    for p in paths {
        let Some(r) = real(&p) else { continue };
        if !r.exists() {
            continue;
        }
        disk.grant(&r);
        disk.pending.lock().unwrap().push(Opened { path: r.to_string_lossy().into_owned(), dir: r.is_dir() });
        any = true;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if any {
            let _ = w.eval("window.__smdDesktop && window.__smdDesktop.pull()");
        }
    }
}

fn args_paths(args: &[String]) -> Vec<PathBuf> {
    args.iter().skip(1).filter(|a| !a.starts_with('-')).map(PathBuf::from).filter(|p| p.is_absolute() || p.exists()).map(|p| std::path::absolute(&p).unwrap_or(p)).collect()
}

fn ours(url: &Url) -> bool {
    match url.scheme() {
        "https" => url.host_str() == Some(HOST),
        "http" | "file" => false,
        _ => true, // blob:, data:, about:, tauri:, ipc:
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| open_paths(app, args_paths(&args))))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            fs_stat, fs_read, fs_write, fs_list, fs_mkdir, fs_touch, fs_remove, fs_rename, pick_dir, pick_files, pick_save, take_pending
        ])
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            app.manage(Disk::load(data.join("roots.json")));
            let first = args_paths(&std::env::args().collect::<Vec<_>>());
            let url: Url = APP_URL.parse().unwrap();
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("SharpMD")
                .inner_size(1200.0, 820.0)
                .min_inner_size(420.0, 520.0)
                .initialization_script(SHIM)
                .disable_drag_drop_handler()
                .on_navigation(move |u| {
                    if ours(u) {
                        return true;
                    }
                    if matches!(u.scheme(), "https" | "http" | "mailto") {
                        let _ = tauri_plugin_opener::open_url(u.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;
            if !first.is_empty() {
                open_paths(&handle, first);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("SharpMD could not start")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.into_iter().filter_map(|u| u.to_file_path().ok()).collect();
                open_paths(_app, paths);
            }
        });
}
