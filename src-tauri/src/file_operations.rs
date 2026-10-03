use super::*;
use std::time::UNIX_EPOCH;

pub(crate) fn valid_name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.trim().is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name.chars().any(char::is_control)
        || reserved.contains(&stem.as_str())
    {
        return Err("请填写有效的名称，不包含路径、保留名称或特殊字符。".into());
    }
    Ok(())
}

pub(crate) fn workspace_path(state: &AppState, path: &str, allow_root: bool) -> Result<PathBuf> {
    let canonical = normalize_existing(path)?;
    let root = state
        .access
        .lock()
        .map_err(|e| e.to_string())?
        .root
        .clone()
        .ok_or("请先打开文件夹")?;
    if !canonical.starts_with(&root) || (!allow_root && canonical == root) {
        return Err("只能操作当前笔记文件夹内的项目，不能修改根文件夹。".into());
    }
    Ok(canonical)
}

#[tauri::command]
pub(crate) fn create_folder(
    state: tauri::State<AppState>,
    parent: String,
    name: String,
) -> Result<String> {
    valid_name(&name)?;
    let parent = workspace_path(&state, &parent, true)?;
    if !parent.is_dir() {
        return Err("请选择文件夹".into());
    }
    let path = parent.join(name);
    fs::create_dir(&path).map_err(|e| format!("无法新建（可能已存在）：{e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

pub(crate) fn rename_without_replace(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileW(source: *const u16, destination: *const u16) -> i32;
        }
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if destination.exists() {
            return Err("目标名称已存在，请换一个名称。".into());
        }
        fs::rename(source, destination).map_err(|e| e.to_string())
    }
}

fn update_paths(state: &AppState, source: &Path, destination: Option<&Path>) {
    if let Ok(mut access) = state.access.lock() {
        access.files = access
            .files
            .iter()
            .filter_map(|path| match path.strip_prefix(source) {
                Ok(relative) => destination.map(|target| target.join(relative)),
                Err(_) => Some(path.clone()),
            })
            .collect();
    }
    if let Ok(mut files) = state.recent_files.lock() {
        *files = files
            .iter()
            .filter_map(|path| match path.strip_prefix(source) {
                Ok(relative) => destination.map(|target| target.join(relative)),
                Err(_) => Some(path.clone()),
            })
            .collect();
        // A completed filesystem operation must still be reported as successful
        // if writing the optional recent-history cache fails.
        let _ = save_recent_files(state, &files);
    }
}

pub(crate) fn rename_path(state: &AppState, path: &str, name: &str) -> Result<String> {
    valid_name(name)?;
    let source = workspace_path(state, path, false)?;
    let destination = source.parent().ok_or("缺少父目录")?.join(name);
    if source == destination {
        return Ok(source.to_string_lossy().into_owned());
    }
    rename_without_replace(&source, &destination)?;
    update_paths(state, &source, Some(&destination));
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn rename_entry(
    state: tauri::State<AppState>,
    path: String,
    name: String,
) -> Result<String> {
    rename_path(&state, &path, &name)
}

pub(crate) fn duplicate_path(state: &AppState, path: &str, suffix: &str) -> Result<Document> {
    valid_name(suffix)?;
    let source = workspace_path(state, path, false)?;
    if !source.is_file() {
        return Err("请选择一篇笔记文件。".into());
    }
    read_document(&source)?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let extension = source
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..=1000 {
        let number = if index == 1 {
            String::new()
        } else {
            format!(" {index}")
        };
        let destination = source
            .parent()
            .ok_or("缺少父目录")?
            .join(format!("{stem} {suffix}{number}{extension}"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(mut file) => {
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
                state
                    .access
                    .lock()
                    .map_err(|e| e.to_string())?
                    .files
                    .insert(destination.clone());
                return read_document(&destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("副本名称已用完，请先重命名已有副本。".into())
}

#[tauri::command]
pub(crate) fn duplicate_note(
    state: tauri::State<AppState>,
    path: String,
    suffix: String,
) -> Result<Document> {
    duplicate_path(&state, &path, &suffix)
}

fn shell_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
    }
}

#[tauri::command]
pub(crate) fn open_in_new_window(state: tauri::State<AppState>, path: String) -> Result<()> {
    let path = workspace_path(&state, &path, false)?;
    read_document(&path)?;
    let mut command = Command::new(std::env::current_exe().map_err(|error| error.to_string())?);
    command
        .arg("--open-note")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn startup_document(state: tauri::State<AppState>) -> Option<Document> {
    state.initial_document.lock().unwrap().take()
}

fn recycle(path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::{System::Com::*, UI::Shell::*},
        };
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|error| error.to_string())?;
            struct Apartment;
            impl Drop for Apartment {
                fn drop(&mut self) {
                    unsafe {
                        CoUninitialize();
                    }
                }
            }
            let _apartment = Apartment;
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|error| error.to_string())?;
            operation
                .SetOperationFlags(
                    FOFX_RECYCLEONDELETE
                        | FOFX_EARLYFAILURE
                        | FOF_NOCONFIRMATION
                        | FOF_NOERRORUI
                        | FOF_SILENT,
                )
                .map_err(|error| error.to_string())?;
            let path: Vec<u16> = std::ffi::OsStr::new(&shell_path(path))
                .encode_wide()
                .chain(Some(0))
                .collect();
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None)
                .map_err(|error| error.to_string())?;
            operation
                .DeleteItem(&item, None)
                .and_then(|_| operation.PerformOperations())
                .map_err(|error| format!("无法移入回收站，操作未完成：{error}"))?;
            if operation
                .GetAnyOperationsAborted()
                .map_err(|error| error.to_string())?
                .as_bool()
            {
                return Err("无法移入回收站，操作已取消。".into());
            }
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("此平台尚不支持移入回收站。".into())
    }
}

#[tauri::command]
pub(crate) async fn trash_entry(state: tauri::State<'_, AppState>, path: String) -> Result<()> {
    let path = workspace_path(&state, &path, false)?;
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || recycle(&target))
        .await
        .map_err(|e| e.to_string())??;
    update_paths(&state, &path, None);
    Ok(())
}

#[tauri::command]
pub(crate) fn entry_properties(state: tauri::State<AppState>, path: String) -> Result<Value> {
    let path = workspace_path(&state, &path, true)?;
    let info = fs::metadata(&path).map_err(|e| e.to_string())?;
    let timestamp = |time: std::io::Result<std::time::SystemTime>| {
        time.ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
    };
    Ok(
        json!({ "path": path.to_string_lossy(), "directory": info.is_dir(), "size": if info.is_dir() { None } else { Some(info.len()) }, "modified": timestamp(info.modified()), "created": timestamp(info.created()) }),
    )
}

#[tauri::command]
pub(crate) fn reveal_entry(state: tauri::State<AppState>, path: String) -> Result<()> {
    let path = workspace_path(&state, &path, true)?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg("/select,")
            .arg(shell_path(&path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("此平台尚不支持打开文件位置。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state(data: &Path, root: &Path) -> AppState {
        AppState {
            access: Mutex::new(Access {
                root: Some(root.canonicalize().unwrap()),
                files: HashSet::new(),
            }),
            recent_files: Mutex::new(Vec::new()),
            worker: Mutex::new(None),
            data: data.to_owned(),
            renderer: PathBuf::new(),
            renderer_args: Vec::new(),
            recovery: recovery::Recovery::new(data).unwrap(),
            initial_document: Mutex::new(None),
        }
    }
    #[test]
    fn names_and_workspace_boundary_are_checked() {
        for name in [
            "",
            ".hidden",
            "../escape",
            "a\\b",
            "CON.md",
            "nul",
            "LPT1.txt",
            "note.",
            "note ",
            "note:stream",
            "a\n",
        ] {
            assert!(valid_name(name).is_err(), "{name}");
        }
        valid_name("中文 笔记.md").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("notes");
        fs::create_dir(&root).unwrap();
        let outside = dir.path().join("outside.md");
        fs::write(&outside, "keep").unwrap();
        let app = state(dir.path(), &root);
        assert!(workspace_path(&app, &outside.to_string_lossy(), true).is_err());
        assert!(workspace_path(&app, &root.to_string_lossy(), false).is_err());
        assert!(workspace_path(&app, &root.join("../outside.md").to_string_lossy(), true).is_err());
        assert!(workspace_path(&app, &root.to_string_lossy(), true).is_ok());
        assert_eq!(fs::read_to_string(outside).unwrap(), "keep");
    }
    #[test]
    fn copies_preserve_bytes_and_never_overwrite_existing_names() {
        let dir = tempfile::tempdir().unwrap();
        let app = state(dir.path(), dir.path());
        let path = dir.path().join("note.md");
        let bytes = b"\xef\xbb\xbf# original\r\n";
        fs::write(&path, bytes).unwrap();
        fs::write(dir.path().join("note copy.md"), "keep").unwrap();
        let copy = duplicate_path(&app, &path.to_string_lossy(), "copy").unwrap();
        assert!(copy.path.ends_with("note copy 2.md"));
        assert!(copy.bom);
        assert_eq!(copy.eol, "CRLF");
        assert_eq!(fs::read(copy.path).unwrap(), bytes);
        assert_eq!(
            fs::read_to_string(dir.path().join("note copy.md")).unwrap(),
            "keep"
        );
    }
    #[test]
    #[cfg(windows)]
    fn case_only_renaming_preserves_file_contents() {
        let dir = tempfile::tempdir().unwrap();
        let app = state(dir.path(), dir.path());
        let path = dir.path().join("Note.md");
        fs::write(&path, "original").unwrap();
        let renamed = rename_path(&app, &path.to_string_lossy(), "note.md").unwrap();
        assert!(renamed.ends_with("note.md"));
        assert_eq!(fs::read_to_string(renamed).unwrap(), "original");
    }
    #[test]
    fn renaming_folders_updates_authorized_and_recent_descendants_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("notes");
        fs::create_dir(&root).unwrap();
        let source = root.join("old");
        fs::create_dir(&source).unwrap();
        let path = source.join("note.md");
        fs::write(&path, "original").unwrap();
        let app = state(dir.path(), &root);
        let path = path.canonicalize().unwrap();
        app.access.lock().unwrap().files.insert(path.clone());
        app.recent_files.lock().unwrap().push(path);
        let destination = rename_path(&app, &source.to_string_lossy(), "new").unwrap();
        let moved = PathBuf::from(destination).join("note.md");
        assert!(app.access.lock().unwrap().files.contains(&moved));
        assert_eq!(app.recent_files.lock().unwrap()[0], moved);
        let occupied = moved.parent().unwrap().join("occupied.md");
        fs::write(&occupied, "keep").unwrap();
        assert!(rename_path(&app, &moved.to_string_lossy(), "occupied.md").is_err());
        assert_eq!(fs::read_to_string(&moved).unwrap(), "original");
        assert_eq!(fs::read_to_string(occupied).unwrap(), "keep");
    }
}
