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
    KEEP.with(|k| {
        let mut k = k.borrow_mut();
        k.push(target.into_super());
        k.push(item.into_super());
    });
}
