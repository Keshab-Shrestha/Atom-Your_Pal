import Foundation

/// An app ATOM scripts with Apple events: music (ADR-068), notes (ADR-070) and the browsers of ADR-072.
public enum AutomationTarget: String, CaseIterable, Sendable {
    case music = "com.apple.Music"
    case spotify = "com.spotify.client"
    case notes = "com.apple.Notes"
    case chrome = "com.google.Chrome"
    case arc = "company.thebrowser.Browser"
    case edge = "com.microsoft.edgemac"
    case brave = "com.brave.Browser"

    public var bundleId: String { rawValue }

    public var name: String {
        switch self {
        case .music: "Music"
        case .spotify: "Spotify"
        case .notes: "Notes"
        case .chrome: "Google Chrome"
        case .arc: "Arc"
        case .edge: "Microsoft Edge"
        case .brave: "Brave Browser"
        }
    }
}

/// One line of the permissions checklist (ADR-075): what it is, when ATOM uses it, and its System Settings pane.
public enum PermissionRow: Hashable, Sendable {
    case microphone, inputMonitoring, accessibility
    case automation(AutomationTarget)
    case calendar, reminders

    public static let all: [PermissionRow] = [.microphone, .inputMonitoring, .accessibility]
        + AutomationTarget.allCases.map(PermissionRow.automation) + [.calendar, .reminders]

    /// ATOM cannot be used without these: the first-launch card stays until both are granted.
    public static let essential: [PermissionRow] = [.microphone, .inputMonitoring]

    public var title: String {
        switch self {
        case .microphone: "Microphone"
        case .inputMonitoring: "Input Monitoring"
        case .accessibility: "Accessibility"
        case .automation(let app): app.name
        case .calendar: "Calendar"
        case .reminders: "Reminders"
        }
    }

    /// Exactly when ATOM uses it.
    public var usage: String {
        switch self {
        case .microphone: "Only while you hold the Talk keys or dictate"
        case .inputMonitoring: "Watches for ATOM's own shortcuts, never what you type"
        case .accessibility: "Only to type dictated text into the app you are in"
        case .automation(.music), .automation(.spotify): "Only when you ask ATOM to play, pause or skip music"
        case .automation(.notes): "Only when you ask ATOM to take a note"
        case .automation: "Only when you ask about what's on screen: the open tab's title and address"
        case .calendar: "Only when you ask about your calendar"
        case .reminders: "Only when you ask ATOM to add or read reminders"
        }
    }

    public var settingsURL: URL {
        let pane: String
        switch self {
        case .microphone: pane = "Privacy_Microphone"
        case .inputMonitoring: pane = "Privacy_ListenEvent"
        case .accessibility: pane = "Privacy_Accessibility"
        case .automation: pane = "Privacy_Automation"
        case .calendar: pane = "Privacy_Calendars"
        case .reminders: pane = "Privacy_Reminders"
        }
        return URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
    }

    /// What the row says about its state.
    public func stateLine(_ state: PermissionState) -> String {
        switch state {
        case .denied: "Off. Open System Settings and switch ATOM on there"
        case .unchecked:
            if case .automation(let app) = self { "Not checked until \(app.name) is open" } else { "Not checked" }
        default: state.label
        }
    }
}

/// A permission's state, read from macOS without ever asking (ADR-075).
public enum PermissionState: Sendable, Equatable {
    case granted, notAsked, denied
    /// macOS cannot answer yet: Automation is only known while the app is running.
    case unchecked
    /// The app is not installed: the row is not shown.
    case notApplicable

    public var label: String {
        switch self {
        case .granted: "Allowed"
        case .notAsked: "Not yet asked"
        case .denied: "Off"
        case .unchecked: "Not checked"
        case .notApplicable: "Not installed"
        }
    }

    /// `AVAuthorizationStatus` and `EKAuthorizationStatus` raw values: 0 not determined, 1 restricted, 2 denied,
    /// 3 authorized (EventKit: full access), 4 EventKit write-only, which is not enough to read the calendar.
    public static func authorization(_ raw: Int) -> PermissionState {
        switch raw {
        case 3: .granted
        case 1, 2, 4: .denied
        default: .notAsked
        }
    }

    /// `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)`: 0 granted, 1 denied, 2 unknown (never asked).
    public static func listenAccess(_ raw: Int) -> PermissionState {
        switch raw {
        case 0: .granted
        case 1: .denied
        default: .notAsked
        }
    }

    /// `AXIsProcessTrusted()`. macOS does not tell "never asked" from "switched off", so false reads as Off.
    public static func trusted(_ isTrusted: Bool) -> PermissionState {
        isTrusted ? .granted : .denied
    }

    /// `AEDeterminePermissionToAutomateTarget(…, askUserIfNeeded: false)`: noErr granted, errAEEventNotPermitted
    /// (-1743) denied, errAEEventWouldRequireUserConsent (-1744) not asked; procNotFound (-600, the app is not
    /// running) or anything else cannot be told.
    public static func automation(_ status: Int32, installed: Bool) -> PermissionState {
        guard installed else { return .notApplicable }
        switch status {
        case 0: return .granted
        case -1743: return .denied
        case -1744: return .notAsked
        default: return .unchecked
        }
    }
}
