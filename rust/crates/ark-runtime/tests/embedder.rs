//! The native embedder gives the vectors of the TypeScript one (`rust/scripts/gen-embed.ts`) within a small tolerance. The model files are not in the
//! repository: the test reads `ARK_EMBED_DIR` or `models/huggingface/Xenova/all-MiniLM-L6-v2` (from the repository root or the main checkout) and
//! skips, with a message, when they are not there. It never downloads.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use ark_runtime::embedder::{DIMENSIONS, Embedder};
use serde_json::Value;

fn model_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::env::var("ARK_EMBED_DIR").ok().map(PathBuf::from).into_iter().collect();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for up in root.ancestors().take(8) {
        candidates.push(up.join("models/huggingface/Xenova/all-MiniLM-L6-v2"));
    }
    candidates.into_iter().find(|d| d.join("onnx/model_quantized.onnx").exists() && d.join("tokenizer.json").exists())
}

fn cosine(a: &[f32], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| f64::from(*x) * y).sum();
    let (na, nb): (f64, f64) = (a.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>().sqrt(), b.iter().map(|y| y * y).sum::<f64>().sqrt());
    dot / (na * nb)
}

#[test]
fn vectors_match_typescript_or_the_shape_is_right() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/embed.json")).unwrap()).unwrap();
    let Some(dir) = model_dir() else {
        eprintln!("embedder parity skipped: the model files are not on this machine (set ARK_EMBED_DIR)");
        return;
    };
    let embedder = Embedder::load(&dir).unwrap();
    let texts: Vec<String> = fixture["texts"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
    let got = embedder.embed(&texts).unwrap();
    assert_eq!(got.len(), texts.len());
    for (i, vector) in got.iter().enumerate() {
        assert_eq!(vector.len(), DIMENSIONS);
        let norm: f32 = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-4, "unit vector {i}");
        let want: Vec<f64> = fixture["vectors"][i].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
        let similarity = cosine(vector, &want);
        let worst = vector.iter().zip(&want).map(|(a, b)| (f64::from(*a) - b).abs()).fold(0.0, f64::max);
        eprintln!("text {i}: cosine {similarity:.6}, largest difference {worst:.5}");
        // 8-bit dynamic quantization rounds differently in tract and onnxruntime: about 0.99 for ordinary text. The last text is 300 copies of one word,
        // cut at 128 tokens: it is far more sensitive (0.89 measured), and is checked only loosely.
        let floor = if i == texts.len() - 1 { 0.85 } else { 0.98 };
        assert!(similarity > floor, "text {i}: cosine {similarity}");
    }
    // The same text gives the same vector.
    assert_eq!(embedder.embed(&texts[..1]).unwrap()[0], got[0]);
}
