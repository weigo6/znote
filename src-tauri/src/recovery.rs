use super::*;

// Each window owns a snapshot and an exclusive lock for its lifetime. Only
// snapshots left by a closed process are restored by a later window.
pub(crate) struct Recovery {
    path: PathBuf,
    lock: Option<fs::File>,
    claimed: Mutex<Vec<(PathBuf, PathBuf, fs::File)>>,
    data: PathBuf,
}

fn lock(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(path)
}

impl Recovery {
    pub(crate) fn new(data: &Path) -> std::io::Result<Self> {
        let directory = data.join("sessions");
        fs::create_dir_all(&directory)?;
        let unique = tempfile::Builder::new()
            .prefix("window-")
            .suffix(".lock")
            .tempfile_in(&directory)?;
        let (_, lock_path) = unique.keep().map_err(|error| error.error)?;
        let path = lock_path.with_extension("json");
        Ok(Self {
            lock: Some(lock(&lock_path)?),
            path,
            data: data.to_owned(),
            claimed: Mutex::new(Vec::new()),
        })
    }

    pub(crate) fn read(&self) -> Value {
        let mut paths: Vec<PathBuf> = fs::read_dir(self.data.join("sessions"))
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "json")
                    && path != &self.path
            })
            .collect();
        paths.push(self.data.join("recovery.json")); // Migrate the previous single-window format.
        paths.sort_by_key(|path| fs::metadata(path).and_then(|info| info.modified()).ok());
        let mut claimed = self.claimed.lock().unwrap();
        let mut documents = Vec::<Value>::new();
        for path in paths {
            if !path.is_file() || claimed.iter().any(|(old, _, _)| old == &path) {
                continue;
            }
            let lock_path = path.with_extension("lock");
            let Ok(guard) = lock(&lock_path) else {
                continue;
            };
            let Some(saved) = fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            else {
                continue;
            };
            let Some(saved) = saved.as_array() else {
                continue;
            };
            for doc in saved {
                let key = |doc: &Value| {
                    doc.get("path")
                        .or_else(|| doc.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_lowercase)
                };
                if let Some(key) = key(doc) {
                    for old in &mut documents {
                        let old_key = old
                            .get("path")
                            .or_else(|| old.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_lowercase();
                        if key == old_key && old["dirty"] == true && old["text"] != doc["text"] {
                            // Two windows may contain different unsaved edits to the same
                            // file. Keep the older edit as a draft rather than dropping it.
                            if let Some(object) = old.as_object_mut() {
                                object.remove("path");
                                object.insert(
                                    "name".into(),
                                    json!(format!(
                                        "{} (recovered copy)",
                                        object
                                            .get("name")
                                            .and_then(Value::as_str)
                                            .unwrap_or("Note")
                                    )),
                                );
                            }
                        }
                    }
                    documents.retain(|old| {
                        key != old
                            .get("path")
                            .or_else(|| old.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_lowercase()
                    });
                }
                documents.push(doc.clone());
            }
            claimed.push((path, lock_path, guard));
        }
        Value::Array(documents)
    }

    pub(crate) fn write(&self, documents: &Value) -> Result<()> {
        atomic_write(
            &self.path,
            &serde_json::to_vec(documents).map_err(|error| error.to_string())?,
        )?;
        // Retire old snapshots only once their contents are safely in this window.
        for (path, lock_path, guard) in self.claimed.lock().unwrap().drain(..) {
            let _ = fs::remove_file(path);
            drop(guard);
            let _ = fs::remove_file(lock_path);
        }
        Ok(())
    }
}

impl Drop for Recovery {
    fn drop(&mut self) {
        drop(self.lock.take());
        let _ = fs::remove_file(self.path.with_extension("lock"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn live_windows_keep_independent_snapshots_and_closed_windows_restore() {
        let dir = tempfile::tempdir().unwrap();
        let first = Recovery::new(dir.path()).unwrap();
        first
            .write(&json!([{ "id": "first", "text": "unsaved first" }]))
            .unwrap();
        let second = Recovery::new(dir.path()).unwrap();
        assert_eq!(second.read(), json!([]));
        second
            .write(&json!([{ "id": "second", "text": "unsaved second" }]))
            .unwrap();
        drop(first);
        let third = Recovery::new(dir.path()).unwrap();
        assert_eq!(third.read()[0]["text"], "unsaved first");
        third
            .write(&json!([{ "id": "first", "text": "restored first" }]))
            .unwrap();
        drop(second);
        drop(third);
        let fourth = Recovery::new(dir.path()).unwrap();
        let restored = fourth.read();
        assert_eq!(restored.as_array().unwrap().len(), 2);
        assert!(restored
            .as_array()
            .unwrap()
            .iter()
            .any(|doc| doc["text"] == "unsaved second"));
        fourth.write(&restored).unwrap();
        assert_eq!(
            fs::read_dir(dir.path().join("sessions"))
                .unwrap()
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                .count(),
            1
        );
    }
    #[test]
    fn different_unsaved_versions_of_one_file_are_both_restored_and_legacy_data_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let first = Recovery::new(dir.path()).unwrap();
        first.write(&json!([{ "id": "first", "path": "C:\\Notes\\one.md", "name": "one.md", "text": "first edits", "dirty": true }])).unwrap();
        drop(first);
        fs::write(dir.path().join("recovery.json"), serde_json::to_vec(&json!([{ "id": "second", "path": "C:\\Notes\\one.md", "name": "one.md", "text": "second edits", "dirty": true }])).unwrap()).unwrap();
        let restored = Recovery::new(dir.path()).unwrap();
        let docs = restored.read();
        assert_eq!(docs.as_array().unwrap().len(), 2);
        assert_eq!(docs[0]["text"], "first edits");
        assert!(docs[0].get("path").is_none());
        assert_eq!(docs[1]["text"], "second edits");
        assert_eq!(docs[1]["path"], "C:\\Notes\\one.md");
        assert!(dir.path().join("recovery.json").is_file());
        restored.write(&docs).unwrap();
        assert!(!dir.path().join("recovery.json").exists());
    }
}
