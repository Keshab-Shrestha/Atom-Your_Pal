//! The macOS status item (menu bar icon). Rune has no API for it, so this uses AppKit through objc2.
//! A click on a menu item queues an `Action`; the app takes the queue in its poll hook.

use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem, NSStatusBar, NSVariableStatusItemLength};
use objc2_foundation::NSString;

/// What a status item click asks the app to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Show,
    NewChat,
    /// Right Command and Right Option went down: start dictating.
    DictateStart,
    /// One of them came up: send what was said.
    DictateSend,
}

/// The device-dependent modifier bits of a flags-changed event (IOKit `NX_DEVICERCMDKEYMASK`, `NX_DEVICERALTKEYMASK`).
const RIGHT_COMMAND: usize = 0x10;
const RIGHT_OPTION: usize = 0x40;

/// The dictation chord (hold Right Command + Right Option). Gives the action to queue when `held` changes.
pub fn chord_step(held: bool, flags: usize) -> Option<Action> {
    let both = flags & (RIGHT_COMMAND | RIGHT_OPTION) == RIGHT_COMMAND | RIGHT_OPTION;
    match (held, both) {
        (false, true) => Some(Action::DictateStart),
        (true, false) => Some(Action::DictateSend),
        _ => None,
    }
}

/// Watches the modifier keys in every app. macOS asks for Input Monitoring the first time; without it no event arrives.
fn watch_chord() {
    use std::sync::atomic::{AtomicBool, Ordering};
    static HELD: AtomicBool = AtomicBool::new(false);
    let handler = block2::RcBlock::new(|event: std::ptr::NonNull<objc2_app_kit::NSEvent>| {
        // SAFETY: AppKit passes a live event for the duration of the call.
        let flags = unsafe { event.as_ref() }.modifierFlags().bits();
        let held = HELD.load(Ordering::SeqCst);
        if let Some(action) = chord_step(held, flags) {
            HELD.store(action == Action::DictateStart, Ordering::SeqCst);
            push(action);
        }
    });
    let monitor = objc2_app_kit::NSEvent::addGlobalMonitorForEventsMatchingMask_handler(objc2_app_kit::NSEventMask::FlagsChanged, &handler);
    KEEP.with(|k| {
        if let Some(m) = monitor {
            // SAFETY: the monitor is an opaque AppKit token that only needs to stay alive.
            k.borrow_mut().push(unsafe { Retained::cast_unchecked(m) });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_chord_starts_when_both_right_keys_are_down_and_sends_when_one_lifts() {
        assert_eq!(chord_step(false, RIGHT_COMMAND), None);
        assert_eq!(chord_step(false, RIGHT_COMMAND | RIGHT_OPTION), Some(Action::DictateStart));
        assert_eq!(chord_step(true, RIGHT_COMMAND | RIGHT_OPTION), None);
        assert_eq!(chord_step(true, RIGHT_OPTION), Some(Action::DictateSend));
    }
}

static QUEUE: Mutex<Vec<Action>> = Mutex::new(Vec::new());
static WAKE: OnceLock<rune::Waker> = OnceLock::new();

fn push(action: Action) {
    QUEUE.lock().unwrap_or_else(|e| e.into_inner()).push(action);
    if let Some(wake) = WAKE.get() {
        wake();
    }
}

/// Takes the clicks since the last call.
pub fn take_actions() -> Vec<Action> {
    std::mem::take(&mut *QUEUE.lock().unwrap_or_else(|e| e.into_inner()))
}

define_class!(
    /// The target of the status menu items.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ArkStatusTarget"]
    struct Target;

    impl Target {
        #[unsafe(method(show:))]
        fn show(&self, _: &NSMenuItem) {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).activate();
            }
            push(Action::Show);
        }
        #[unsafe(method(newChat:))]
        fn new_chat(&self, _: &NSMenuItem) {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).activate();
            }
            push(Action::NewChat);
        }
        #[unsafe(method(quit:))]
        fn quit(&self, _: &NSMenuItem) {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).terminate(None);
            }
        }
    }
);

thread_local! {
    /// The status item and its target live as long as the app.
    static KEEP: std::cell::RefCell<Vec<Retained<NSObject>>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Adds the "ARK" status item. Does nothing off the main thread.
pub fn install(wake: rune::Waker) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    WAKE.get_or_init(|| wake);
    let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
    if let Some(button) = item.button(mtm) {
        button.setTitle(&NSString::from_str("ARK"));
    }
    // SAFETY: plain NSObject init on a freshly allocated object.
    let target: Retained<Target> = unsafe { msg_send![Target::alloc(mtm), init] };
    let menu = NSMenu::new(mtm);
    for (title, action) in [("Show ARK", sel!(show:)), ("New chat", sel!(newChat:)), ("Quit ARK", sel!(quit:))] {
        // SAFETY: each selector is defined on `Target` above with the matching signature.
        let entry = unsafe { NSMenuItem::initWithTitle_action_keyEquivalent(mtm.alloc(), &NSString::from_str(title), Some(action), &NSString::from_str("")) };
        // SAFETY: the target is kept in KEEP for the whole run.
        unsafe { entry.setTarget(Some(&target)) };
        menu.addItem(&entry);
    }
    item.setMenu(Some(&menu));
    watch_chord();
    KEEP.with(|k| {
        let mut k = k.borrow_mut();
        k.push(target.into_super());
        k.push(item.into_super());
    });
}
