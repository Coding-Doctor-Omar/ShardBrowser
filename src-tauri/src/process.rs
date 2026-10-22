// Tracker for launched ShardX child processes; keyed by profile_id.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tokio::process::Child;

pub struct Tracker {
    inner: Mutex<HashMap<String, ChildEntry>>,
}

struct ChildEntry {
    pid: u32,
    killer: tokio::sync::mpsc::Sender<()>,
    /// Set once DevToolsActivePort is read; None for UI launches.
    cdp: Option<CdpInfo>,
    /// Process start; serialised as elapsed ms in RunningProfile.
    started_at: Instant,
}

/// CDP endpoint for an API-launched profile.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CdpInfo {
    pub port: u16,
    pub http_url: String,
    /// ws://127.0.0.1:<port>/devtools/browser/<id> for Puppeteer/Playwright.
    pub web_socket_debugger_url: String,
}

impl Tracker {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Take a spawned child + monitor it; entry removed on exit/kill.
    pub fn track(self: &'static Self, profile_id: String, mut child: Child, temporary: bool) -> u32 {
        let pid = child.id().unwrap_or(0);
        let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);

        {
            let mut g = self.inner.lock().unwrap();
            let previous = g.insert(
                profile_id.clone(),
                ChildEntry { pid, killer: tx, cdp: None, started_at: Instant::now() },
            );
            // Replacing the entry drops the old killer and orphans that browser.
            // `launch` refuses a second launch up front; this is the backstop.
            if let Some(prev) = previous {
                eprintln!(
                    "[tracker] {profile_id} was already tracked as pid {}; stopping it",
                    prev.pid
                );
                let _ = prev.killer.try_send(());
            }
        }

        // Graceful shutdown (SIGTERM / taskkill WM_CLOSE) → 5s → hard kill.
        // Graceful path flushes session state so next launch skips the restore prompt.
        let started_at = Instant::now();
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {}
                _ = rx.recv() => {
                    #[cfg(unix)]
                    {
                        if let Some(p) = child.id() {
                            // SAFETY: libc::kill on a child pid we own.
                            unsafe { libc::kill(p as libc::pid_t, libc::SIGTERM); }
                        }
                    }
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        if let Some(p) = child.id() {
                            // taskkill /PID without /F posts WM_CLOSE for clean shutdown.
                            // 0x08000000 = CREATE_NO_WINDOW — suppress the console flash.
                            let _ = std::process::Command::new("taskkill")
                                .args(["/PID", &p.to_string()])
                                .creation_flags(0x08000000)
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null())
                                .status();
                        }
                    }
                    let graceful = tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        child.wait(),
                    ).await;
                    if graceful.is_err() {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                    }
                }
            }
            // The process we started is gone — which is not the same as the
            // browser being gone.
            //
            // On Windows a launcher running as administrator makes Chromium
            // restart itself without those rights, and the process we hold
            // exits within a second while the real browser carries on. The
            // same shape appears when a browser from a previous run of the
            // launcher is still up: the new process hands its command line to
            // that one through Chromium's singleton and exits. Either way the
            // entry was dropped here, the profile went back to Idle with its
            // window open, Stop was no longer offered, and starting it again
            // just repeated the handover.
            //
            // The profile's own lock says which it is, and it is the same
            // answer Chromium itself reads. While it is held the profile is
            // running, whoever owns it, so the entry stays and the status
            // stays honest; `after_exit` waits for the browser that is really
            // there rather than for the shell that launched it.
            if let Ok(udd) = crate::profile::user_data_dir(&profile_id) {
                let mut waited = std::time::Duration::ZERO;
                let step = std::time::Duration::from_secs(2);
                while crate::reset::lock_is_live(&udd) {
                    tokio::time::sleep(step).await;
                    waited += step;
                    // A lock nobody releases must not pin a profile to
                    // Running for the rest of the session.
                    if waited >= std::time::Duration::from_secs(12 * 60 * 60) {
                        break;
                    }
                }
            }
            if let Ok(mut g) = Self::shared().inner.lock() {
                g.remove(&profile_id);
            }
            after_exit(&profile_id, temporary, started_at.elapsed().as_millis() as u64);
        });

        pid
    }

    /// Attach CDP to a tracked profile; no-op if the profile already exited.
    pub fn set_cdp(&self, profile_id: &str, cdp: CdpInfo) {
        if let Ok(mut g) = self.inner.lock() {
            if let Some(e) = g.get_mut(profile_id) {
                e.cdp = Some(cdp);
            }
        }
    }

    /// CDP endpoint when the profile was launched with remote debugging.
    /// Whether a child is live for this profile.
    pub fn is_running(&self, profile_id: &str) -> bool {
        self.inner
            .lock()
            .map(|g| g.contains_key(profile_id))
            .unwrap_or(false)
    }

    pub fn cdp(&self, profile_id: &str) -> Option<CdpInfo> {
        self.inner.lock().ok()?.get(profile_id)?.cdp.clone()
    }

    pub fn running(&self) -> Vec<RunningProfile> {
        let g = self.inner.lock().unwrap();
        g.iter()
            .map(|(id, e)| RunningProfile {
                profile_id: id.clone(),
                pid: e.pid,
                cdp: e.cdp.clone(),
                uptime_ms: e.started_at.elapsed().as_millis() as u64,
            })
            .collect()
    }

    pub async fn kill(&self, profile_id: &str) -> Result<bool> {
        let killer = {
            let g = self.inner.lock().unwrap();
            g.get(profile_id).map(|e| e.killer.clone())
        };
        if let Some(k) = killer {
            let _ = k.send(()).await;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn shared() -> &'static Tracker {
        static INSTANCE: std::sync::OnceLock<Tracker> = std::sync::OnceLock::new();
        INSTANCE.get_or_init(Tracker::new)
    }
}

/// The bookkeeping after a browser closes: its total run time, or a
/// temporary profile's own removal. Skipped while the data is being moved
/// or reset (the lock in migrate.rs): a write then would land in a folder
/// that is on its way out, or bring a removed profile back. A temporary
/// profile left behind is swept at the next start (`purge_temporary`).
/// Returns whether it ran.
fn after_exit(profile_id: &str, temporary: bool, elapsed_ms: u64) -> bool {
    if crate::migrate::in_progress() {
        eprintln!("[launcher] {profile_id} closed while the data is being moved or reset; nothing written");
        return false;
    }
    // Bump the persisted total runtime; non-temporary only (temp profiles
    // are deleted below, so their counter is moot).
    if !temporary {
        if let Err(e) = crate::profile::add_runtime(profile_id, elapsed_ms) {
            eprintln!("[launcher] add_runtime({profile_id}) failed: {e}");
        }
    }
    // Tear down temporary profile (config + udd) on close.
    if temporary {
        match crate::profile::delete(profile_id) {
            Ok(()) => eprintln!("[launcher] temporary profile {profile_id} deleted on close"),
            Err(e) => eprintln!("[launcher] temporary profile {profile_id} cleanup failed: {e}"),
        }
    }
    true
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RunningProfile {
    pub profile_id: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cdp: Option<CdpInfo>,
    /// Milliseconds since the engine was spawned; frontend formats as
    /// "1h 23m" / "12m 30s" / "45s".
    pub uptime_ms: u64,
}

#[cfg(test)]
mod tests {
    /// I3: while a reset holds the lock, a browser's exit writes nothing.
    #[test]
    fn a_close_during_a_reset_writes_nothing() {
        let _serial = crate::migrate::serial();
        assert!(crate::migrate::hold());
        let ran = super::after_exit("not-a-profile", false, 5);
        crate::migrate::release();
        assert!(!ran);
    }
}
