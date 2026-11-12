//! A small server-sent-events reader. It joins `data:` lines and ignores comments.

#[derive(Debug, Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

#[derive(Debug, PartialEq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

impl SseParser {
    /// Adds bytes, returns every event that is now complete.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some((end, skip)) = find_blank_line(&self.buf) {
            let block: Vec<u8> = self.buf.drain(..end + skip).take(end).collect();
            if let Some(e) = parse_block(&String::from_utf8_lossy(&block)) {
                out.push(e);
            }
        }
        out
    }
}

fn find_blank_line(b: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i < b.len() {
        if b[i..].starts_with(b"\r\n\r\n") {
            return Some((i, 4));
        }
        if b[i..].starts_with(b"\n\n") {
            return Some((i, 2));
        }
        i += 1;
    }
    None
}

fn parse_block(block: &str) -> Option<SseEvent> {
    let (mut event, mut data) = (String::new(), Vec::new());
    for line in block.lines() {
        if let Some(v) = line.strip_prefix("event:") {
            event = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("data:") {
            data.push(v.strip_prefix(' ').unwrap_or(v).to_string());
        }
    }
    if data.is_empty() { None } else { Some(SseEvent { event, data: data.join("\n") }) }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn splits_events_across_chunks_and_skips_comments() {
        let mut p = SseParser::default();
        assert!(p.push(b": ping\n\nevent: a\nda").is_empty());
        let got = p.push(b"ta: {\"x\":1}\n\nevent: b\r\ndata: 2\r\n\r\n");
        assert_eq!(got, vec![
            SseEvent { event: "a".into(), data: "{\"x\":1}".into() },
            SseEvent { event: "b".into(), data: "2".into() },
        ]);
    }
}
