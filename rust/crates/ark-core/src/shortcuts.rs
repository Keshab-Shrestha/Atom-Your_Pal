//! ADR-040: raw key events to shortcut actions, the matcher of
//! `apps/mac/island/Sources/ArkIslandCore/ShortcutMatcher.swift`. Pure and clock-free: the caller passes the time.
//! The matcher needs the shortcut model of `Shortcuts.swift`; only the parts it reads are ported (modifiers, a key
//! combo, the actions in order with their hold flag and default). Display, spoken names and validation are not.
//!
//! A modifier-only hold starts `arm_delay` seconds after exactly its modifiers are down, is spoiled by any other key
//! or modifier, ends when one of its modifiers goes up, and nothing starts again until every modifier is up.

use std::collections::{HashMap, HashSet};

/// Modifier keys as bits, in the Swift option set's values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Modifiers(pub u8);

impl Modifiers {
    pub const NONE: Modifiers = Modifiers(0);
    pub const CONTROL: Modifiers = Modifiers(1);
    pub const OPTION: Modifiers = Modifiers(1 << 1);
    pub const SHIFT: Modifiers = Modifiers(1 << 2);
    pub const COMMAND: Modifiers = Modifiers(1 << 3);
    pub const FUNCTION: Modifiers = Modifiers(1 << 4);

    pub fn contains(self, other: Modifiers) -> bool {
        self.0 & other.0 == other.0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    fn is_strict_subset(self, other: Modifiers) -> bool {
        self != other && other.contains(self)
    }

    fn is_strict_superset(self, other: Modifiers) -> bool {
        self != other && self.contains(other)
    }
}

impl std::ops::BitOr for Modifiers {
    type Output = Modifiers;
    fn bitor(self, rhs: Modifiers) -> Modifiers {
        Modifiers(self.0 | rhs.0)
    }
}

/// A shortcut: modifiers with an optional key. Without a key it is modifier-only (e.g. hold ⌃⌥).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct KeyCombo {
    pub modifiers: Modifiers,
    /// macOS virtual key code; `None`: modifiers only.
    pub key_code: Option<u16>,
    /// The key's label captured when recorded.
    pub key_name: Option<String>,
    /// Modifier-only: only the right-hand modifier counts ("Right ⌥").
    pub right_side_only: bool,
}

impl KeyCombo {
    pub fn modifiers_only(modifiers: Modifiers, right_side_only: bool) -> KeyCombo {
        KeyCombo { modifiers, key_code: None, key_name: None, right_side_only }
    }

    pub fn keyed(modifiers: Modifiers, key_code: u16, key_name: Option<&str>) -> KeyCombo {
        KeyCombo { modifiers, key_code: Some(key_code), key_name: key_name.map(String::from), right_side_only: false }
    }

    pub fn is_modifier_only(&self) -> bool {
        self.key_code.is_none()
    }
}

/// What a shortcut does, in Swift's `allCases` order (the matcher's tie-break).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShortcutAction {
    Talk,
    Dictate,
    ToggleIsland,
    Cancel,
    QuickAction,
}

impl ShortcutAction {
    pub const ALL: [ShortcutAction; 5] =
        [ShortcutAction::Talk, ShortcutAction::Dictate, ShortcutAction::ToggleIsland, ShortcutAction::Cancel, ShortcutAction::QuickAction];

    /// Held while speaking, rather than pressed once.
    pub fn is_hold(self) -> bool {
        matches!(self, ShortcutAction::Talk | ShortcutAction::Dictate)
    }

    pub fn default_combo(self) -> KeyCombo {
        match self {
            ShortcutAction::Talk => KeyCombo::modifiers_only(Modifiers::CONTROL | Modifiers::OPTION, false),
            ShortcutAction::Dictate => KeyCombo::modifiers_only(Modifiers::COMMAND | Modifiers::OPTION, true),
            ShortcutAction::ToggleIsland => KeyCombo::keyed(Modifiers::CONTROL | Modifiers::OPTION, 6, Some("Z")),
            ShortcutAction::Cancel => KeyCombo::keyed(Modifiers::NONE, 53, Some("Esc")),
            ShortcutAction::QuickAction => KeyCombo::keyed(Modifiers::CONTROL | Modifiers::OPTION, 40, Some("K")),
        }
    }
}

/// What the matcher reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutTrigger {
    /// A press shortcut fired.
    Pressed(ShortcutAction),
    /// A hold shortcut started: start listening.
    HoldBegan(ShortcutAction),
    /// A hold shortcut was released cleanly: send.
    HoldEnded(ShortcutAction),
    /// A hold shortcut was spoiled by another key: abandon.
    HoldCancelled(ShortcutAction),
}

/// Key events, independent of AppKit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyInput {
    /// A modifier key went down or up. `modifiers` is the full set held afterwards.
    FlagsChanged { key_code: u16, modifiers: Modifiers },
    KeyDown { key_code: u16, modifiers: Modifiers, is_repeat: bool },
    KeyUp { key_code: u16 },
    /// A shortcut handled elsewhere (a system hot key) fired. Counts as another key.
    OtherKey,
    /// Key tracking was interrupted. Forget held keys.
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

/// Virtual key codes of the modifier keys.
fn modifier_key(key_code: u16) -> Option<(Modifiers, Side)> {
    Some(match key_code {
        55 => (Modifiers::COMMAND, Side::Left),
        54 => (Modifiers::COMMAND, Side::Right),
        56 => (Modifiers::SHIFT, Side::Left),
        60 => (Modifiers::SHIFT, Side::Right),
        58 => (Modifiers::OPTION, Side::Left),
        61 => (Modifiers::OPTION, Side::Right),
        59 => (Modifiers::CONTROL, Side::Left),
        62 => (Modifiers::CONTROL, Side::Right),
        63 | 179 => (Modifiers::FUNCTION, Side::Left),
        _ => return None,
    })
}

#[derive(Debug, Clone)]
pub struct ShortcutMatcher {
    /// How long exactly a modifier-only hold's modifiers must be down before it starts.
    pub arm_delay: f64,
    /// Holds that start sooner or later than `arm_delay`.
    pub arm_delays: HashMap<ShortcutAction, f64>,
    shortcuts: HashMap<ShortcutAction, KeyCombo>,
    modifiers: Modifiers,
    held_modifier_keys: HashSet<u16>,
    /// Another key (or a chord) was pressed since the modifiers were last all up.
    dirty: bool,
    /// A modifier-only hold whose modifiers are down, waiting out its delay.
    pending: Option<(ShortcutAction, f64)>,
    active_modifier_hold: Option<ShortcutAction>,
    /// A keyed hold in progress (e.g. fn+Space held), ended by releasing its key.
    active_key_hold: Option<(ShortcutAction, u16)>,
}

impl ShortcutMatcher {
    pub fn new(arm_delay: f64, arm_delays: HashMap<ShortcutAction, f64>) -> Self {
        ShortcutMatcher {
            arm_delay,
            arm_delays,
            shortcuts: HashMap::new(),
            modifiers: Modifiers::NONE,
            held_modifier_keys: HashSet::new(),
            dirty: false,
            pending: None,
            active_modifier_hold: None,
            active_key_hold: None,
        }
    }

    fn delay(&self, action: ShortcutAction) -> f64 {
        self.arm_delays.get(&action).copied().unwrap_or(self.arm_delay)
    }

    /// Whether a shortcut needs key-level tracking here rather than a system hot key: modifier-only ones, and fn.
    pub fn needs_key_tracking(combo: &KeyCombo) -> bool {
        combo.is_modifier_only() || combo.modifiers.contains(Modifiers::FUNCTION)
    }

    pub fn shortcuts(&self) -> &HashMap<ShortcutAction, KeyCombo> {
        &self.shortcuts
    }

    /// When `tick` must be called next, if a hold is waiting to start.
    pub fn next_deadline(&self) -> Option<f64> {
        self.pending.map(|(action, since)| since + self.delay(action))
    }

    /// Replaces the shortcuts. A hold in progress is cancelled if its shortcut changed.
    pub fn set_shortcuts(&mut self, new: HashMap<ShortcutAction, KeyCombo>) -> Vec<ShortcutTrigger> {
        let mut out = Vec::new();
        let changed = |action: ShortcutAction| new.get(&action) != self.shortcuts.get(&action);
        if let Some(action) = self.active_modifier_hold.filter(|a| changed(*a)) {
            self.active_modifier_hold = None;
            self.dirty = !self.modifiers.is_empty();
            out.push(ShortcutTrigger::HoldCancelled(action));
        }
        if let Some((action, _)) = self.active_key_hold.filter(|(a, _)| changed(*a)) {
            self.active_key_hold = None;
            out.push(ShortcutTrigger::HoldCancelled(action));
        }
        if self.pending.is_some_and(|(a, _)| changed(a)) {
            self.pending = None;
        }
        self.shortcuts = new;
        out
    }

    pub fn handle(&mut self, input: KeyInput, now: f64) -> Vec<ShortcutTrigger> {
        match input {
            KeyInput::FlagsChanged { key_code, modifiers } => self.modifiers_changed(key_code, modifiers, now),
            KeyInput::KeyDown { is_repeat: true, .. } => Vec::new(),
            KeyInput::KeyDown { key_code, modifiers, .. } => {
                let mut out = self.other_key_pressed();
                if self.active_key_hold.is_none()
                    && let Some(action) = self.keyed_match(key_code, modifiers)
                {
                    if action.is_hold() {
                        self.active_key_hold = Some((action, key_code));
                        out.push(ShortcutTrigger::HoldBegan(action));
                    } else {
                        out.push(ShortcutTrigger::Pressed(action));
                    }
                }
                out
            }
            KeyInput::KeyUp { key_code } => match self.active_key_hold {
                Some((action, code)) if code == key_code => {
                    self.active_key_hold = None;
                    vec![ShortcutTrigger::HoldEnded(action)]
                }
                _ => Vec::new(),
            },
            KeyInput::OtherKey => self.other_key_pressed(),
            KeyInput::Reset => {
                let mut out = Vec::new();
                out.extend(self.active_modifier_hold.map(ShortcutTrigger::HoldCancelled));
                out.extend(self.active_key_hold.map(|(a, _)| ShortcutTrigger::HoldCancelled(a)));
                self.active_modifier_hold = None;
                self.active_key_hold = None;
                self.pending = None;
                self.modifiers = Modifiers::NONE;
                self.held_modifier_keys.clear();
                self.dirty = false;
                out
            }
        }
    }

    /// Starts a waiting hold once its delay has passed.
    pub fn tick(&mut self, now: f64) -> Vec<ShortcutTrigger> {
        match self.pending {
            Some((action, since)) if now >= since + self.delay(action) && !self.dirty && self.active_modifier_hold.is_none() => {
                self.pending = None;
                self.active_modifier_hold = Some(action);
                vec![ShortcutTrigger::HoldBegan(action)]
            }
            _ => Vec::new(),
        }
    }

    fn modifiers_changed(&mut self, key_code: u16, new_modifiers: Modifiers, now: f64) -> Vec<ShortcutTrigger> {
        self.track_modifier_key(key_code, new_modifiers);
        self.modifiers = new_modifiers;
        let mut out = Vec::new();

        if self.modifiers.is_empty() {
            out.extend(self.active_modifier_hold.map(ShortcutTrigger::HoldEnded));
            self.active_modifier_hold = None;
            self.pending = None;
            self.dirty = false;
            return out;
        }

        if let Some(action) = self.active_modifier_hold
            && let Some(combo) = self.shortcuts.get(&action).filter(|c| !self.matches(c))
        {
            let ended = self.modifiers.is_strict_subset(combo.modifiers);
            self.active_modifier_hold = None;
            self.dirty = true; // no other hold starts until every modifier is up
            // Fewer modifiers: one was let go, so send. More: another modifier joined, so it was not this shortcut.
            out.push(if ended { ShortcutTrigger::HoldEnded(action) } else { ShortcutTrigger::HoldCancelled(action) });
            self.pending = None;
            return out;
        }

        if let Some((action, _)) = self.pending
            && let Some(combo) = self.shortcuts.get(&action).filter(|c| !self.matches(c))
        {
            let grew = self.modifiers.is_strict_superset(combo.modifiers);
            self.pending = None;
            // Another modifier joined before it started. Unless that makes a different shortcut, it was not a clean
            // press: nothing starts until every modifier is up.
            if grew && self.modifier_only_match().is_none() {
                self.dirty = true;
            }
        }
        if !self.dirty && self.active_modifier_hold.is_none() && self.active_key_hold.is_none() && self.pending.is_none() {
            self.pending = self.modifier_only_match().map(|action| (action, now));
        }
        out
    }

    /// Any non-modifier key, or a chord handled elsewhere: spoils a modifier-only hold.
    fn other_key_pressed(&mut self) -> Vec<ShortcutTrigger> {
        let out: Vec<ShortcutTrigger> = self.active_modifier_hold.take().map(ShortcutTrigger::HoldCancelled).into_iter().collect();
        self.pending = None;
        if !self.modifiers.is_empty() {
            self.dirty = true;
        }
        out
    }

    fn track_modifier_key(&mut self, key_code: u16, new_modifiers: Modifiers) {
        if let Some((modifier, _)) = modifier_key(key_code) {
            if !new_modifiers.contains(modifier) {
                // This modifier is fully up: forget both sides.
                self.held_modifier_keys.retain(|k| modifier_key(*k).map(|m| m.0) != Some(modifier));
            } else if !self.held_modifier_keys.remove(&key_code) {
                // Not held before: it went down (held before: one side let go while the other is still down).
                self.held_modifier_keys.insert(key_code);
            }
        }
        // Drop keys whose modifier is no longer down (a missed key-up).
        self.held_modifier_keys.retain(|k| modifier_key(*k).is_some_and(|(m, _)| new_modifiers.contains(m)));
    }

    /// Exactly this modifier-only shortcut is held now.
    fn matches(&self, combo: &KeyCombo) -> bool {
        if !combo.is_modifier_only() || self.modifiers != combo.modifiers {
            return false;
        }
        if !combo.right_side_only {
            return true;
        }
        let sides: Vec<Side> =
            self.held_modifier_keys.iter().filter_map(|k| modifier_key(*k)).filter(|(m, _)| combo.modifiers.contains(*m)).map(|(_, s)| s).collect();
        sides.contains(&Side::Right) && !sides.contains(&Side::Left)
    }

    fn modifier_only_match(&self) -> Option<ShortcutAction> {
        ShortcutAction::ALL.into_iter().find(|a| a.is_hold() && self.shortcuts.get(a).is_some_and(|c| self.matches(c)))
    }

    /// A keyed shortcut with fn (the others are system hot keys).
    fn keyed_match(&self, key_code: u16, key_modifiers: Modifiers) -> Option<ShortcutAction> {
        ShortcutAction::ALL.into_iter().find(|a| {
            self.shortcuts.get(a).is_some_and(|c| c.key_code == Some(key_code) && Self::needs_key_tracking(c) && key_modifiers == c.modifiers)
        })
    }
}
