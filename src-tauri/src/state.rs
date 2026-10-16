use crate::{
    layout::Rect,
    ports,
    store::{read_json, FoodStore},
    usage::{Claude, Usage},
};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
pub struct Settings {
    pub appearance: Value,
    pub modules: Value,
    pub appearance_warning: Value,
    pub module_warning: Value,
    pub revision: u64,
    pub epochs: [u64; 2],
}
impl Settings {
    pub fn new(root: &std::path::Path) -> Self {
        let mut s = Self {
            appearance: json!({"ground":true,"menuSide":"left","character":"cat-cheese"}),
            modules: json!({"m01":true,"m02":true}),
            appearance_warning: Value::Null,
            module_warning: Value::Null,
            revision: 0,
            epochs: [0, 0],
        };
        for key in ["appearance", "modules"] {
            let file = root.join(format!("{key}.json"));
            if !file.exists() {
                continue;
            }
            let field = if key == "appearance" {
                "preferences"
            } else {
                "modules"
            };
            let value = read_json(&file, 16384).unwrap_or(Value::Null);
            let valid = value["version"] == 1
                && if key == "appearance" {
                    ["ground", "menuSide", "character"]
                        .iter()
                        .all(|k| valid_appearance(k, &value[field][k]))
                } else {
                    ["m01", "m02"].iter().all(|k| value[field][k].is_boolean())
                };
            if valid {
                if key == "appearance" {
                    s.appearance = value[field].clone();
                } else {
                    s.modules = value[field].clone();
                }
            } else if key == "appearance" {
                s.appearance_warning = json!("화면 설정을 읽지 못해 기본값으로 시작했어요.");
            } else {
                s.module_warning = json!("모듈 설정을 읽지 못해 기본값으로 시작했어요.");
            }
        }
        s
    }
    pub fn appearance_state(&self) -> Value {
        json!({"preferences":self.appearance,"warning":self.appearance_warning,"revision":self.revision})
    }
    pub fn modules_state(&self) -> Value {
        json!({"modules":self.modules,"warning":self.module_warning,"revision":self.revision,"epochs":{"m01":self.epochs[0],"m02":self.epochs[1]}})
    }
}
pub fn valid_appearance(key: &str, value: &Value) -> bool {
    match key {
        "ground" => value.is_boolean(),
        "menuSide" => matches!(value.as_str(), Some("left" | "right")),
        "character" => matches!(
            value.as_str(),
            Some(
                "cat-cheese"
                    | "cat-black"
                    | "cat-tuxedo"
                    | "dog-shiba"
                    | "dog-corgi"
                    | "dog-retriever"
            )
        ),
        _ => false,
    }
}
#[derive(Default)]
pub struct Ui {
    pub region: Value,
    pub dragging: Option<(f64, f64, Rect)>,
    pub context_menu: bool,
    pub panel_open: bool,
    pub panel_ready: bool,
    pub pending_view: Option<String>,
    pub visible: bool,
    pub ignoring: Option<bool>,
}
pub struct State {
    pub root: PathBuf,
    pub custom_profile: bool,
    pub settings: Mutex<Settings>,
    pub food: Mutex<FoodStore>,
    pub ui: Mutex<Ui>,
    pub usage: Mutex<Usage>,
    pub claude: Claude,
    pub ports: Mutex<ports::Snapshot>,
    pub terminating: AtomicBool,
    pub stopped: AtomicBool,
}
impl State {
    pub fn new(root: PathBuf, custom_profile: bool) -> Self {
        Self {
            settings: Mutex::new(Settings::new(&root)),
            food: Mutex::new(FoodStore::new(root.join("food"))),
            usage: Mutex::new(Usage::new(&root)),
            claude: Claude::new(&root),
            root,
            custom_profile,
            ui: Mutex::new(Ui {
                visible: true,
                ..Default::default()
            }),
            ports: Mutex::new(ports::Snapshot::empty()),
            terminating: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
        }
    }
    pub fn active(&self, key: &str, epoch: u64) -> bool {
        let s = self.settings.lock().unwrap();
        !self.stopped.load(Ordering::Relaxed)
            && s.modules[key] == true
            && s.epochs[if key == "m01" { 0 } else { 1 }] == epoch
    }
}
