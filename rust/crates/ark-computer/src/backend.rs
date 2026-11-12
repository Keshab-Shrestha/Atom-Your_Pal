//! Where input goes: `DryRun` (records, touches nothing) or `Live` (CGEvents).

use std::sync::{Arc, Mutex};

use crate::action::Action;

/// What a backend did (or, for `DryRun`, would do).
#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    Move(f64, f64),
    Click { x: f64, y: f64, double: bool },
    Type(String),
    Key(String),
    Scroll(i32, i32),
}

pub trait Backend: Send {
    /// The main display in points: `(width, height)`.
    fn screen_size(&self) -> (f64, f64);
    /// Performs one input action (`Action::Status` and `Action::Screen` never reach a backend).
    fn perform(&mut self, action: &Action) -> Result<(), String>;
}

/// Records the effects in a list the test can read. It never posts an event.
#[derive(Debug, Clone)]
pub struct DryRun {
    pub effects: Arc<Mutex<Vec<Effect>>>,
    pub size: (f64, f64),
}

impl Default for DryRun {
    fn default() -> Self {
        DryRun { effects: Arc::default(), size: (1440.0, 900.0) }
    }
}

impl Backend for DryRun {
    fn screen_size(&self) -> (f64, f64) {
        self.size
    }
    fn perform(&mut self, action: &Action) -> Result<(), String> {
        let effect = match action {
            Action::Move { x, y } => Effect::Move(*x, *y),
            Action::Click { x, y, double } => Effect::Click { x: *x, y: *y, double: *double },
            Action::Type { text } => Effect::Type(text.clone()),
            Action::Key { combo } => Effect::Key(combo.clone()),
            Action::Scroll { dx, dy } => Effect::Scroll(*dx, *dy),
            Action::Status | Action::Screen => return Ok(()),
        };
        self.effects.lock().map_err(|_| "dry-run list is poisoned".to_string())?.push(effect);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub use live::Live;

#[cfg(target_os = "macos")]
mod live {
    use core_graphics::display::{CGDisplay, CGPoint};
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, ScrollEventUnit};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    use super::{Action, Backend};
    use crate::policy::normalized;

    /// The environment variable that must be `1` before `Live::arm` works.
    pub const LIVE_ENV: &str = "ARK_COMPUTER_LIVE";

    /// Posts real input to the Mac. Two steps arm it: the caller passes `owner_approved = true` (the app got the Accessibility
    /// grant and the user switched computer control on), and `ARK_COMPUTER_LIVE=1` is set. The Mac also needs the Accessibility
    /// permission for the process; without it the system drops the events (ARK does not request it here).
    pub struct Live {
        source: CGEventSource,
    }

    // SAFETY: the source is only used from the one thread that holds the `Mutex<Box<dyn Backend>>` in `ComputerTool`.
    unsafe impl Send for Live {}

    impl Live {
        pub fn arm(owner_approved: bool, env: impl Fn(&str) -> Option<String>) -> Result<Live, String> {
            if !owner_approved || env(LIVE_ENV).as_deref() != Some("1") {
                return Err("Live computer input is off. It needs the owner's switch and ARK_COMPUTER_LIVE=1.".into());
            }
            let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|()| "The system refused an event source.".to_string())?;
            Ok(Live { source })
        }

        fn mouse(&self, kind: CGEventType, x: f64, y: f64, clicks: i64) -> Result<(), String> {
            let event = CGEvent::new_mouse_event(self.source.clone(), kind, CGPoint::new(x, y), CGMouseButton::Left).map_err(|()| "The mouse event failed.".to_string())?;
            event.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE, clicks);
            event.post(CGEventTapLocation::HID);
            Ok(())
        }

        fn key(&self, code: u16, down: bool, flags: CGEventFlags) -> Result<(), String> {
            let event = CGEvent::new_keyboard_event(self.source.clone(), code, down).map_err(|()| "The key event failed.".to_string())?;
            event.set_flags(flags);
            event.post(CGEventTapLocation::HID);
            Ok(())
        }
    }

    /// US-layout key codes for the keys a combo may end with.
    fn key_code(name: &str) -> Option<u16> {
        Some(match name {
            "return" | "enter" => 0x24,
            "tab" => 0x30,
            "space" => 0x31,
            "delete" | "backspace" => 0x33,
            "esc" | "escape" => 0x35,
            "left" => 0x7B,
            "right" => 0x7C,
            "down" => 0x7D,
            "up" => 0x7E,
            n if n.len() == 1 => {
                let c = n.chars().next()?;
                // Letters and digits, US ANSI.
                const MAP: [(char, u16); 36] = [
                    ('a', 0), ('s', 1), ('d', 2), ('f', 3), ('h', 4), ('g', 5), ('z', 6), ('x', 7), ('c', 8), ('v', 9), ('b', 11), ('q', 12), ('w', 13), ('e', 14), ('r', 15), ('y', 16), ('t', 17), ('1', 18),
                    ('2', 19), ('3', 20), ('4', 21), ('6', 22), ('5', 23), ('9', 25), ('7', 26), ('8', 28), ('0', 29), ('o', 31), ('u', 32), ('i', 34), ('p', 35), ('l', 37), ('j', 38), ('k', 40), ('n', 45), ('m', 46),
                ];
                return MAP.iter().find(|(k, _)| *k == c).map(|(_, v)| *v);
            }
            _ => return None,
        })
    }

    impl Backend for Live {
        fn screen_size(&self) -> (f64, f64) {
            let b = CGDisplay::main().bounds();
            (b.size.width, b.size.height)
        }

        fn perform(&mut self, action: &Action) -> Result<(), String> {
            match action {
                Action::Move { x, y } => self.mouse(CGEventType::MouseMoved, *x, *y, 0),
                Action::Click { x, y, double } => {
                    for n in 1..=if *double { 2 } else { 1 } {
                        self.mouse(CGEventType::LeftMouseDown, *x, *y, n)?;
                        self.mouse(CGEventType::LeftMouseUp, *x, *y, n)?;
                    }
                    Ok(())
                }
                Action::Type { text } => {
                    for ch in text.chars() {
                        let s = ch.to_string();
                        for down in [true, false] {
                            let event = CGEvent::new_keyboard_event(self.source.clone(), 0, down).map_err(|()| "The key event failed.".to_string())?;
                            event.set_string(&s);
                            event.post(CGEventTapLocation::HID);
                        }
                    }
                    Ok(())
                }
                Action::Key { combo } => {
                    let norm = normalized(combo);
                    let mut parts: Vec<&str> = norm.split('+').collect();
                    let key = parts.pop().unwrap_or("");
                    let mut flags = CGEventFlags::empty();
                    for m in parts {
                        flags |= match m {
                            "cmd" | "command" => CGEventFlags::CGEventFlagCommand,
                            "shift" => CGEventFlags::CGEventFlagShift,
                            "opt" | "alt" | "option" => CGEventFlags::CGEventFlagAlternate,
                            "ctrl" | "control" => CGEventFlags::CGEventFlagControl,
                            other => return Err(format!("\"{other}\" is not a modifier.")),
                        };
                    }
                    let code = key_code(key).ok_or_else(|| format!("\"{key}\" is not a key ARK can press yet."))?;
                    self.key(code, true, flags)?;
                    self.key(code, false, flags)
                }
                Action::Scroll { dx, dy } => {
                    let event = CGEvent::new_scroll_event(self.source.clone(), ScrollEventUnit::LINE, 2, *dy, *dx, 0).map_err(|()| "The scroll event failed.".to_string())?;
                    event.post(CGEventTapLocation::HID);
                    Ok(())
                }
                Action::Status | Action::Screen => Ok(()),
            }
        }
    }
}
