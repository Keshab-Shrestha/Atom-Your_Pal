//! Runs the built ark-hello binary headless, as CI does, and checks both outputs.
#![allow(clippy::expect_used)] // Test code: a failed step should stop the test with its message.

use std::collections::HashSet;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;

const WIDTH_PT: u32 = 360;
const HEIGHT_PT: u32 = 200;
const SCALE: u32 = 2;

/// A path in the test temp folder with no file from an earlier run.
fn fresh(name: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("ark-hello");
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join(name);
    if path.exists() {
        std::fs::remove_file(&path).expect("remove old output");
    }
    path
}

fn run(args: &[&str]) {
    let status = Command::new(env!("CARGO_BIN_EXE_ark-hello")).args(args).status().expect("ark-hello starts");
    assert!(status.success(), "ark-hello {args:?} failed: {status}");
}

#[test]
fn snap_writes_a_png_of_the_window_size() {
    let png = fresh("hello.png");
    run(&["--snap", png.to_str().expect("utf-8 path"), "--scale", &SCALE.to_string()]);

    let bytes = std::fs::read(&png).expect("png written");
    let mut reader = png::Decoder::new(Cursor::new(bytes)).read_info().expect("valid PNG");
    let mut pixels = vec![0; reader.output_buffer_size().expect("buffer size")];
    let info = reader.next_frame(&mut pixels).expect("PNG frame");
    assert_eq!((info.width, info.height), (WIDTH_PT * SCALE, HEIGHT_PT * SCALE));

    // A blank window is one colour, so text on the background means at least two.
    let bpp = info.line_size / info.width as usize;
    let colours: HashSet<&[u8]> = pixels[..info.buffer_size()].chunks_exact(bpp).collect();
    assert!(colours.len() >= 2, "the PNG is one flat colour: no text was drawn");
}

#[test]
fn tree_holds_the_hello_text_for_screen_readers() {
    let tree = fresh("tree.json");
    run(&["--tree", tree.to_str().expect("utf-8 path")]);

    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&tree).expect("tree written")).expect("valid JSON");
    let a11y = json.get("accessibility").expect("accessibility tree").to_string();
    assert!(a11y.contains("Hello from ARK"), "accessibility tree lacks the title: {a11y}");
    assert!(json.to_string().contains("Rust and Rune, Phase 0"), "element tree lacks the subtitle");
}
