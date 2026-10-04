use super::*;
use std::{collections::VecDeque, ffi::OsString, sync::Arc};
use tauri::Emitter;

#[derive(Clone, Default)]
pub(crate) struct OpenRequests(Arc<Mutex<VecDeque<OpenRequest>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    paths: Vec<PathBuf>,
    source: String,
    initial: bool,
    errors: Vec<String>,
}

pub(crate) struct Launch {
    pub(crate) request: Option<OpenRequest>,
    pub(crate) independent: bool,
}

// Parse OS paths without converting them to UTF-8 or evaluating a shell command.
pub(crate) fn parse(args: impl IntoIterator<Item = OsString>, cwd: &Path, initial: bool) -> Launch {
    let mut paths = Vec::new();
    let mut errors = Vec::new();
    let mut source = "system";
    let mut independent = false;
    let mut positional = false;
    let mut awaiting_note = false;
    for arg in args {
        if !positional && arg == "--new-window" {
            independent = true;
        } else if !positional && arg == "--open-note" {
            source = "internal";
            awaiting_note = true;
        } else if !positional && arg == "--system-open" {
            source = "system";
        } else if !positional && arg == "--" {
            positional = true;
        } else if !positional && arg.to_string_lossy().starts_with('-') {
            errors.push(format!("未知启动参数：{}", arg.to_string_lossy()));
        } else {
            let path = PathBuf::from(arg);
            let path = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            if !paths.contains(&path) {
                paths.push(path);
            }
            awaiting_note = false;
        }
    }
    if awaiting_note {
        errors.push("--open-note 缺少文件路径".into());
    }
    Launch {
        independent,
        request: (!paths.is_empty() || !errors.is_empty()).then(|| OpenRequest {
            paths,
            source: source.into(),
            initial,
            errors,
        }),
    }
}

impl OpenRequests {
    pub(crate) fn push(&self, request: OpenRequest) {
        self.0.lock().unwrap().push_back(request);
    }
}

pub(crate) fn receive(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    let launch = parse(
        args.into_iter().skip(1).map(OsString::from),
        Path::new(&cwd),
        false,
    );
    if let Some(request) = launch.request {
        app.state::<OpenRequests>().push(request);
    }
    // Events only wake the frontend. The queue is authoritative, including requests
    // arriving before the listener is mounted or while another request is handled.
    let _ = app.emit("open-requests-ready", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenResult {
    documents: Vec<Document>,
    errors: Vec<String>,
}

// Paths must originate in the native launch queue. JS receives opaque IDs instead
// of permission to authorize arbitrary filesystem paths.
#[derive(Default)]
pub(crate) struct PendingOpens(Mutex<Vec<Option<OpenRequest>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenTicket {
    id: usize,
    source: String,
    initial: bool,
}

#[tauri::command]
pub(crate) fn pending_open_requests(
    queue: tauri::State<OpenRequests>,
    pending: tauri::State<PendingOpens>,
) -> Vec<OpenTicket> {
    let mut pending = pending.0.lock().unwrap();
    queue
        .0
        .lock()
        .unwrap()
        .drain(..)
        .map(|request| {
            let ticket = OpenTicket {
                id: pending.len(),
                source: request.source.clone(),
                initial: request.initial,
            };
            pending.push(Some(request));
            ticket
        })
        .collect()
}

#[tauri::command]
pub(crate) fn complete_open_request(
    state: tauri::State<AppState>,
    pending: tauri::State<PendingOpens>,
    id: usize,
    new_window: bool,
) -> Result<OpenResult> {
    let request = pending
        .0
        .lock()
        .unwrap()
        .get_mut(id)
        .and_then(Option::take)
        .ok_or("文件打开请求已失效")?;
    if new_window && !request.paths.is_empty() {
        spawn_window(&request.paths, &request.source)?;
        return Ok(OpenResult {
            documents: vec![],
            errors: request.errors,
        });
    }
    let mut result = OpenResult {
        documents: vec![],
        errors: request.errors,
    };
    for path in request.paths {
        let opened: Result<Document> = (|| {
            let path = path.canonicalize().map_err(|error| error.to_string())?;
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "md" | "markdown" | "txt") {
                return Err("此文件不是 Markdown 或文本文件".into());
            }
            let doc = read_document(&path)?;
            state.access.lock().unwrap().files.insert(path);
            Ok(doc)
        })();
        match opened {
            Ok(doc) => {
                if !result.documents.iter().any(|old| old.path == doc.path) {
                    result.documents.push(doc);
                }
            }
            Err(error) => result.errors.push(format!("{}：{error}", path.display())),
        }
    }
    Ok(result)
}

pub(crate) fn spawn_window(paths: &[PathBuf], source: &str) -> Result<()> {
    let mut command = Command::new(std::env::current_exe().map_err(|error| error.to_string())?);
    command
        .arg("--new-window")
        .arg(if source == "system" {
            "--system-open"
        } else {
            "--open-note"
        })
        .arg("--")
        .args(paths)
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
pub(crate) fn open_default_apps() -> Result<()> {
    webbrowser::open("ms-settings:defaultapps").map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_preserve_spaces_unicode_and_multiple_files() {
        let cwd = Path::new("C:/Notes");
        let launch = parse(
            ["中文 笔记.md", "second.markdown", "中文 笔记.md"].map(OsString::from),
            cwd,
            true,
        );
        let request = launch.request.unwrap();
        assert_eq!(
            request.paths,
            vec![cwd.join("中文 笔记.md"), cwd.join("second.markdown")]
        );
        assert!(request.initial);
        assert_eq!(request.source, "system");
    }
    #[test]
    fn independent_window_compatibility_and_literal_flags() {
        let launch = parse(
            ["--new-window", "--open-note", "--", "-literal.md"].map(OsString::from),
            Path::new("C:/Notes"),
            true,
        );
        assert!(launch.independent);
        let request = launch.request.unwrap();
        assert_eq!(request.source, "internal");
        assert!(request.paths[0].ends_with("-literal.md"));
        assert!(request.errors.is_empty());
    }
    #[test]
    fn empty_launch_and_missing_argument() {
        assert!(parse([], Path::new("."), true).request.is_none());
        assert!(!parse(["--open-note".into()], Path::new("."), true)
            .request
            .unwrap()
            .errors
            .is_empty());
    }
}
