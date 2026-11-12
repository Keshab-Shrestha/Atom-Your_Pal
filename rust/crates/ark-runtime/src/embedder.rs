//! The local sentence-embedding model of memory search (ADR-097, ADR-278): a port of `apps/mac/src/embedder.ts`. Node ran
//! `Xenova/all-MiniLM-L6-v2` (quantized ONNX, mean pooling, unit vectors) through `@huggingface/transformers`. Rust runs the same ONNX file
//! with `tract-onnx` (pure Rust, MIT or Apache-2.0, no native library) and a port of the BERT tokenizer (`tokenizer.json` of that model:
//! lower case, accents off, Chinese characters spaced, punctuation split, WordPiece, 128 tokens). The files are read from
//! `models/huggingface/Xenova/all-MiniLM-L6-v2` (the folder Node uses) or `ARK_EMBED_DIR`. A missing file is downloaded once with `curl` into
//! that folder. They are never in the repository. It is not a general LLM (CLAUDE.md rule 11).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tract_onnx::prelude::*;
use unicode_normalization::UnicodeNormalization;

pub const MODEL_ID: &str = "Xenova/all-MiniLM-L6-v2";
/// The size of one vector.
pub const DIMENSIONS: usize = 384;
const MAX_TOKENS: usize = 128;
const MAX_WORD_CHARS: usize = 100;
const FILES: [(&str, &str); 2] = [("tokenizer.json", "tokenizer.json"), ("onnx/model_quantized.onnx", "onnx/model_quantized.onnx")];
const DOWNLOAD_SECONDS: &str = "600";

/// The folder of the model files: `ARK_EMBED_DIR`, else `models/huggingface/Xenova/all-MiniLM-L6-v2` from the folder the runtime started in.
pub fn model_dir() -> PathBuf {
    match std::env::var("ARK_EMBED_DIR").ok().filter(|v| !v.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => std::env::current_dir().unwrap_or_default().join("models/huggingface").join(MODEL_ID),
    }
}

/// Downloads the files that are missing (one `curl` each, written to a temporary name first).
pub fn fetch_missing(dir: &Path) -> Result<(), String> {
    for (remote, local) in FILES {
        let target = dir.join(local);
        if target.exists() {
            continue;
        }
        std::fs::create_dir_all(target.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
        let tmp = target.with_extension("part");
        let url = format!("https://huggingface.co/{MODEL_ID}/resolve/main/{remote}");
        let status = std::process::Command::new("/usr/bin/curl").args(["-fsSL", "--max-time", DOWNLOAD_SECONDS, "-o"]).arg(&tmp).arg(&url).status().map_err(|e| format!("curl could not start: {e}"))?;
        if !status.success() {
            std::fs::remove_file(&tmp).ok();
            return Err(format!("The embedding model file {remote} could not be downloaded."));
        }
        std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- the BERT tokenizer ----

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF | 0x2A700..=0x2B73F | 0x2B740..=0x2B81F | 0x2B820..=0x2CEAF | 0xF900..=0xFAFF | 0x2F800..=0x2FA1F)
}

fn is_punctuation(c: char) -> bool {
    c.is_ascii_punctuation() || (!c.is_ascii() && !c.is_alphanumeric() && !c.is_whitespace() && !c.is_control() && is_unicode_punct(c))
}

/// The Unicode `P*` categories, for the characters outside ASCII that BERT splits on (general punctuation, CJK and full-width forms).
fn is_unicode_punct(c: char) -> bool {
    matches!(c as u32, 0x00A1 | 0x00A7 | 0x00AB | 0x00B6 | 0x00B7 | 0x00BB | 0x00BF | 0x2010..=0x2027 | 0x2030..=0x205E | 0x3001..=0x3003 | 0x3008..=0x3011 | 0x3014..=0x301F | 0xFF01..=0xFF0F | 0xFF1A..=0xFF20 | 0xFF3B..=0xFF3D | 0xFF5B..=0xFF65)
}

fn is_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

/// `BertNormalizer`: clean the text, space the Chinese characters, lower case, strip accents.
fn normalize(text: &str) -> String {
    let mut cleaned = String::new();
    for c in text.chars() {
        if c == '\0' || c == '\u{fffd}' || (c.is_control() && !matches!(c, '\t' | '\n' | '\r')) {
            continue;
        }
        if is_cjk(c) {
            cleaned.push(' ');
            cleaned.push(c);
            cleaned.push(' ');
        } else if c.is_whitespace() {
            cleaned.push(' ');
        } else {
            cleaned.push(c);
        }
    }
    cleaned.to_lowercase().nfd().filter(|c| !is_mark(*c)).collect()
}

/// `BertPreTokenizer`: words split at white space; each punctuation character is a word.
fn pre_tokenize(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    for chunk in text.split_whitespace() {
        let mut word = String::new();
        for c in chunk.chars() {
            if is_punctuation(c) {
                if !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                words.push(c.to_string());
            } else {
                word.push(c);
            }
        }
        if !word.is_empty() {
            words.push(word);
        }
    }
    words
}

/// The WordPiece vocabulary of `tokenizer.json`.
pub struct Tokenizer {
    vocab: HashMap<String, i64>,
    unk: i64,
}

impl Tokenizer {
    pub fn from_file(path: &Path) -> Result<Tokenizer, String> {
        let raw: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let vocab: HashMap<String, i64> = raw["model"]["vocab"].as_object().ok_or("tokenizer.json has no vocabulary")?.iter().filter_map(|(k, v)| v.as_i64().map(|i| (k.clone(), i))).collect();
        let unk = *vocab.get("[UNK]").ok_or("tokenizer.json has no [UNK]")?;
        Ok(Tokenizer { vocab, unk })
    }

    fn word_pieces(&self, word: &str) -> Vec<i64> {
        let chars: Vec<char> = word.chars().collect();
        if chars.len() > MAX_WORD_CHARS {
            return vec![self.unk];
        }
        let (mut pieces, mut start) = (Vec::new(), 0);
        while start < chars.len() {
            let mut end = chars.len();
            let mut found = None;
            while start < end {
                let part: String = chars[start..end].iter().collect();
                let key = if start > 0 { format!("##{part}") } else { part };
                if let Some(id) = self.vocab.get(&key) {
                    found = Some(*id);
                    break;
                }
                end -= 1;
            }
            match found {
                Some(id) => pieces.push(id),
                None => return vec![self.unk],
            }
            start = end;
        }
        pieces
    }

    /// `[CLS]`, the pieces (cut to fit), `[SEP]`.
    pub fn encode(&self, text: &str) -> Vec<i64> {
        let (cls, sep) = (self.vocab.get("[CLS]").copied().unwrap_or(101), self.vocab.get("[SEP]").copied().unwrap_or(102));
        let mut ids = vec![cls];
        for word in pre_tokenize(&normalize(text)) {
            ids.extend(self.word_pieces(&word));
        }
        ids.truncate(MAX_TOKENS - 1);
        ids.push(sep);
        ids
    }
}

// ---- the model ----

type Plan = std::sync::Arc<TypedSimplePlan>;

/// The loaded model.
pub struct Embedder {
    tokenizer: Tokenizer,
    plan: Plan,
}

fn load_plan(path: &Path) -> Result<Plan, String> {
    let e = |x: TractError| format!("{x:#}");
    let mut model = tract_onnx::onnx().model_for_path(path).map_err(e)?;
    // The graph names its sizes (`batch_size`, `sequence_length`): they stay symbols while the types are worked out, then become 1 and 128.
    let (batch, length) = (model.symbols.sym("batch_size"), model.symbols.sym("sequence_length"));
    for i in 0..model.inputs.len() {
        model.set_input_fact(i, InferenceFact::dt_shape(i64::datum_type(), tvec![batch.to_dim(), length.to_dim()])).map_err(e)?;
    }
    let typed = model.into_typed().map_err(e)?;
    let values: HashMap<Symbol, TDim> = HashMap::from([(batch, 1.to_dim()), (length, (MAX_TOKENS as i64).to_dim())]);
    typed.set_symbols(&values).map_err(e)?.into_optimized().map_err(e)?.into_runnable().map_err(e)
}

impl Embedder {
    /// Loads the files of `dir` (they must be there: see `fetch_missing`).
    pub fn load(dir: &Path) -> Result<Embedder, String> {
        Ok(Embedder { tokenizer: Tokenizer::from_file(&dir.join("tokenizer.json"))?, plan: load_plan(&dir.join("onnx/model_quantized.onnx"))? })
    }

    /// Unit vectors for the texts (mean pooling over the real tokens, then the length scaled to 1).
    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let e = |x: TractError| format!("{x:#}");
        texts
            .iter()
            .map(|text| {
                let ids = self.tokenizer.encode(text);
                let real = ids.len();
                let pad = |fill: i64, take: &dyn Fn(usize) -> i64| -> Tensor { tract_ndarray::Array2::from_shape_fn((1, MAX_TOKENS), |(_, j)| if j < real { take(j) } else { fill }).into_tensor() };
                let (input_ids, mask, types) = (pad(0, &|j| ids[j]), pad(0, &|_| 1), pad(0, &|_| 0));
                // The model names its inputs input_ids, attention_mask and token_type_ids (in that order for this model).
                let out = self.plan.run(tvec!(input_ids.into(), mask.into(), types.into())).map_err(e)?;
                let hidden = out[0].to_plain_array_view::<f32>().map_err(e)?;
                let mut sum = vec![0f32; DIMENSIONS];
                for t in 0..real {
                    for (d, slot) in sum.iter_mut().enumerate() {
                        *slot += hidden[[0, t, d]];
                    }
                }
                let mean: Vec<f32> = sum.iter().map(|v| v / real as f32).collect();
                let norm = mean.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
                Ok(mean.into_iter().map(|v| v / norm).collect())
            })
            .collect()
    }
}

// ponytail: one process-wide model; loaded on first use, under a lock (a second embed waits).
static SHARED: OnceLock<Mutex<Option<Embedder>>> = OnceLock::new();

/// Embeds with the shared model: loads it first (downloads the files when they are missing).
pub fn embed_shared(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let slot = SHARED.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().map_err(|_| "The embedding model lock broke.".to_string())?;
    if guard.is_none() {
        let dir = model_dir();
        fetch_missing(&dir)?;
        *guard = Some(Embedder::load(&dir)?);
    }
    guard.as_ref().ok_or("The embedding model is unavailable.")?.embed(texts)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn the_normalizer_and_pre_tokenizer_follow_bert() {
        assert_eq!(normalize("Café  \u{0}Ünï"), "cafe  uni");
        assert_eq!(pre_tokenize(&normalize("Hello, world! 你好")), ["hello", ",", "world", "!", "你", "好"]);
    }
}
