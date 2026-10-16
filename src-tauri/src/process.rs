//! Bounded subprocesses. Only callers choose executables; renderer input is never a shell program.
use crate::store::Result;
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
pub struct Output {
    pub success: bool,
    pub stdout: Vec<u8>,
}
pub fn run(
    command: &mut Command,
    input: Option<Vec<u8>>,
    timeout: Duration,
    limit: usize,
) -> Result<Output> {
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|e| format!("명령을 실행하지 못했어요: {e}"))?;
    if let Some(bytes) = input {
        let mut stdin = child.stdin.take().unwrap();
        thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        });
    }
    let mut stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .by_ref()
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes);
        let _ = tx.send(result.map(|_| bytes));
    });
    let deadline = Instant::now() + timeout;
    let mut data = None;
    let result = loop {
        if let Ok(value) = rx.try_recv() {
            match value {
                Ok(bytes) if bytes.len() <= limit => data = Some(bytes),
                _ => break Err("명령 출력이 너무 커요.".into()),
            }
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if let Some(stdout) = data.take() {
                break Ok(Output {
                    success: status.success(),
                    stdout,
                });
            }
        }
        if Instant::now() >= deadline {
            break Err("요청 시간이 초과됐어요.".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}
pub fn text(command: &mut Command) -> Result<String> {
    let o = run(command, None, Duration::from_secs(5), 2 * 1024 * 1024)?;
    if !o.success {
        return Err("명령을 완료하지 못했어요.".into());
    }
    String::from_utf8(o.stdout).map_err(|_| "명령 응답을 읽지 못했어요.".into())
}
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subprocess_limits_and_timeout_are_enforced() {
        assert!(run(
            Command::new("/bin/sh").args(["-c", "while :; do printf 0123456789; done"]),
            None,
            Duration::from_secs(1),
            128
        )
        .is_err());
        let start = Instant::now();
        assert!(run(
            Command::new("/bin/sleep").arg("5"),
            None,
            Duration::from_millis(50),
            128
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        let output = run(
            &mut Command::new("/bin/cat"),
            Some("원문\n".as_bytes().to_vec()),
            Duration::from_secs(1),
            128,
        )
        .unwrap();
        assert!(output.success);
        assert_eq!(output.stdout, "원문\n".as_bytes());
    }
}
