//! Small helpers that give JavaScript's and Swift's answers where Rust's standard library differs: Node's POSIX
//! `path.join` and `path.resolve`, `String.prototype.trim`, UTF-16 lengths, and JavaScript regular expressions.

use fancy_regex::Regex;

/// The characters JavaScript's `\s` and `trim()` treat as white space (WhiteSpace and LineTerminator).
/// Rust's `char::is_whitespace` differs: it has U+0085 and lacks U+FEFF.
pub fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
        | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// `String.prototype.trim`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// The JavaScript `.` excludes these line terminators.
pub fn is_js_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `string.length`: UTF-16 code units.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `string.slice(0, n)` in UTF-16 code units. A surrogate pair cut in half becomes U+FFFD (JavaScript keeps a lone
/// surrogate, which a Rust string cannot hold).
pub fn utf16_prefix(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

const BACKTRACK_LIMIT: usize = 50_000_000;

/// For a case-insensitive match: JavaScript's `/i` (no `u` flag) never folds a non-ASCII letter to an ASCII one, but
/// Rust's `(?i)` folds ſ (U+017F) to s and the Kelvin sign (U+212A) to k. Each becomes a symbol of the same UTF-8
/// length, so offsets stay valid for the original text.
pub fn ascii_case_guard(text: &str) -> std::borrow::Cow<'_, str> {
    if text.contains(['\u{17F}', '\u{212A}']) {
        text.replace('\u{17F}', "\u{A7}").replace('\u{212A}', "\u{2010}").into()
    } else {
        text.into()
    }
}

/// `string.slice(n)` in UTF-16 code units (a cut surrogate pair becomes U+FFFD).
pub fn utf16_suffix(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().skip(n).collect();
    String::from_utf16_lossy(&units)
}

/// General category Cf (format), Unicode 16.
// ponytail: a fixed table; a new Unicode version may add format characters.
pub fn is_format(c: char) -> bool {
    matches!(c as u32, 0xAD | 0x600..=0x605 | 0x61C | 0x6DD | 0x70F | 0x890..=0x891 | 0x8E2 | 0x180E | 0x200B..=0x200F
        | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F | 0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD
        | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

/// General categories Cc, Cf, Zl and Zp: the characters `[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]` matches.
pub fn is_control_or_format(c: char) -> bool {
    c.is_control() || is_format(c) || c == '\u{2028}' || c == '\u{2029}'
}

/// `text.replace(/[class]+/g, " ")` for a class given as a predicate.
pub fn collapse_runs(text: &str, class: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for c in text.chars() {
        if class(c) {
            if !in_run {
                out.push(' ');
            }
            in_run = true;
        } else {
            out.push(c);
            in_run = false;
        }
    }
    out
}

/// The class JavaScript's `\s` matches, for use inside a character class.
const JS_SPACE_CLASS: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// A JavaScript regular expression (no `u` flag) as a Rust one: `\s`/`\S` get JavaScript's white space, and `\w`/`\b`
/// and `\d` are ASCII, as in JavaScript.
// ponytail: a textual rewrite of the escapes the ported patterns use; a new pattern with other JS-only syntax needs a check.
/// Only for the fixed patterns of this crate: a pattern that does not compile panics (every test run compiles them all).
#[allow(clippy::expect_used)]
pub fn js_regex(pattern: &str, ignore_case: bool) -> Regex {
    let mut out = String::with_capacity(pattern.len() * 2);
    if ignore_case {
        out.push_str("(?i)");
    }
    let mut chars = pattern.chars().peekable();
    let mut in_class = false;
    while let Some(c) = chars.next() {
        if c == '\\' {
            let Some(next) = chars.next() else {
                out.push('\\');
                break;
            };
            match (next, in_class) {
                ('s', true) => out.push_str(JS_SPACE_CLASS),
                ('s', false) => {
                    out.push('[');
                    out.push_str(JS_SPACE_CLASS);
                    out.push(']');
                }
                ('S', false) => {
                    out.push_str("[^");
                    out.push_str(JS_SPACE_CLASS);
                    out.push(']');
                }
                ('d', true) => out.push_str("0-9"),
                ('d', false) => out.push_str("[0-9]"),
                ('w', true) => out.push_str("A-Za-z0-9_"),
                ('w', false) => out.push_str("[A-Za-z0-9_]"),
                // fancy-regex has no `(?-u:\b)`: the ASCII word boundary as look-arounds.
                ('b', false) => out.push_str(r"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"),
                _ => {
                    out.push('\\');
                    out.push(next);
                }
            }
            continue;
        }
        if c == '[' && !in_class {
            in_class = true;
        } else if c == ']' && in_class {
            in_class = false;
        }
        out.push(c);
    }
    // The look-arounds make fancy-regex backtrack where JavaScript's engine does not give up: a quadratic scan of an
    // 8 000-character command passes the default limit (1 000 000 steps). 50 000 000 keeps such a scan exact.
    fancy_regex::RegexBuilder::new(&out).backtrack_limit(BACKTRACK_LIMIT).build().expect("a fixed pattern compiles")
}

/// Node's `normalizeString`: the path's parts with "." and ".." applied.
fn normalize_parts(path: &str, allow_above_root: bool) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|last| *last != "..") {
                    parts.pop();
                } else if allow_above_root {
                    parts.push("..");
                }
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

/// Node's `path.posix.normalize`.
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".into();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut out = normalize_parts(path, !absolute);
    if out.is_empty() {
        if absolute {
            return "/".into();
        }
        return if trailing { "./".into() } else { ".".into() };
    }
    if trailing {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

/// Node's `path.posix.join`.
pub fn join(parts: &[&str]) -> String {
    let joined = parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/");
    if joined.is_empty() { ".".into() } else { normalize(&joined) }
}

/// Node's `path.posix.resolve` for an absolute path. A relative path is read from "/".
// ponytail: Node reads a relative path from process.cwd(); every ported caller passes an absolute one.
pub fn resolve(path: &str) -> String {
    format!("/{}", normalize_parts(path, false))
}

/// `path.posix.isAbsolute`.
pub fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}

/// `path.win32.isAbsolute`.
pub fn is_win32_absolute(path: &str) -> bool {
    let b = path.as_bytes();
    match b.first() {
        None => false,
        Some(b'/' | b'\\') => true,
        Some(c) => b.len() > 2 && c.is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'/' | b'\\'),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_follow_node() {
        assert_eq!(join(&["/Users/me", "Documents", "ARK"]), "/Users/me/Documents/ARK");
        assert_eq!(join(&["/Users/me", "../../etc"]), "/etc");
        assert_eq!(join(&["/Users/me/", "x/"]), "/Users/me/x/");
        assert_eq!(resolve("/Users/me/x/"), "/Users/me/x");
        assert_eq!(resolve("/.."), "/");
        assert_eq!(normalize("a/../.."), "..");
        assert!(is_win32_absolute("C:\\x") && is_win32_absolute("\\x") && !is_win32_absolute("C:x"));
    }

    #[test]
    fn regex_is_ascii_like_javascript() {
        let re = js_regex(r"\bgit\s+push\b", false);
        assert!(re.is_match("git push").unwrap_or(false));
        assert!(re.is_match("égit push").unwrap_or(false), "JS \\b is ASCII: é is not a word character");
        assert!(re.is_match("git\u{FEFF}push").unwrap_or(false), "JS \\s has U+FEFF");
        assert!(!re.is_match("git\u{85}push").unwrap_or(true), "JS \\s lacks U+0085");
    }
}
