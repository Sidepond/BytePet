use crate::{
    process,
    store::{read_json, write_json, Result},
};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub fn empty(status: &str, message: &str) -> Value {
    json!({"status":status,"message":message,"windows":[],"updatedAt":null})
}
pub fn window(id: &str, percent: &Value, seconds: &Value, minutes: &Value) -> Option<Value> {
    let p = percent.as_f64()?;
    let s = seconds.as_f64()?;
    if !(0.0..=100.0).contains(&p) || s <= 0.0 || s > 1e11 {
        return None;
    }
    Some(
        json!({"id":id,"usedPercent":p,"resetsAt":s*1000.0,"durationMinutes":minutes.as_f64().filter(|m|*m>0.0&&*m<1e7)}),
    )
}
pub fn codex_windows(result: &Value) -> Vec<Value> {
    let limits = if result["rateLimitsByLimitId"]["codex"].is_object() {
        &result["rateLimitsByLimitId"]["codex"]
    } else {
        &result["rateLimits"]
    };
    if !limits["limitId"].is_null() && limits["limitId"] != "codex" {
        return vec![];
    }
    ["primary", "secondary"]
        .into_iter()
        .filter_map(|id| {
            let v = &limits[id];
            let duration = v["windowDurationMins"].as_f64().unwrap_or(0.0);
            window(
                if duration >= 10080.0 {
                    "secondary"
                } else if duration > 0.0 {
                    "primary"
                } else {
                    id
                },
                &v["usedPercent"],
                &v["resetsAt"],
                &v["windowDurationMins"],
            )
        })
        .collect()
}
pub fn claude_windows(data: &Value) -> Vec<Value> {
    [
        ("primary", "five_hour", 300),
        ("secondary", "seven_day", 10080),
    ]
    .into_iter()
    .filter_map(|(id, key, minutes)| {
        let v = &data["rate_limits"][key];
        window(id, &v["used_percentage"], &v["resets_at"], &json!(minutes))
    })
    .collect()
}
pub fn valid(key: &str, v: &Value) -> bool {
    match key {
        "codex" | "claude" => v.is_boolean(),
        "badgeMode" => matches!(v.as_str(), Some("always" | "hidden")),
        "badgePosition" => matches!(v.as_str(), Some("ground" | "top" | "left" | "right")),
        "badgeWindow" => matches!(v.as_str(), Some("primary" | "secondary")),
        _ => false,
    }
}
pub struct Usage {
    pub preferences: Value,
    pub providers: Value,
    pub warning: Value,
    pub revision: u64,
    pub epoch: u64,
    pub active: bool,
    pub last_attempt: i64,
    pub connected: bool,
}
impl Usage {
    pub fn new(root: &Path) -> Self {
        let mut preferences = json!({"codex":true,"claude":true,"badgeMode":"always","badgePosition":"ground","badgeWindow":"primary"});
        let file = root.join("ai-usage.json");
        let mut warning = Value::Null;
        if file.exists() {
            match read_json(&file, 16384) {
                Ok(mut saved) => {
                    if saved["preferences"]["badgeMode"] == "hover" {
                        saved["preferences"]["badgeMode"] = json!("always");
                    }
                    if saved["version"] == 1 && saved["preferences"]["badgePosition"] == "top" {
                        saved["preferences"]["badgePosition"] = json!("ground");
                    }
                    if matches!(saved["version"].as_i64(), Some(1 | 2))
                        && preferences
                            .as_object()
                            .unwrap()
                            .keys()
                            .all(|k| valid(k, &saved["preferences"][k]))
                    {
                        preferences = saved["preferences"].clone();
                    } else {
                        warning = json!("AI 사용량 설정을 읽지 못해 기본값을 적용했어요.");
                    }
                }
                Err(_) => warning = json!("AI 사용량 설정을 읽지 못해 기본값을 적용했어요."),
            }
        }
        Self {
            preferences,
            providers: json!({"codex":empty("waiting","사용량을 확인하고 있어요."),"claude":empty("waiting","")}),
            warning,
            revision: 0,
            epoch: 0,
            active: false,
            last_attempt: 0,
            connected: false,
        }
    }
    pub fn state(&self) -> Value {
        json!({"preferences":self.preferences,"providers":self.providers,"warning":self.warning,"revision":self.revision,"claudeConnected":self.connected})
    }
    pub fn set(&mut self, root: &Path, key: &str, v: &Value) -> Result<()> {
        if !valid(key, v) {
            return Err("올바른 사용량 설정을 선택해 주세요.".into());
        }
        let mut next = self.preferences.clone();
        next[key] = v.clone();
        write_json(
            &root.join("ai-usage.json"),
            &json!({"version":2,"preferences":next}),
        )?;
        if key == "codex" && self.preferences[key] != *v {
            self.epoch += 1;
            self.active = false;
            self.last_attempt = 0;
            self.providers[key] = empty(if v == true { "waiting" } else { "disabled" }, "");
        }
        self.preferences = next;
        self.warning = Value::Null;
        self.revision += 1;
        Ok(())
    }
}
pub fn find_codex() -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    dirs.extend(
        [
            format!("{home}/.local/bin"),
            format!("{home}/.npm-global/bin"),
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            "/Applications/Codex.app/Contents/Resources".into(),
        ]
        .into_iter()
        .map(PathBuf::from),
    );
    dirs.into_iter()
        .filter(|p| p.is_absolute())
        .map(|p| p.join("codex"))
        .find(|p| {
            use std::os::unix::fs::PermissionsExt;
            p.metadata()
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
}
pub fn read_codex(executable: &Path, active: impl Fn() -> bool) -> Result<Value> {
    let mut child = Command::new(executable)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Codex CLI를 실행하지 못했어요.")?;
    let output = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(output.take(2 * 1024 * 1024 + 1));
        let mut total = 0;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    total += n;
                    if total > 2 * 1024 * 1024 {
                        break;
                    }
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let mut stdin = child.stdin.take().unwrap();
    let send = |stdin: &mut std::process::ChildStdin, v: Value| -> Result<()> {
        writeln!(stdin, "{v}").map_err(|_| "Codex 연결이 종료됐어요.".into())
    };
    let result = (|| {
        send(
            &mut stdin,
            json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"bytepet_usage","title":"BytePet usage","version":env!("CARGO_PKG_VERSION")}}}),
        )?;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline && active() {
            let line = match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(s) => s,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => {
                    return Err(
                        "Codex 응답을 받지 못했어요. CLI 로그인 상태를 확인해 주세요.".into(),
                    )
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&line).map_err(|_| "Codex 응답을 읽지 못했어요.")?;
            if !value["error"].is_null() {
                return Err("Codex 사용량을 조회하지 못했어요.".into());
            }
            match value["id"].as_i64() {
                Some(1) => {
                    send(&mut stdin, json!({"method":"initialized"}))?;
                    send(
                        &mut stdin,
                        json!({"id":2,"method":"account/read","params":{"refreshToken":false}}),
                    )?;
                }
                Some(2) => {
                    if value["result"]["account"]["type"] != "chatgpt" {
                        return Ok(empty(
                            "unavailable",
                            "Codex CLI에서 ChatGPT 계정으로 로그인해 주세요.",
                        ));
                    }
                    send(
                        &mut stdin,
                        json!({"id":3,"method":"account/rateLimits/read"}),
                    )?;
                }
                Some(3) => {
                    let windows = codex_windows(&value["result"]);
                    return Ok(if windows.is_empty() {
                        empty("unavailable", "이 계정에서 조회 가능한 구독 한도가 없어요.")
                    } else {
                        json!({"status":"ready","message":"","windows":windows,"updatedAt":now()})
                    });
                }
                _ => {}
            }
        }
        Err("Codex 조회를 취소했거나 응답 시간이 초과됐어요.".into())
    })();
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    result
}
#[derive(Clone)]
pub struct Claude {
    pub directory: PathBuf,
    pub snapshot: PathBuf,
}
impl Claude {
    pub fn new(root: &Path) -> Self {
        Self {
            directory: std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".claude")
                }),
            snapshot: root.join("claude-usage.json"),
        }
    }
    fn settings_file(&self) -> PathBuf {
        self.directory.join("settings.json")
    }
    pub fn config_file(&self) -> PathBuf {
        self.directory.join("bytepet-tauri-usage/config.json")
    }
    fn settings(&self) -> Result<Value> {
        let file = self.settings_file();
        if !file.exists() {
            return Ok(json!({}));
        }
        let v = read_json(&file, 1024 * 1024)?;
        if !v.is_object() {
            return Err("Claude 설정 형식을 확인해 주세요.".into());
        }
        Ok(v)
    }
    pub fn connected(&self) -> bool {
        let Ok(c) = read_json(&self.config_file(), 1024 * 1024) else {
            return false;
        };
        self.settings().is_ok_and(|s| {
            s["statusLine"]["command"] == c["installedCommand"]
                && c["snapshotPath"] == self.snapshot.to_string_lossy().as_ref()
                && c["executable"]
                    .as_str()
                    .is_some_and(|p| Path::new(p).is_file())
        })
    }
    pub fn connect(&self, enabled: bool) -> Result<()> {
        let mut settings = self.settings()?;
        let prior = if self.config_file().exists() {
            Some(read_json(&self.config_file(), 1024 * 1024)?)
        } else {
            None
        };
        if !enabled {
            let c = prior.ok_or("Claude 연결 기록이 없어요.")?;
            if settings["statusLine"]["command"] != c["installedCommand"]
                || c["snapshotPath"] != self.snapshot.to_string_lossy().as_ref()
            {
                return Err("Claude 상태줄이 다른 곳에서 변경되어 덮어쓰지 않았어요.".into());
            }
            if c["previousStatusLine"].is_null() {
                settings.as_object_mut().unwrap().remove("statusLine");
            } else {
                settings["statusLine"] = c["previousStatusLine"].clone();
            }
            write_json(&self.settings_file(), &settings)?;
            let _ = fs::remove_file(&self.snapshot);
            return Ok(());
        }
        let mut previous = settings["statusLine"].clone();
        if let Some(c) = &prior {
            if settings["statusLine"]["command"] == c["installedCommand"] {
                previous = c["previousStatusLine"].clone();
            } else if settings["statusLine"]["command"]
                .as_str()
                .is_some_and(|c| c.contains("--claude-statusline"))
            {
                return Err("기존 BytePet 연결 기록이 달라 Claude 설정을 유지했어요.".into());
            }
        }
        if !previous.is_null()
            && (previous["type"] != "command" || previous["command"].as_str().is_none())
        {
            return Err("현재 Claude 상태줄 형식을 지원하지 않아요.".into());
        }
        // Do not wrap another BytePet installation: the two independent restore records would conflict.
        if previous["command"]
            .as_str()
            .is_some_and(|s| s.contains("bytepet-usage") || s.contains("--claude-statusline"))
        {
            return Err("기존 BytePet에서 Claude 연결을 해제한 뒤 이 앱에서 연결해 주세요.".into());
        }
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let command = format!(
            "{} --claude-statusline {}",
            process::quote(&executable.to_string_lossy()),
            process::quote(&self.config_file().to_string_lossy())
        );
        let config = json!({"snapshotPath":self.snapshot,"previousStatusLine":previous,"installedCommand":command,"executable":executable});
        write_json(&self.config_file(), &config)?;
        let mut line = if previous.is_object() {
            previous
        } else {
            json!({})
        };
        line["type"] = json!("command");
        line["command"] = json!(command);
        settings["statusLine"] = line;
        if let Err(e) = write_json(&self.settings_file(), &settings) {
            if let Some(p) = prior {
                let _ = write_json(&self.config_file(), &p);
            } else {
                let _ = fs::remove_file(self.config_file());
            }
            return Err(e);
        }
        Ok(())
    }
    pub fn read(&self) -> Value {
        if !self.connected() {
            return empty("unavailable", "Claude Code 상태줄을 연결해 주세요.");
        }
        let saved = match read_json(&self.snapshot, 16384) {
            Ok(v) => v,
            Err(_) => {
                return empty(
                    if self.snapshot.exists() {
                        "error"
                    } else {
                        "waiting"
                    },
                    "Claude Code에서 응답을 받은 뒤 표시됩니다.",
                )
            }
        };
        let updated = saved["updatedAt"].as_i64().unwrap_or(0);
        if saved["version"] != 1
            || updated <= 0
            || updated > now() + 60000
            || !saved["windows"].is_array()
        {
            return empty("error", "Claude 사용량 기록을 읽지 못했어요.");
        }
        let windows: Vec<_> = ["primary", "secondary"]
            .into_iter()
            .filter_map(|id| {
                saved["windows"]
                    .as_array()?
                    .iter()
                    .find(|v| v["id"] == id)
                    .and_then(|v| {
                        window(
                            id,
                            &v["usedPercent"],
                            &json!(v["resetsAt"].as_f64().unwrap_or(0.0) / 1000.0),
                            &json!(if id == "primary" { 300 } else { 10080 }),
                        )
                    })
            })
            .collect();
        json!({"status":if windows.is_empty(){"unavailable"}else{"ready"},"message":if windows.is_empty(){"한도 데이터가 없어요. Pro·Max 로그인과 Claude Code 버전을 확인해 주세요."}else{""},"windows":windows,"updatedAt":updated})
    }
}
/// CLI mode runs before any GUI/runtime startup. Only normalized percentages are saved.
pub fn statusline(config_file: &Path) -> Result<()> {
    let config = read_json(config_file, 1024 * 1024)?;
    let mut input = Vec::new();
    std::io::stdin()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut input)
        .map_err(|e| e.to_string())?;
    if input.len() > 1024 * 1024 {
        return Err("status line input too large".into());
    }
    let data: Value = serde_json::from_slice(&input).map_err(|_| "invalid status line input")?;
    let windows = claude_windows(&data);
    let snapshot = Path::new(
        config["snapshotPath"]
            .as_str()
            .ok_or("missing snapshot path")?,
    );
    if !snapshot.is_absolute() {
        return Err("snapshot path must be absolute".into());
    }
    write_json(
        snapshot,
        &json!({"version":1,"updatedAt":now(),"windows":windows}),
    )?;
    if let Some(command) = config["previousStatusLine"]["command"].as_str() {
        let output = process::run(
            Command::new("/bin/sh")
                .arg("-c")
                .arg(command)
                .env_remove("ELECTRON_RUN_AS_NODE"),
            Some(input),
            Duration::from_secs(2),
            1024 * 1024,
        )?;
        std::io::stdout()
            .write_all(&output.stdout)
            .map_err(|e| e.to_string())?;
    } else {
        let text = windows
            .iter()
            .map(|w| {
                format!(
                    "{} {}%",
                    if w["id"] == "primary" { "5h" } else { "7d" },
                    w["usedPercent"].as_f64().unwrap_or(0.0).round()
                )
            })
            .collect::<Vec<_>>()
            .join(" · ");
        println!("{text}");
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_only_limits() {
        let data = json!({"rateLimits":{"primary":{"usedPercent":42,"resetsAt":1800000000,"windowDurationMins":10080}},"secret":"must not persist"});
        let windows = codex_windows(&data);
        assert_eq!(windows[0]["id"], "secondary");
        assert!(!serde_json::to_string(&windows).unwrap().contains("secret"));
        assert!(window("primary", &json!(101), &json!(100), &json!(300)).is_none());
    }
    #[test]
    fn claude_preserves_and_restores_settings() {
        let d = tempfile::tempdir().unwrap();
        let c = Claude {
            directory: d.path().join("claude"),
            snapshot: d.path().join("profile/claude-usage.json"),
        };
        let settings = json!({"theme":"dark","statusLine":{"type":"command","command":"printf hello","padding":2}});
        write_json(&c.settings_file(), &settings).unwrap();
        c.connect(true).unwrap();
        assert!(c.connected());
        c.connect(true).unwrap();
        c.connect(false).unwrap();
        assert_eq!(
            read_json(&c.settings_file(), 1024 * 1024).unwrap(),
            settings
        );
    }
    #[test]
    fn disconnect_does_not_overwrite_external_change() {
        let d = tempfile::tempdir().unwrap();
        let c = Claude {
            directory: d.path().join("claude"),
            snapshot: d.path().join("usage.json"),
        };
        c.connect(true).unwrap();
        write_json(
            &c.settings_file(),
            &json!({"statusLine":{"command":"external"}}),
        )
        .unwrap();
        assert!(c.connect(false).is_err());
        assert_eq!(c.settings().unwrap()["statusLine"]["command"], "external");
    }
}

#[cfg(test)]
mod codex_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn cli_protocol_reads_limits_without_retaining_account_data() {
        let d = tempfile::tempdir().unwrap();
        let executable = d.path().join("codex");
        fs::write(&executable,r##"#!/bin/sh
read -r request
printf '%s\n' '{"id":1,"result":{}}'
read -r notification
read -r request
printf '%s\n' '{"id":2,"result":{"account":{"type":"chatgpt","email":"private@example.invalid"}}}'
read -r request
printf '%s\n' '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":27,"resetsAt":1800000000,"windowDurationMins":300}}}}'
"##).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let result = read_codex(&executable, || true).unwrap();
        assert_eq!(result["status"], "ready");
        assert_eq!(result["windows"][0]["usedPercent"], 27.0);
        assert!(!result.to_string().contains("private"));
        assert!(read_codex(&executable, || false).is_err());
    }
}
