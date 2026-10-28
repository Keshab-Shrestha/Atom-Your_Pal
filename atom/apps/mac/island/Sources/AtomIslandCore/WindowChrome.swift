import Foundation

/// ADR-128: the words for the window's sidebar toggle (the View menu item and the button's tooltip).
public enum WindowChrome {
    public static func sidebarToggleTitle(hidden: Bool) -> String { hidden ? "Show Sidebar" : "Hide Sidebar" }
    public static func sidebarToggleHelp(hidden: Bool) -> String { "\(hidden ? "Show" : "Hide") sidebar (⌥⌘H)" }
}
