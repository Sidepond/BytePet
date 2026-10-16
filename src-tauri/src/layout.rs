use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub fn clamp(self, area: Self) -> Self {
        let width = self.width.min(area.width);
        let height = self.height.min(area.height);
        Self {
            x: self.x.clamp(area.x, area.x + area.width - width),
            y: self.y.clamp(area.y, area.y + area.height - height),
            width,
            height,
        }
    }
}
pub fn initial(area: Rect, ground: bool) -> Rect {
    let width = if ground { 496.0f64 } else { 128.0 }.min(area.width);
    let height = 128.0f64.min(area.height);
    Rect {
        x: area.x + (area.width - width - 24.0).max(0.0),
        y: area.y + (area.height - height - 24.0).max(0.0),
        width,
        height,
    }
}
pub fn nearest(rect: Rect, areas: &[Rect]) -> Rect {
    *areas
        .iter()
        .min_by(|a, b| {
            let distance = |area: Rect| {
                let r = rect.clamp(area);
                (r.x - rect.x).powi(2) + (r.y - rect.y).powi(2)
            };
            distance(**a).total_cmp(&distance(**b))
        })
        .expect("at least one monitor")
}
fn panel_width(pet: Rect, area: Rect, ground: bool) -> f64 {
    360.0f64.min(
        if ground {
            pet.width - 128.0
        } else {
            area.width - pet.width - 8.0
        }
        .max(1.0),
    )
}
pub fn yard_for_panel(pet: Rect, area: Rect, ground: bool, left: bool) -> Rect {
    let mut pet = pet.clamp(area);
    let h = 588.0f64.min((area.height - 10.0).max(1.0));
    if !ground {
        let space = panel_width(pet, area, ground) + 8.0;
        pet.x = if left {
            pet.x.max(area.x + space)
        } else {
            pet.x.min(area.x + area.width - pet.width - space)
        };
    }
    pet.y = pet
        .y
        .max((area.y + h - (pet.height - 10.0)).min(area.y + area.height - pet.height));
    pet
}
pub fn panel(pet: Rect, area: Rect, ground: bool, left: bool) -> Rect {
    let width = panel_width(pet, area, ground);
    let bottom = pet.y + pet.height - 10.0;
    let height = 588.0f64.min((bottom - area.y).max(1.0));
    let x = if ground {
        if left {
            pet.x
        } else {
            pet.x + pet.width - width
        }
    } else if left {
        pet.x - width - 8.0
    } else {
        pet.x + pet.width + 8.0
    };
    Rect {
        x,
        y: bottom - height,
        width,
        height,
    }
}
pub fn badge(
    pet: Rect,
    area: Rect,
    ground: bool,
    left: bool,
    position: &str,
    rows: usize,
    region: &Value,
) -> Rect {
    let center = if ground && left {
        pet.width - 64.0
    } else {
        64.0
    };
    let mut character = Rect {
        x: pet.x + (center - 56.0).clamp(0.0, (pet.width - 112.0).max(0.0)),
        y: pet.y + pet.height - 125.0,
        width: 112.0,
        height: 112.0,
    };
    if position == "ground" {
        let width = 120.0f64.min(pet.width - 16.0).min(area.width).max(1.0);
        let height = if rows == 1 { 16.0 } else { 24.0 };
        return Rect {
            x: (character.x + (112.0 - width) / 2.0)
                .clamp(pet.x + 8.0, pet.x + pet.width - 8.0 - width),
            y: pet.y + pet.height - 12.0 - height / 2.0,
            width,
            height,
        }
        .clamp(area);
    }
    if let (Some(y), Some(height), Some(top), Some(bottom)) = (
        region["y"].as_f64(),
        region["height"].as_f64(),
        region["anchor"]["top"].as_f64(),
        region["anchor"]["bottom"].as_f64(),
    ) {
        character.y = pet.y + y + top * height;
        character.height = (bottom - top) * height;
    }
    let width = 140.0f64.min(area.width);
    let height = if rows == 1 { 26.0 } else { 40.0 };
    let mut candidates = Vec::new();
    for side in [position, "top", "left", "right", "bottom"] {
        let (x, y) = match side {
            "left" => (
                character.x - width - 4.0,
                character.y + (character.height - height) / 2.0,
            ),
            "right" => (
                character.x + character.width + 4.0,
                character.y + (character.height - height) / 2.0,
            ),
            "bottom" => (
                character.x + (character.width - width) / 2.0,
                character.y + character.height + 4.0,
            ),
            _ => (
                character.x + (character.width - width) / 2.0,
                character.y - height - 4.0,
            ),
        };
        let r = Rect {
            x,
            y,
            width,
            height,
        };
        if r == r.clamp(area) {
            return r;
        }
        candidates.push(r.clamp(area));
    }
    candidates
        .into_iter()
        .min_by(|a, b| {
            let overlap = |r: &Rect| {
                ((r.x + r.width).min(character.x + character.width) - r.x.max(character.x)).max(0.0)
                    * ((r.y + r.height).min(character.y + character.height) - r.y.max(character.y))
                        .max(0.0)
            };
            overlap(a).total_cmp(&overlap(b))
        })
        .unwrap()
}
pub fn valid_region(r: &Value) -> bool {
    let f = |key: &str| r[key].as_f64().unwrap_or(f64::NAN);
    let (c, n) = (
        r["columns"].as_u64().unwrap_or(0),
        r["rows"].as_u64().unwrap_or(0),
    );
    f("x") >= 0.0
        && f("y") >= 0.0
        && f("width") > 0.0
        && f("height") > 0.0
        && f("width") <= 128.0
        && f("height") <= 128.0
        && f("x") + f("width") <= 496.0
        && f("y") + f("height") <= 128.0
        && c > 0
        && c <= 128
        && n > 0
        && n <= 128
        && r["alpha"].as_array().is_some_and(|a| {
            a.len() == (c * n) as usize && a.iter().all(|v| v.as_u64().is_some_and(|n| n <= 255))
        })
        && (r["anchor"].is_null()
            || (r["anchor"]["top"].as_f64().is_some_and(|v| v >= 0.0)
                && r["anchor"]["bottom"]
                    .as_f64()
                    .is_some_and(|v| v <= 1.0 && v > r["anchor"]["top"].as_f64().unwrap_or(1.0))))
}
pub fn hit(r: &Value, x: f64, y: f64) -> bool {
    let Some(c) = r["columns"].as_u64() else {
        return false;
    };
    let Some(n) = r["rows"].as_u64() else {
        return false;
    };
    let col = ((x - r["x"].as_f64().unwrap_or(0.0)) * c as f64
        / r["width"].as_f64().unwrap_or(1.0))
    .floor();
    let row = ((y - r["y"].as_f64().unwrap_or(0.0)) * n as f64
        / r["height"].as_f64().unwrap_or(1.0))
    .floor();
    col >= 0.0
        && row >= 0.0
        && col < c as f64
        && row < n as f64
        && r["alpha"][(row as u64 * c + col as u64) as usize]
            .as_u64()
            .unwrap_or(0)
            > 0
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn panels_keep_height_and_badge_is_ground_anchored() {
        let area = Rect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 850.0,
        };
        let pet = yard_for_panel(initial(area, true), area, true, true);
        let p = panel(pet, area, true, true);
        assert_eq!(p.height, 588.0);
        assert_eq!(p.y + p.height, pet.y + pet.height - 10.0);
        let a = badge(pet, area, true, true, "ground", 2, &Value::Null);
        let b = badge(
            pet,
            area,
            true,
            true,
            "ground",
            2,
            &serde_json::json!({"y":20,"height":100,"anchor":{"top":0.4,"bottom":0.9}}),
        );
        assert_eq!(a, b);
    }
    #[test]
    fn clamps_removed_monitor() {
        let area = Rect {
            x: 0.0,
            y: 25.0,
            width: 1000.0,
            height: 700.0,
        };
        let p = Rect {
            x: 2500.0,
            y: -500.0,
            width: 496.0,
            height: 128.0,
        }
        .clamp(area);
        assert_eq!(p.x, 504.0);
        assert_eq!(p.y, 25.0);
    }
}
