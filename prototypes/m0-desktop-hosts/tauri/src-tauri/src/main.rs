use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::{Value, json};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

fn http_status(url: &str) -> Result<u16, String> {
    let authority = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("unexpected readiness URL: {url}"))?;
    let mut stream = TcpStream::connect(authority).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| error.to_string())?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    response
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "HTTP response did not contain a status code".to_string())
}

fn request_stop(child: &mut Option<CommandChild>, pid: u32, force: bool) -> Result<(), String> {
    #[cfg(unix)]
    {
        let _ = child;
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        let result = unsafe { libc::kill(pid as i32, signal) };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error().to_string())
        }
    }

    #[cfg(windows)]
    {
        let _ = pid;
        let _ = force;
        child
            .take()
            .ok_or_else(|| "sidecar handle already consumed".to_string())?
            .kill()
            .map_err(|error| error.to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let dsh_bin = std::env::var("DSH_WORK_DSH_BIN")?;
            let forced_stop = cfg!(windows)
                || std::env::var("DSH_WORK_STOP_MODE").as_deref() == Ok("forced");
            let home = std::env::temp_dir().join(format!("dsh-work-tauri-harness-{}", std::process::id()));
            std::fs::create_dir_all(&home)?;

            let command = app
                .shell()
                .sidecar("node")?
                .args([dsh_bin, "web".into(), "--no-open".into(), "--port".into(), "0".into()])
                .env("DSH_HOME", home)
                .env("DSH_TELEMETRY_MODE", "DISABLED");
            let (mut receiver, child) = command.spawn()?;
            let app_handle = app.handle().clone();
            let child_pid = child.pid();

            tauri::async_runtime::spawn(async move {
                let mut child = Some(child);
                let mut ready = false;
                let mut events: Vec<Value> = vec![
                    json!({ "phase": "desktop-ready", "hiddenWindow": true }),
                    json!({ "phase": "starting", "pid": child_pid }),
                ];
                let mut stdout = String::new();

                while let Some(event) = receiver.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            stdout.push_str(&String::from_utf8_lossy(&bytes));
                            while let Some(newline) = stdout.find('\n') {
                                let line = stdout.drain(..=newline).collect::<String>();
                                let line = line.trim_end().to_string();
                                let readiness_url = line.strip_prefix("dsh web: ").map(str::to_string);
                                let safe_line = readiness_url.as_ref().map_or_else(
                                    || line.clone(),
                                    |url| {
                                        let authority = url
                                            .strip_prefix("http://")
                                            .and_then(|rest| rest.split('/').next())
                                            .unwrap_or("redacted");
                                        format!("dsh web: http://{authority}")
                                    },
                                );
                                events.push(json!({ "stream": "stdout", "line": safe_line }));
                                if let Some(url) = readiness_url.filter(|_| !ready) {
                                    match http_status(&url) {
                                        Ok(status) => {
                                            ready = status == 200;
                                            events.push(json!({ "phase": "ready", "httpStatus": status }));
                                            events.push(json!({
                                                "phase": "stopping",
                                                "mode": if forced_stop { "forced-no-public-carrier" } else { "graceful-posix-sigterm" },
                                            }));
                                            if let Err(error) = request_stop(&mut child, child_pid, forced_stop) {
                                                events.push(json!({ "phase": "failed", "reason": "stop-request", "message": error }));
                                            }
                                        }
                                        Err(error) => {
                                            events.push(json!({ "phase": "failed", "reason": "http-check", "message": error }));
                                            let _ = request_stop(&mut child, child_pid, true);
                                        }
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            events.push(json!({
                                "stream": "stderr",
                                "line": String::from_utf8_lossy(&bytes).trim_end(),
                            }));
                        }
                        CommandEvent::Error(error) => {
                            events.push(json!({ "phase": "failed", "reason": "sidecar-error", "message": error }));
                        }
                        CommandEvent::Terminated(payload) => {
                            let success = ready && (forced_stop || payload.code == Some(0));
                            events.push(json!({
                                "phase": if success { "stopped" } else { "failed" },
                                "code": payload.code,
                                "signal": payload.signal,
                            }));
                            println!("{}", serde_json::to_string_pretty(&json!({
                                "prototype": "tauri-sidecar",
                                "platform": std::env::consts::OS,
                                "tauri": "2.11.5",
                                "tauriPluginShell": "2.3.5",
                                "harness": "@deepseek-ai/dsh@0.1.1-rc.2",
                                "stopClassification": if forced_stop { "forced-no-public-carrier" } else { "graceful-posix-sigterm" },
                                "code": if success { 0 } else { 1 },
                                "events": events,
                            })).expect("prototype JSON should serialize"));
                            app_handle.exit(if success { 0 } else { 1 });
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri prototype");
}
