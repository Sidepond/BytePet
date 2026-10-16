use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const TEXT_LIMIT: usize = 1024 * 1024;
pub const FILE_LIMIT: usize = 25 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;
fn io(error: impl std::fmt::Display) -> String {
    format!("저장소에 접근할 수 없어요: {error}")
}
pub fn private_dir(path: &Path) -> Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true).mode(0o700);
    builder.create(path).map_err(io)
}
pub fn write_json(file: &Path, value: &Value) -> Result<()> {
    private_dir(file.parent().ok_or("잘못된 저장 경로")?)?;
    let temporary = file.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let operation = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options.open(&temporary).map_err(io)?;
        output
            .write_all(serde_json::to_string(value).map_err(io)?.as_bytes())
            .map_err(io)?;
        output.sync_all().map_err(io)?;
        fs::rename(&temporary, file).map_err(io)
    })();
    let _ = fs::remove_file(temporary);
    operation
}
pub fn read_json(file: &Path, limit: u64) -> Result<Value> {
    if !fs::symlink_metadata(file).map_err(io)?.is_file() {
        return Err("일반 설정 파일만 읽을 수 있어요.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(file)
        .map_err(io)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io)?;
    if bytes.len() as u64 > limit {
        return Err("설정 파일이 너무 커요.".into());
    }
    serde_json::from_slice(&bytes).map_err(io)
}
fn name(value: &str) -> String {
    let base = value.rsplit('/').next().unwrap_or("file");
    let value: String = base
        .chars()
        .take(160)
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    if value.is_empty() || value == "." || value == ".." {
        "file".into()
    } else {
        value
    }
}
pub struct FoodStore {
    pub root: PathBuf,
}
impl FoodStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn folder(&self, id: &str, trash: bool) -> Result<PathBuf> {
        if Uuid::parse_str(id)
            .map_err(|_| "저장된 항목을 찾을 수 없어요.")?
            .to_string()
            != id
        {
            return Err("잘못된 항목 ID".into());
        }
        let root = self.root.canonicalize().map_err(io)?;
        let folder = if trash {
            root.join(".trash").join(id)
        } else {
            root.join(id)
        };
        if folder.canonicalize().map_err(io)? != folder
            || !fs::symlink_metadata(&folder).map_err(io)?.is_dir()
        {
            return Err("보관함 외부 경로는 열 수 없어요.".into());
        }
        Ok(folder)
    }
    pub fn get(&self, id: &str, trash: bool) -> Result<(Value, PathBuf)> {
        let folder = self.folder(id, trash)?;
        let item = read_json(&folder.join("meta.json"), 16384)?;
        let filename = item["filename"].as_str().ok_or("잘못된 파일 이름")?;
        if item["id"] != id
            || !matches!(item["kind"].as_str(), Some("text" | "file"))
            || item["name"].as_str().is_none()
            || filename != name(filename)
            || item["size"].as_u64().is_none()
            || chrono::DateTime::parse_from_rfc3339(item["createdAt"].as_str().unwrap_or(""))
                .is_err()
        {
            return Err("보관함 항목을 읽을 수 없어요.".into());
        }
        let file = folder.join("content").join(filename);
        if !fs::symlink_metadata(&file).map_err(io)?.is_file()
            || !file.canonicalize().map_err(io)?.starts_with(&folder)
        {
            return Err("저장된 파일을 찾을 수 없어요.".into());
        }
        Ok((item, file))
    }
    fn save(&self, kind: &str, title: &str, bytes: &[u8], preview: &str) -> Result<Value> {
        private_dir(&self.root)?;
        let id = Uuid::new_v4().to_string();
        let folder = self.root.join(format!(".pending-{id}"));
        private_dir(&folder)?;
        let result = (|| {
            private_dir(&folder.join("content"))?;
            let filename = if kind == "text" {
                "text.txt".into()
            } else {
                name(title)
            };
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options
                .open(folder.join("content").join(&filename))
                .map_err(io)?
                .write_all(bytes)
                .map_err(io)?;
            let item = json!({"id":id,"kind":kind,"name":title,"filename":filename,"size":bytes.len(),"createdAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"preview":preview});
            write_json(&folder.join("meta.json"), &item)?;
            fs::rename(&folder, self.root.join(&id)).map_err(io)?;
            Ok(item)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(folder);
        }
        result
    }
    pub fn save_text(&self, text: &str) -> Result<Value> {
        if text.trim().is_empty() {
            return Err("먹일 텍스트를 입력해 주세요.".into());
        }
        if text.len() > TEXT_LIMIT {
            return Err("텍스트는 1MB까지 저장할 수 있어요.".into());
        }
        self.save(
            "text",
            &text
                .trim()
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(60)
                .collect::<String>(),
            text.as_bytes(),
            &text.chars().take(160).collect::<String>(),
        )
    }
    pub fn save_bytes(&self, title: &str, bytes: &[u8]) -> Result<Value> {
        if title.is_empty() || title.len() > 4096 {
            return Err("파일 이름을 확인해 주세요.".into());
        }
        if bytes.len() > FILE_LIMIT {
            return Err("파일은 개당 25MB까지 저장할 수 있어요.".into());
        }
        self.save("file", title, bytes, "")
    }
    pub fn save_file(&self, source: &Value) -> Result<Value> {
        let title = source["name"]
            .as_str()
            .filter(|n| !n.is_empty() && n.len() <= 4096)
            .ok_or("파일 이름을 확인해 주세요.")?;
        if source["oversized"] == true {
            return Err("파일은 개당 25MB까지 저장할 수 있어요.".into());
        }
        let encoded = source["base64"].as_str().ok_or("파일을 읽을 수 없어요.")?;
        if encoded.len() > FILE_LIMIT.div_ceil(3) * 4 {
            return Err("파일은 개당 25MB까지 저장할 수 있어요.".into());
        }
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "파일을 읽을 수 없어요.")?;
        if bytes.len() > FILE_LIMIT {
            return Err("파일은 개당 25MB까지 저장할 수 있어요.".into());
        }
        self.save("file", title, &bytes, "")
    }
    pub fn list(&self, query: &str, trash: bool) -> Result<Value> {
        if query.chars().count() > 200 {
            return Err("검색어는 200자까지 입력할 수 있어요.".into());
        }
        let search = query.trim().nfc().collect::<String>().to_lowercase();
        let directory = if trash {
            self.root.join(".trash")
        } else {
            self.root.clone()
        };
        let entries = match fs::read_dir(directory) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(json!([])),
            Err(e) => return Err(io(e)),
        };
        let mut items = Vec::new();
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().into_owned();
            if let Ok((item, _)) = self.get(&id, trash) {
                let title = item["name"]
                    .as_str()
                    .unwrap_or("")
                    .nfc()
                    .collect::<String>()
                    .to_lowercase();
                let matches = search.is_empty()
                    || title.contains(&search)
                    || (item["kind"] == "text"
                        && self
                            .read_text(&id, trash)
                            .unwrap_or_default()
                            .nfc()
                            .collect::<String>()
                            .to_lowercase()
                            .contains(&search));
                if matches {
                    items.push(item);
                }
            }
        }
        items.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
        Ok(json!(items))
    }
    pub fn read_text(&self, id: &str, trash: bool) -> Result<String> {
        let (item, file) = self.get(id, trash)?;
        if item["kind"] != "text" {
            return Err("텍스트 항목만 불러올 수 있어요.".into());
        }
        let mut data = Vec::new();
        fs::File::open(file)
            .map_err(io)?
            .take((TEXT_LIMIT + 1) as u64)
            .read_to_end(&mut data)
            .map_err(io)?;
        if data.len() > TEXT_LIMIT {
            return Err("텍스트가 너무 커요.".into());
        }
        String::from_utf8(data).map_err(io)
    }
    pub fn rename(&self, id: &str, title: &str) -> Result<Value> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 160 || title.chars().any(char::is_control) {
            return Err("이름은 1~160자로 입력해 주세요.".into());
        }
        let (mut item, _) = self.get(id, false)?;
        item["name"] = json!(title);
        write_json(&self.folder(id, false)?.join("meta.json"), &item)?;
        Ok(item)
    }
    pub fn move_item(&self, id: &str, restore: bool) -> Result<Value> {
        let (item, _) = self.get(id, restore)?;
        let trash = self.root.join(".trash");
        private_dir(&trash)?;
        if fs::symlink_metadata(&trash)
            .map_err(io)?
            .file_type()
            .is_symlink()
        {
            return Err("휴지통 경로가 올바르지 않아요.".into());
        }
        let source = self.folder(id, restore)?;
        let destination = if restore {
            self.root.join(id)
        } else {
            trash.join(id)
        };
        if destination.exists() {
            return Err("같은 항목이 이미 있어요.".into());
        }
        fs::rename(source, destination).map_err(io)?;
        Ok(item)
    }
    fn native_thumbnail(&self, file: &Path, size: u32) -> Result<Value> {
        let extension = file
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["heic", "heif", "avif", "bmp", "tif", "tiff"].contains(&extension.as_str()) {
            return Ok(Value::Null);
        }
        let directory = std::env::temp_dir().join(format!("bytepet-thumbnail-{}", Uuid::new_v4()));
        private_dir(&directory)?;
        let output = directory.join("thumbnail.png");
        let result = (|| {
            let result = crate::process::run(
                std::process::Command::new("/usr/bin/sips")
                    .args([
                        "-s",
                        "format",
                        "png",
                        "--resampleHeightWidthMax",
                        &size.to_string(),
                    ])
                    .arg(file)
                    .arg("--out")
                    .arg(&output),
                None,
                std::time::Duration::from_secs(5),
                16384,
            )?;
            if !result.success || fs::metadata(&output).map_err(io)?.len() > 3 * 1024 * 1024 {
                return Ok(Value::Null);
            }
            let bytes = fs::read(&output).map_err(io)?;
            Ok(json!(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(bytes)
            )))
        })();
        let _ = fs::remove_dir_all(directory);
        result
    }
    pub fn thumbnail(&self, id: &str, trash: bool, size: u32) -> Result<Value> {
        let (item, file) = self.get(id, trash)?;
        if item["kind"] != "file" || fs::metadata(&file).map_err(io)?.len() > FILE_LIMIT as u64 {
            return Ok(Value::Null);
        }
        let mut reader = match image::ImageReader::open(&file) {
            Ok(r) => r,
            Err(_) => return Ok(Value::Null),
        };
        reader = match reader.with_guessed_format() {
            Ok(r) => r,
            Err(_) => return Ok(Value::Null),
        };
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(64 * 1024 * 1024);
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        reader.limits(limits);
        let image = match reader.decode() {
            Ok(i) => i,
            Err(_) => return self.native_thumbnail(&file, size),
        };
        let mut output = Cursor::new(Vec::new());
        image
            .thumbnail(size, size)
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(io)?;
        if output.get_ref().len() > 3 * 1024 * 1024 {
            return Ok(Value::Null);
        }
        Ok(json!(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(output.into_inner())
        )))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_text_files_search_and_trash() {
        let d = tempfile::tempdir().unwrap();
        let store = FoodStore::new(d.path().join("food"));
        let t = store.save_text("메모\n검색할 본문").unwrap();
        let id = t["id"].as_str().unwrap();
        assert_eq!(store.read_text(id, false).unwrap(), "메모\n검색할 본문");
        assert_eq!(
            store.list("본문", false).unwrap().as_array().unwrap().len(),
            1
        );
        store.rename(id, "새 이름").unwrap();
        store.move_item(id, false).unwrap();
        assert_eq!(store.list("", false).unwrap(), json!([]));
        store.move_item(id, true).unwrap();
        assert_eq!(store.get(id, false).unwrap().0["name"], "새 이름");
        let f = store
            .save_file(&json!({"name":"test.bin","base64":STANDARD.encode([0,255,1,42])}))
            .unwrap();
        assert_eq!(
            fs::read(store.get(f["id"].as_str().unwrap(), false).unwrap().1).unwrap(),
            [0, 255, 1, 42]
        );
    }
    #[test]
    fn rejects_escape_and_limits() {
        let d = tempfile::tempdir().unwrap();
        let store = FoodStore::new(d.path().join("food"));
        assert!(store.save_text("").is_err());
        assert!(store.save_text(&"x".repeat(TEXT_LIMIT + 1)).is_err());
        assert!(store.get("../outside", false).is_err());
        let t = store.save_text("safe").unwrap();
        let id = t["id"].as_str().unwrap();
        let file = store.get(id, false).unwrap().1;
        fs::remove_file(&file).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hosts", file).unwrap();
            assert!(store.get(id, false).is_err());
        }
    }
}
