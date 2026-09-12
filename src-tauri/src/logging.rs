//! The log file, and the only way anything in the shell reports itself.
//!
//! A release build carries `windows_subsystem = "windows"`, so it has no
//! console: `eprintln!` wrote to a handle nobody owns and a packaged failure
//! produced no diagnostic anywhere on the machine. Everything the shell has to
//! say now goes to `%LOCALAPPDATA%\JobHunter\logs\backend-YYYY-MM-DD.log`, and
//! the backend's own stdout and stderr are piped into the same file.
//!
//! Times are UTC and marked with a trailing `Z`, in the shell and in the
//! backend alike, so one file never mixes two clocks.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Rotate once the day's file reaches this size.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// How many log files to keep, newest first.
const KEEP_FILES: usize = 7;

/// Writes are serialised: the shell and both pipe readers share one file.
static WRITING: Mutex<()> = Mutex::new(());

/// The line a backend writes to say it has refused to serve, and why.
///
/// The backend prints it before it stops. Everything after the prefix is the
/// JSON body of `backend::Refusal`. `backend/app/core/startup.py` is the other
/// half.
pub const REFUSAL_MARKER: &str = "JOB-HUNTER-STARTUP-REFUSED ";

/// The last refusal a backend process printed, waiting to be read once.
static REFUSAL: Mutex<Option<String>> = Mutex::new(None);

/// Forget any refusal left over from an earlier process.
///
/// Called before each spawn. A refusal from the process that just stopped must
/// never be read as the diagnosis of the one starting now.
pub fn clear_refusal() {
    if let Ok(mut slot) = REFUSAL.lock() {
        *slot = None;
    }
}

/// Take the refusal a backend printed, if one arrived.
pub fn take_refusal() -> Option<String> {
    REFUSAL.lock().ok()?.take()
}

/// The data directory the environment names, when it names one that can be
/// used.
///
/// A relative value is deliberately not resolved here. It would resolve
/// against whatever directory happened to launch the shell, which is the
/// defect this setting had: the same value meant two different folders
/// depending on who started the process. `backend::check_environment` refuses
/// it and says so on the panel; this returns `None` so the log still lands
/// somewhere a person can find, which is where that refusal has to be written.
pub fn env_data_dir() -> Option<PathBuf> {
    let value = std::env::var("JOB_HUNTER_DATA_DIR").ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    path.is_absolute().then_some(path)
}

/// Where the data directory is, matching what the backend decides for itself.
fn data_dir() -> PathBuf {
    if let Some(path) = env_data_dir() {
        return path;
    }
    if cfg!(windows) {
        let base = std::env::var("LOCALAPPDATA")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .or_else(home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("JobHunter")
    } else {
        home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local")
            .join("share")
            .join("job-hunter")
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

/// The directory holding every log file.
pub fn log_dir() -> PathBuf {
    data_dir().join("logs")
}

/// Today's log file.
pub fn log_path() -> PathBuf {
    let (year, month, day, _, _, _) = now_utc();
    log_dir().join(format!("backend-{year:04}-{month:02}-{day:02}.log"))
}

/// Seconds since the epoch, split into a civil date and a wall clock, in UTC.
///
/// The calendar arithmetic is the standard days-to-civil conversion. It is
/// here rather than from a date library because the shell needs six numbers
/// and nothing else.
fn now_utc() -> (i64, u32, u32, u32, u32, u32) {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    (
        year,
        month,
        day,
        (rest / 3600) as u32,
        ((rest % 3600) / 60) as u32,
        (rest % 60) as u32,
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = (shifted - era * 146_097) as i64;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// The UTC stamp every line in the file carries, and the one the shell hands
/// the window so it can say which lines predate this launch.
pub fn stamp() -> String {
    let (year, month, day, hour, minute, second) = now_utc();
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}Z")
}

/// Append one line, rotating first if the file has grown past the limit.
pub fn write(line: &str) {
    let _guard = WRITING.lock();
    let directory = log_dir();
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = log_path();
    rotate_if_large(&path);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{}", line);
    }
}

/// A line from the shell itself, rather than from the backend process.
pub fn shell(message: &str) {
    write(&format!("{} SHELL    {}", stamp(), message));
}

fn rotate_if_large(path: &std::path::Path) {
    let size = match fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => return,
    };
    if size < MAX_BYTES {
        return;
    }
    let (year, month, day, hour, minute, second) = now_utc();
    let rotated = log_dir().join(format!(
        "backend-{year:04}-{month:02}-{day:02}-{hour:02}{minute:02}{second:02}.log"
    ));
    if fs::rename(path, &rotated).is_ok() {
        prune();
    }
}

/// Keep the newest `KEEP_FILES` log files and delete the rest.
fn prune() {
    let directory = log_dir();
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("backend-") && name.ends_with(".log")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();

    files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in files.into_iter().skip(KEEP_FILES) {
        let _ = fs::remove_file(path);
    }
}

/// The last `count` lines of today's log.
///
/// A log file that does not exist yet is not an error: on a first run the
/// interface asks for the tail before the backend has written anything.
pub fn tail(count: usize) -> (PathBuf, Vec<String>) {
    let path = log_path();
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(_) => return (path, Vec::new()),
    };

    let mut lines: Vec<String> = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        lines.push(line);
        if lines.len() > count * 4 {
            // Keep the buffer bounded on a long file without reading backwards.
            let excess = lines.len() - count;
            lines.drain(0..excess);
        }
    }
    let start = lines.len().saturating_sub(count);
    let tail = lines.split_off(start);
    (path, tail)
}

/// Copy a child process pipe into the log, line by line, until it closes.
///
/// Returning the thread handle is deliberate: the caller waits on both pipes
/// to know the process has finished talking.
pub fn pipe<R: Read + Send + 'static>(source: R, tag: &'static str) {
    std::thread::spawn(move || {
        for line in BufReader::new(source).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            write(&format!("{tag} {line}"));
            // A refusal is kept as well as logged. The log is what a person
            // reads afterwards; this is what the panel shows now, in the
            // backend's own words rather than as "the process exited".
            if let Some(payload) = line.trim().strip_prefix(REFUSAL_MARKER) {
                if let Ok(mut slot) = REFUSAL.lock() {
                    *slot = Some(payload.trim().to_string());
                }
            }
        }
    });
}
