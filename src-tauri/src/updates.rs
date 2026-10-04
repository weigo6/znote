use super::*;
use semver::Version;

const RELEASE_API: &str = "https://api.github.com/repos/weigo6/znote/releases/latest";
const RELEASES: &str = "https://github.com/weigo6/znote/releases";

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    draft: bool,
    prerelease: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheck {
    current_version: String,
    latest_version: Option<String>,
    available: bool,
    published: bool,
    title: String,
    notes: String,
    url: String,
}

fn compare(release: Release, current: &str) -> Result<UpdateCheck> {
    let latest =
        Version::parse(release.tag_name.trim_start_matches('v')).map_err(|_| "发布版本号无效")?;
    let installed = Version::parse(current).map_err(|_| "当前版本号无效")?;
    // The download button only opens this project's GitHub releases.
    if !release.html_url.starts_with(&format!("{RELEASES}/tag/")) {
        return Err("发布链接无效".into());
    }
    Ok(UpdateCheck {
        current_version: current.into(),
        latest_version: Some(latest.to_string()),
        available: !release.draft
            && !release.prerelease
            && latest.pre.is_empty()
            && latest > installed,
        published: true,
        title: release.name.unwrap_or(release.tag_name),
        notes: release.body.unwrap_or_default(),
        url: release.html_url,
    })
}

#[tauri::command]
pub(crate) async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateCheck> {
    let current = app.package_info().version.to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(format!("ZNote/{current}"))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("无法连接 GitHub：{error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateCheck {
            current_version: current,
            latest_version: None,
            available: false,
            published: false,
            title: String::new(),
            notes: String::new(),
            url: RELEASES.into(),
        });
    }
    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub 请求受限，请稍后重试或直接访问下载页。".into());
    }
    let release = response
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Release>()
        .await
        .map_err(|error| format!("更新信息无效：{error}"))?;
    compare(release, &current)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(version: &str) -> Release {
        Release {
            tag_name: version.into(),
            name: None,
            body: Some("notes".into()),
            html_url: format!("{RELEASES}/tag/{version}"),
            draft: false,
            prerelease: false,
        }
    }
    #[test]
    fn versions_compare_semantically_and_only_stable_updates_are_offered() {
        assert!(compare(release("v0.10.0"), "0.9.0").unwrap().available);
        assert!(!compare(release("v0.5.1"), "0.5.1").unwrap().available);
        assert!(!compare(release("v0.4.0"), "0.5.1").unwrap().available);
        assert!(
            !compare(release("v0.6.0-beta.1"), "0.5.1")
                .unwrap()
                .available
        );
        let mut draft = release("v0.6.0");
        draft.draft = true;
        assert!(!compare(draft, "0.5.1").unwrap().available);
        assert!(compare(release("release-latest"), "0.5.1").is_err());
        let mut invalid = release("v0.6.0");
        invalid.html_url = "https://example.com".into();
        assert!(compare(invalid, "0.5.1").is_err());
    }
}
