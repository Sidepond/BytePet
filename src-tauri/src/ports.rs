use crate::{process, store::Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    net::IpAddr,
    process::Command,
    time::Duration,
};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Identity {
    pub pid: i32,
    pub uid: u32,
    pub started: String,
    pub state: String,
    pub command: String,
}
impl Identity {
    pub fn same(&self, b: &Self) -> bool {
        self.pid == b.pid
            && self.uid == b.uid
            && self.started == b.started
            && self.command == b.command
    }
    pub fn running(&self) -> bool {
        !self.state.starts_with('Z')
    }
    pub fn blocked(&self) -> Option<&'static str> {
        if !self.running() {
            Some("프로세스가 이미 종료됐어요.")
        } else if self.pid <= 1 || self.pid == std::process::id() as i32 {
            Some("BytePet 또는 보호된 프로세스는 종료할 수 없어요.")
        } else if self.uid != unsafe { libc::getuid() } {
            Some("다른 사용자의 프로세스는 종료할 수 없어요.")
        } else {
            None
        }
    }
}
pub fn parse_processes(s: &str) -> HashMap<i32, Identity> {
    s.lines()
        .filter_map(|line| {
            let p: Vec<_> = line.split_whitespace().collect();
            if p.len() < 9 {
                return None;
            }
            let pid = p[0].parse().ok()?;
            Some((
                pid,
                Identity {
                    pid,
                    uid: p[1].parse().ok()?,
                    started: p[2..7].join(" "),
                    state: p[7].into(),
                    command: p[8..].join(" "),
                },
            ))
        })
        .collect()
}
pub fn inspect(pid: Option<i32>) -> Result<HashMap<i32, Identity>> {
    let mut command = Command::new("/bin/ps");
    command.env("LC_ALL", "C");
    if let Some(pid) = pid {
        command.args([
            "-p",
            &pid.to_string(),
            "-o",
            "pid=,uid=,lstart=,stat=,comm=",
        ]);
    } else {
        command.args(["-axo", "pid=,uid=,lstart=,stat=,comm="]);
    }
    let out = process::run(&mut command, None, Duration::from_secs(2), 2 * 1024 * 1024)?;
    let text = String::from_utf8_lossy(&out.stdout);
    let map = parse_processes(&text);
    if !text.trim().is_empty() && map.is_empty() {
        return Err("프로세스 정보를 읽지 못했어요.".into());
    }
    Ok(map)
}
pub fn parse(s: &str) -> Vec<Value> {
    let (mut pid, mut name, mut family, mut protocol, mut address) = (
        0,
        String::new(),
        String::new(),
        String::new(),
        String::new(),
    );
    let mut entries: BTreeMap<(u16, i32), Value> = BTreeMap::new();
    fn finish(
        entries: &mut BTreeMap<(u16, i32), Value>,
        pid: i32,
        name: &str,
        family: &str,
        protocol: &str,
        socket: &str,
    ) {
        if pid < 1 || protocol != "TCP" || !matches!(family, "IPv4" | "IPv6") {
            return;
        }
        let Some((address, port)) = socket.rsplit_once(':') else {
            return;
        };
        let address = address.trim_start_matches('[').trim_end_matches(']');
        let Ok(port) = port.parse::<u16>() else {
            return;
        };
        if port == 0 || (address != "*" && address.parse::<IpAddr>().is_err()) {
            return;
        }
        let e = entries.entry((port, pid)).or_insert_with(
            || json!({"pid":pid,"port":port,"name":name,"protocol":"TCP","addresses":[]}),
        );
        let a = json!({"family":family,"address":address});
        if !e["addresses"].as_array().unwrap().contains(&a) {
            e["addresses"].as_array_mut().unwrap().push(a);
        }
    }
    for field in s.split('\0') {
        let field = field.trim_start_matches('\n');
        if field.is_empty() {
            continue;
        }
        let value = &field[1..];
        match &field[..1] {
            "p" => {
                finish(&mut entries, pid, &name, &family, &protocol, &address);
                pid = value.parse().unwrap_or(0);
                name.clear();
                family.clear();
                protocol.clear();
                address.clear();
            }
            "c" => name = value.into(),
            "f" => {
                finish(&mut entries, pid, &name, &family, &protocol, &address);
                family.clear();
                protocol.clear();
                address.clear();
            }
            "t" => family = value.into(),
            "P" => protocol = value.into(),
            "n" => address = value.into(),
            _ => {}
        }
    }
    finish(&mut entries, pid, &name, &family, &protocol, &address);
    entries.into_values().collect()
}
pub fn url(item: &Value) -> Option<String> {
    let port = item["port"].as_u64()?;
    if port == 0 || port > 65535 {
        return None;
    }
    let mut choices = Vec::new();
    for a in item["addresses"].as_array()? {
        let a = a["address"].as_str()?;
        let host = if matches!(a, "*" | "0.0.0.0") {
            "127.0.0.1"
        } else if a == "::" {
            "::1"
        } else {
            a
        };
        if let Ok(ip) = host.parse::<IpAddr>() {
            let rank = if ip.is_loopback() { 0 } else { 2 } + if ip.is_ipv4() { 0 } else { 1 };
            choices.push((
                rank,
                format!(
                    "http://{}:{port}",
                    if ip.is_ipv6() {
                        format!("[{host}]")
                    } else {
                        host.into()
                    }
                ),
            ));
        }
    }
    choices.sort();
    choices.into_iter().next().map(|x| x.1)
}
pub fn scan() -> Result<Vec<Value>> {
    let output = process::run(
        Command::new("/usr/sbin/lsof").env("LC_ALL", "C").args([
            "-nP",
            "-a",
            "-iTCP",
            "-sTCP:LISTEN",
            "+c",
            "0",
            "-F0pcfntP",
        ]),
        None,
        Duration::from_secs(5),
        2 * 1024 * 1024,
    )?;
    let s = String::from_utf8_lossy(&output.stdout);
    let items = parse(&s);
    if !s.trim().is_empty() && items.is_empty() {
        return Err("포트 조회 결과를 읽지 못했어요.".into());
    }
    Ok(items)
}
pub struct Snapshot {
    pub items: Vec<Value>,
    pub identities: HashMap<i32, Identity>,
}
impl Snapshot {
    pub fn empty() -> Self {
        Self {
            items: vec![],
            identities: HashMap::new(),
        }
    }
    pub fn load() -> Result<Self> {
        let mut items = scan()?;
        let identities = inspect(None).unwrap_or_default();
        for item in &mut items {
            let id = item["pid"].as_i64().unwrap() as i32;
            item["url"] = json!(url(item));
            item["terminationBlocked"] = json!(identities
                .get(&id)
                .map(|p| p.blocked())
                .unwrap_or(Some("프로세스 정보를 확인할 수 없어요.")));
        }
        Ok(Self { items, identities })
    }
    pub fn value(&self) -> Value {
        json!({"items":self.items,"warning":null,"checkedAt":chrono::Utc::now().to_rfc3339()})
    }
}
pub fn verify(identity: &Identity, port: u16) -> Result<bool> {
    let current = inspect(Some(identity.pid))?;
    let Some(current) = current.get(&identity.pid).filter(|v| v.running()) else {
        return Ok(false);
    };
    if !current.same(identity) {
        return Err("프로세스가 바뀌었어요. 새로고침 후 다시 선택해 주세요.".into());
    }
    if let Some(reason) = current.blocked() {
        return Err(reason.into());
    }
    if !scan()?
        .iter()
        .any(|v| v["pid"] == identity.pid && v["port"] == port)
    {
        return Err("선택한 포트를 더 이상 확인할 수 없어요.".into());
    }
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_and_groups_listeners() {
        let items = parse(
            "p123\0cnode\0\nf4\0tIPv4\0PTCP\0n127.0.0.1:3000\0\nf5\0tIPv6\0PTCP\0n[::1]:3000\0",
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["addresses"].as_array().unwrap().len(), 2);
        assert_eq!(url(&items[0]), Some("http://127.0.0.1:3000".into()));
        assert!(parse("p3\0f4\0tIPv4\0PTCP\0nhttps://evil:3\0").is_empty());
    }
    #[test]
    fn identity_detects_pid_reuse() {
        let a = parse_processes(" 123 501 Thu Oct 15 12:30:00 2026 S /usr/bin/test app\n");
        let mut b = a[&123].clone();
        assert!(a[&123].same(&b));
        b.started = "later".into();
        assert!(!a[&123].same(&b));
    }
}
