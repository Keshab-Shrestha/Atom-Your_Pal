// zeno-calendar: ZENO's door to Calendar and Reminders (ADR-060), through EventKit. Built into ZENO.app
// (Contents/MacOS/zeno-calendar) so macOS asks for permission once, for ZENO. The runtime calls it:
//
//   zeno-calendar events <from ISO 8601> <to ISO 8601>
//   zeno-calendar reminders
//   zeno-calendar add-reminder <title> [<due ISO 8601>]
//
// It prints one JSON object on stdout: {"ok":true,...} or {"ok":false,"error":"...","denied":true?}. Exit 0 either way;
// a crash or a non-JSON line is the runtime's sign that something is broken.
import EventKit
import Foundation

let store = EKEventStore()
let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

@MainActor func emit(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data(#"{"ok":false,"error":"could not encode"}"#.utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

@MainActor func fail(_ message: String, denied: Bool = false) -> Never {
    emit(denied ? ["ok": false, "error": message, "denied": true] : ["ok": false, "error": message])
}

@MainActor func parseDate(_ text: String) -> Date? {
    if let d = iso.date(from: text) { return d }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return withFraction.date(from: text)
}

@MainActor func access(_ type: EKEntityType) async -> Bool {
    do {
        return type == .event ? try await store.requestFullAccessToEvents() : try await store.requestFullAccessToReminders()
    } catch {
        return false
    }
}

let deniedEvents = "ZENO is not allowed to see your calendar. Allow it in System Settings → Privacy & Security → Calendars."
let deniedReminders = "ZENO is not allowed to see your reminders. Allow it in System Settings → Privacy & Security → Reminders."

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("usage: zeno-calendar events|reminders|add-reminder …") }

switch command {
case "events":
    guard args.count == 3, let from = parseDate(args[1]), let to = parseDate(args[2]), to > from else {
        fail("events needs a start and an end time (ISO 8601), the end after the start")
    }
    guard to.timeIntervalSince(from) <= 62 * 86_400 else { fail("ask for at most 62 days of events at a time") }
    guard await access(.event) else { fail(deniedEvents, denied: true) }
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }.prefix(60)
    emit(["ok": true, "events": events.map { e -> [String: Any] in
        var item: [String: Any] = [
            "title": e.title ?? "(no title)",
            "start": iso.string(from: e.startDate),
            "end": iso.string(from: e.endDate),
            "allDay": e.isAllDay,
            "calendar": e.calendar?.title ?? "",
        ]
        if let location = e.location, !location.isEmpty { item["location"] = location }
        return item
    }])

case "reminders":
    guard await access(.reminder) else { fail(deniedReminders, denied: true) }
    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    struct Item: Sendable { let title: String; let list: String; let due: Date? }
    let found: [Item] = await withCheckedContinuation { continuation in
        store.fetchReminders(matching: predicate) { reminders in
            let items = (reminders ?? []).map {
                Item(title: $0.title ?? "(no title)", list: $0.calendar?.title ?? "", due: $0.dueDateComponents?.date)
            }
            continuation.resume(returning: items)
        }
    }
    let sorted = found.sorted { a, b in
        switch (a.due, b.due) {
        case let (x?, y?): x < y
        case (_?, nil): true
        default: false
        }
    }.prefix(60)
    emit(["ok": true, "reminders": sorted.map { r -> [String: Any] in
        var item: [String: Any] = ["title": r.title, "list": r.list]
        if let due = r.due { item["due"] = iso.string(from: due) }
        return item
    }])

case "add-reminder":
    guard args.count == 2 || args.count == 3 else { fail("add-reminder needs a title and an optional due time") }
    let title = args[1].trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title.count <= 200 else { fail("the reminder needs a title of at most 200 characters") }
    var due: Date?
    if args.count == 3 {
        guard let d = parseDate(args[2]) else { fail("the due time must be ISO 8601") }
        due = d
    }
    guard await access(.reminder) else { fail(deniedReminders, denied: true) }
    guard let list = store.defaultCalendarForNewReminders() else { fail("there is no default Reminders list") }
    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    reminder.calendar = list
    if let due {
        reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
        reminder.addAlarm(EKAlarm(absoluteDate: due))
    }
    do {
        try store.save(reminder, commit: true)
    } catch {
        fail("Reminders did not save it: \(error.localizedDescription)")
    }
    var result: [String: Any] = ["ok": true, "title": title, "list": list.title]
    if let due { result["due"] = iso.string(from: due) }
    emit(result)

default:
    fail("unknown command \(command.prefix(30))")
}
