//! Check C3: a C ABI over Rune's embed host (`rune::embed::LayerHost`), so the SwiftPM program in
//! `embed-host/` can draw the text check inside a SwiftUI view and feed it pointer, key and
//! input-method events. `embed-host/build.sh` builds this crate as a static library.

use std::ffi::{CStr, c_char, c_void};
use std::sync::Arc;

use rune::embed::LayerHost;
use rune::{Ime, Key, KeyEvent, Mods};

use crate::log::log;
use crate::text::{self, Text};

pub struct Host(LayerHost<Text>);

/// The UTF-8 text at `s`, or an empty string.
///
/// # Safety
/// `s` is null or a NUL-terminated string that lives for this call.
unsafe fn str_at(s: *const c_char) -> String {
    if s.is_null() {
        return String::new();
    }
    // SAFETY: the caller passes a NUL-terminated string (see above).
    unsafe { CStr::from_ptr(s) }.to_string_lossy().into_owned()
}

/// Draws the text check on `layer` (a `CAMetalLayer *`). Null on failure (logged).
///
/// # Safety
/// `layer` is a live `CAMetalLayer` that outlives the host; call on the main thread.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_new(layer: *mut c_void, width: f32, height: f32, scale: f32) -> *mut Host {
    let spec = text::spec();
    let state = (spec.init)();
    // SAFETY: forwarded from this function's contract.
    match unsafe { LayerHost::from_core_animation_layer(layer, &spec, state, (width, height), scale, true, Arc::new(|| {})) } {
        Ok(host) => {
            log("embed host created");
            Box::into_raw(Box::new(Host(host)))
        }
        Err(e) => {
            log(format!("embed host failed: {e}"));
            std::ptr::null_mut()
        }
    }
}

/// Runs `f` on the host behind `host`, if any.
///
/// # Safety
/// `host` is null or came from `ark_embed_new` and is not freed.
unsafe fn with(host: *mut Host, f: impl FnOnce(&mut LayerHost<Text>)) {
    // SAFETY: see above; the Swift side calls on the main thread only, so there is no alias.
    if let Some(h) = unsafe { host.as_mut() } {
        f(&mut h.0);
    }
}

/// Presents one frame. True while Rune animates (call again on the next display tick).
///
/// # Safety
/// As `with`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_frame(host: *mut Host) -> bool {
    let mut animating = false;
    // SAFETY: forwarded.
    unsafe { with(host, |h| animating = h.frame().animating) };
    animating
}

/// # Safety
/// As `with`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_resize(host: *mut Host, width: f32, height: f32, scale: f32) {
    // SAFETY: forwarded.
    unsafe { with(host, |h| h.resize((width, height), scale)) };
}

/// `kind`: 0 move, 1 down, 2 up. Points from the view's top-left.
///
/// # Safety
/// As `with`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_pointer(host: *mut Host, kind: i32, x: f32, y: f32) {
    // SAFETY: forwarded.
    unsafe {
        with(host, |h| {
            let rt = h.runtime_mut();
            match kind {
                1 => rt.pointer_down(x, y),
                2 => rt.pointer_up(x, y),
                _ => rt.pointer_move(x, y),
            }
        })
    };
}

/// A typed character (`Key::Text`), or with `command` set a key named by AppKit's command:
/// "deleteBackward:", "insertNewline:", "moveLeft:", "moveRight:".
///
/// # Safety
/// As `with`; `text` as `str_at`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_key(host: *mut Host, text: *const c_char, command: bool) {
    // SAFETY: forwarded.
    let s = unsafe { str_at(text) };
    let key = if !command {
        Key::Text(s)
    } else {
        match s.as_str() {
            "deleteBackward:" => Key::Backspace,
            "insertNewline:" => Key::Enter,
            "moveLeft:" => Key::Left,
            "moveRight:" => Key::Right,
            other => return log(format!("embed: unmapped command {other}")),
        }
    };
    // SAFETY: forwarded.
    unsafe { with(host, |h| h.runtime_mut().key(KeyEvent { key, mods: Mods::default() })) };
}

/// `kind`: 0 preedit (marked text), 1 commit.
///
/// # Safety
/// As `with`; `text` as `str_at`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_ime(host: *mut Host, kind: i32, text: *const c_char) {
    // SAFETY: forwarded.
    let s = unsafe { str_at(text) };
    let ev = if kind == 1 { Ime::Commit(s) } else { Ime::Preedit(s.clone(), Some((s.len(), s.len()))) };
    // SAFETY: forwarded.
    unsafe { with(host, |h| h.runtime_mut().ime(ev)) };
}

/// # Safety
/// `host` is null or came from `ark_embed_new`; it is not used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_embed_free(host: *mut Host) {
    if !host.is_null() {
        // SAFETY: see above.
        drop(unsafe { Box::from_raw(host) });
    }
}
