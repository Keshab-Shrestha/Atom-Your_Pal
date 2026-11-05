import Foundation

// Routines and published schedule workflows while ARK is closed (2026-11-04, idea from atticus-mac "launchd routines"; workflows ADR-246). A routine runs only while ARK runs. With the
// switch on, a macOS LaunchAgent opens ARK in the background a minute before the next routine is due; ARK's own clock then starts it.
// This file holds the plain parts (when to wake, what the agent file says), so they are unit-tested. Writing the file and running
// launchctl is the app's job (WakeInstaller).

public enum WakeAgent {
    public static let label = "dev.ark.wake"
    /// ARK opens this long before the routine is due, to be ready when its clock looks.
    public static let leadSeconds: TimeInterval = 60

    /// When the agent should open ARK: before the earliest future routine, or nil when none is due ahead.
    public static func nextWake(routineTimes: [Date], now: Date) -> Date? {
        guard let next = routineTimes.filter({ $0 > now }).min() else { return nil }
        let early = next.addingTimeInterval(-leadSeconds)
        return early > now ? early : next
    }

    /// The LaunchAgent file: open the app (not in front) once, at this calendar time. launchd repeats a Month/Day/Hour/Minute time every year,
    /// and the app is already open then or opens harmlessly; each routine change writes a new file.
    public static func plist(appPath: String, at date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.month, .day, .hour, .minute], from: date)
        func escaped(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key><string>\(label)</string>
            <key>ProgramArguments</key>
            <array><string>/usr/bin/open</string><string>-g</string><string>\(escaped(appPath))</string></array>
            <key>StartCalendarInterval</key>
            <dict>
                <key>Month</key><integer>\(c.month ?? 1)</integer>
                <key>Day</key><integer>\(c.day ?? 1)</integer>
                <key>Hour</key><integer>\(c.hour ?? 0)</integer>
                <key>Minute</key><integer>\(c.minute ?? 0)</integer>
            </dict>
            <key>RunAtLoad</key><false/>
        </dict>
        </plist>

        """
    }

    public static func agentURL(home: URL) -> URL {
        home.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }
}
