//! Explicit, copy-only import. Source profile is never changed; target must be empty.
use crate::store::{self, FoodStore, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};
pub fn import(source: &Path, target: &Path) -> Result<Value> {
    let source = source
        .canonicalize()
        .map_err(|_| "기존 BytePet 보관함 경로를 확인해 주세요.")?;
    if !source.is_dir()
        || target.exists()
            && fs::read_dir(target)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
    {
        return Err(
            "비어 있는 새 저장 폴더에만 가져올 수 있어요. 기존 폴더는 덮어쓰지 않습니다.".into(),
        );
    }
    let parent = target.parent().ok_or("잘못된 저장 경로")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let pending = parent.join(format!(".bytepet-import-{}", uuid::Uuid::new_v4()));
    store::private_dir(&pending)?;
    let operation = (|| {
        for name in [
            "appearance.json",
            "modules.json",
            "pet-position.json",
            "ai-usage.json",
        ] {
            let file = source.join(name);
            if file.exists() {
                let value = store::read_json(&file, 16384)?;
                store::write_json(&pending.join(name), &value)?;
            }
        }
        let food = FoodStore::new(source.join("food"));
        let mut count = 0;
        for trash in [false, true] {
            let folder = if trash {
                food.root.join(".trash")
            } else {
                food.root.clone()
            };
            if !folder.exists() {
                continue;
            }
            if fs::symlink_metadata(&folder)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("바로가기 보관함은 가져올 수 없어요.".into());
            }
            for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let id = entry.file_name().to_string_lossy().into_owned();
                if id.starts_with('.') {
                    continue;
                }
                let (item, file) = food.get(&id, trash)?;
                let limit = if item["kind"] == "text" {
                    store::TEXT_LIMIT
                } else {
                    store::FILE_LIMIT
                };
                if fs::metadata(&file).map_err(|e| e.to_string())?.len() > limit as u64 {
                    return Err("용량 제한을 넘는 보관함 항목이 있어 가져오기를 중단했어요.".into());
                }
                let dest = if trash {
                    pending.join("food/.trash").join(&id)
                } else {
                    pending.join("food").join(&id)
                };
                store::private_dir(&dest.join("content"))?;
                fs::copy(
                    file,
                    dest.join("content")
                        .join(item["filename"].as_str().unwrap()),
                )
                .map_err(|e| e.to_string())?;
                store::write_json(&dest.join("meta.json"), &item)?;
                count += 1;
            }
        }
        store::write_json(
            &pending.join("import.json"),
            &json!({"version":1,"importedAt":chrono::Utc::now().to_rfc3339(),"items":count}),
        )?;
        if target.exists() {
            fs::remove_dir(target).map_err(|e| e.to_string())?;
        }
        fs::rename(&pending, target).map_err(|e| e.to_string())?;
        Ok(
            json!({"items":count,"message":"기존 설정과 보관함을 새 폴더로 복사했어요. Claude 연결은 별도로 설정해 주세요."}),
        )
    })();
    if operation.is_err() {
        let _ = fs::remove_dir_all(pending);
    }
    operation
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_original_and_trash_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("electron");
        let target = dir.path().join("tauri");
        let food = FoodStore::new(source.join("food"));
        let item = food.save_text("exact\n한글").unwrap();
        let id = item["id"].as_str().unwrap();
        food.move_item(id, false).unwrap();
        assert_eq!(import(&source, &target).unwrap()["items"], 1);
        assert_eq!(
            FoodStore::new(target.join("food"))
                .read_text(id, true)
                .unwrap(),
            "exact\n한글"
        );
        assert_eq!(food.read_text(id, true).unwrap(), "exact\n한글");
        assert!(import(&source, &target).is_err());
    }
}
