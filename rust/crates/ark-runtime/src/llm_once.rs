//! One model call with no tools: a system text and one user text give one answer text. Used by the jobs that Node ran through its text
//! editor (the improvement notes, the morning brief, the digest of a kept chat). Every call goes through the LLM gateway.

use ark_llm::{Block, Message, Provider, Request, collect};

/// The text of the answer, or why there is none.
pub fn ask(provider: &dyn Provider, model: &str, system: &str, text: &str, max_tokens: u32) -> Result<String, String> {
    let request = Request { model: model.into(), system: Some(system.into()), messages: vec![Message::user_text(text)], tools: Vec::new(), max_tokens };
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
    let answer = runtime
        .block_on(async {
            let stream = provider.stream(&request).await?;
            collect(stream, |_| {}).await
        })
        .map_err(|e| e.to_string())?;
    let text: String = answer.content.iter().filter_map(|b| if let Block::Text { text } = b { Some(text.as_str()) } else { None }).collect();
    Ok(text)
}
