import SwiftUI
import ArkIslandCore

/// A GitHub-style activity calendar and a weekday-by-hour grid (after EasyUI's Activity Heatmap, rebuilt in SwiftUI):
/// weeks as columns fitted to the width, month and weekday labels, colour levels by quartile of the busy days, the
/// total and the peak day, a hover read-out and a Less–More legend.
struct ActivityHeatmap: View {
    enum Mode: Int, CaseIterable {
        case calendar, byHour
        var title: String { self == .calendar ? "Calendar" : "By hour" }
    }

    /// One entry per event (a commit), at its time.
    let events: [Date]
    /// "commits"
    let unit: String
    /// The last day shown; the newest event by default.
    var end: Date? = nil
    @State private var mode = Mode.calendar
    @State private var hovered: Cell?
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let cell: CGFloat = 11
    private static let gap: CGFloat = 3
    private static let labelWidth: CGFloat = 28
    private static let maxWeeks = 53

    struct Cell: Equatable {
        var column: Int
        var row: Int
        var count: Int
        var label: String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(summary).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color).monospacedDigit()
                Spacer(minLength: 8)
                DashboardTabStrip(titles: Mode.allCases.map(\.title), selected: mode.rawValue) { mode = Mode(rawValue: $0) ?? .calendar }
            }
            GeometryReader { proxy in
                let grid = mode == .calendar ? calendarGrid(width: proxy.size.width) : hourGrid()
                gridView(grid, width: proxy.size.width)
            }
            .frame(height: Self.gridHeight)
            HStack(spacing: 4) {
                Text(hovered.map { "\($0.label) · \($0.count) \(unit)" } ?? peak)
                    .appFont(.system(size: 11)).foregroundStyle(hovered == nil ? theme.text3.color : theme.text.color).monospacedDigit()
                    .contentTransition(.opacity)
                Spacer(minLength: 8)
                Text("Less").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
                ForEach(0..<5, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous).fill(color(level)).frame(width: 10, height: 10)
                }
                Text("More").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
            }
            .accessibilityHidden(true)
        }
        .animation(Motion.settle(reduceMotion), value: mode)
    }

    // MARK: Grids

    private struct Grid {
        var columns: [[Cell]]
        var rowLabels: [String]
        /// Labels above the columns where they start (a month, an hour).
        var columnLabels: [(column: Int, text: String)]
        var levels: (Int) -> Int
    }

    private static let gridHeight: CGFloat = 14 + 7 * (cell + gap)

    private var calendar: Calendar { Calendar.current }
    private var lastDay: Date { calendar.startOfDay(for: end ?? events.max() ?? Date()) }

    private func calendarGrid(width: CGFloat) -> Grid {
        let weeks = max(1, min(Self.maxWeeks, Int((width - Self.labelWidth + Self.gap) / (Self.cell + Self.gap))))
        let counts = Dictionary(grouping: events) { calendar.startOfDay(for: $0) }.mapValues(\.count)
        // The last column is the week holding `lastDay`; rows are weekdays from the calendar's first weekday.
        let lastRow = (calendar.component(.weekday, from: lastDay) - calendar.firstWeekday + 7) % 7
        let start = calendar.date(byAdding: .day, value: -((weeks - 1) * 7 + lastRow), to: lastDay)!
        var columns: [[Cell]] = []
        var labels: [(column: Int, text: String)] = []
        var lastMonth = -1
        for week in 0..<weeks {
            var column: [Cell] = []
            for row in 0..<7 {
                guard let day = calendar.date(byAdding: .day, value: week * 7 + row, to: start), day <= lastDay else { break }
                if row == 0 {
                    let month = calendar.component(.month, from: day)
                    if month != lastMonth { labels.append((week, day.formatted(.dateTime.month(.abbreviated)))); lastMonth = month }
                }
                column.append(Cell(column: week, row: row, count: counts[day] ?? 0,
                                   label: day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())))
            }
            columns.append(column)
        }
        // Drop a month label crowded by the next one (fewer than three columns apart).
        let spaced = labels.enumerated().filter { index, label in index + 1 >= labels.count || labels[index + 1].column - label.column >= 3 }.map(\.element)
        return Grid(columns: columns, rowLabels: rowLabels, columnLabels: spaced, levels: Self.quartiles(columns.flatMap { $0.map(\.count) }))
    }

    private func hourGrid() -> Grid {
        var counts = Array(repeating: Array(repeating: 0, count: 7), count: 24)
        for event in events {
            let row = (calendar.component(.weekday, from: event) - calendar.firstWeekday + 7) % 7
            counts[calendar.component(.hour, from: event)][row] += 1
        }
        let symbols = calendar.shortWeekdaySymbols
        let columns = (0..<24).map { hour in
            (0..<7).map { row in
                Cell(column: hour, row: row, count: counts[hour][row],
                     label: "\(symbols[(row + calendar.firstWeekday - 1) % 7]) \(String(format: "%02d", hour)):00")
            }
        }
        let hourLabels = stride(from: 0, to: 24, by: 6).map { (column: $0, text: String(format: "%02d", $0)) }
        return Grid(columns: columns, rowLabels: rowLabels, columnLabels: hourLabels, levels: Self.quartiles(counts.flatMap { $0 }))
    }

    /// Every other weekday named, as on GitHub (Mon, Wed, Fri with a Sunday start).
    private var rowLabels: [String] {
        let symbols = calendar.shortWeekdaySymbols
        return (0..<7).map { row in row % 2 == 1 ? symbols[(row + calendar.firstWeekday - 1) % 7] : "" }
    }

    /// Level 0 for none, then 1–4 by quartile of the days (or hours) that have any.
    static func quartiles(_ counts: [Int]) -> (Int) -> Int {
        let busy = counts.filter { $0 > 0 }.sorted()
        guard !busy.isEmpty else { return { _ in 0 } }
        let cut = { (q: Double) in busy[min(busy.count - 1, Int(Double(busy.count - 1) * q))] }
        let (q1, q2, q3) = (cut(0.25), cut(0.5), cut(0.75))
        return { count in count <= 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4 }
    }

    // MARK: Drawing

    private func gridView(_ grid: Grid, width: CGFloat) -> some View {
        let step = Self.cell + Self.gap
        // In the hour view the 24 columns spread over the width.
        let columnStep = mode == .byHour ? max(step, (width - Self.labelWidth) / 24) : step
        let cellWidth = mode == .byHour ? columnStep - Self.gap : Self.cell
        return ZStack(alignment: .topLeading) {
            ForEach(Array(grid.columnLabels.enumerated()), id: \.offset) { _, label in
                Text(label.text).appFont(.system(size: 10)).foregroundStyle(theme.text3.color).fixedSize()
                    .offset(x: Self.labelWidth + CGFloat(label.column) * columnStep)
            }
            ForEach(Array(grid.rowLabels.enumerated()), id: \.offset) { row, text in
                Text(text).appFont(.system(size: 10)).foregroundStyle(theme.text3.color).fixedSize()
                    .frame(height: Self.cell).offset(y: 14 + CGFloat(row) * step)
            }
            ForEach(grid.columns.indices, id: \.self) { column in
                ForEach(grid.columns[column].indices, id: \.self) { index in
                    let cell = grid.columns[column][index]
                    let on = hovered == cell
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(color(grid.levels(cell.count)))
                        .overlay(RoundedRectangle(cornerRadius: 2.5, style: .continuous).strokeBorder(theme.text.color.opacity(on ? 0.8 : 0), lineWidth: 1))
                        .frame(width: cellWidth, height: Self.cell)
                        .scaleEffect(on && !reduceMotion ? 1.18 : 1)
                        .offset(x: Self.labelWidth + CGFloat(column) * columnStep, y: 14 + CGFloat(cell.row) * step)
                        .onHover { inside in
                            withAnimation(Motion.snap(reduceMotion)) { hovered = inside ? cell : (hovered == cell ? nil : hovered) }
                        }
                        .accessibilityLabel("\(cell.label), \(cell.count) \(unit)")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .id(mode) // a fresh grid per view, so a hovered cell of the other view never stays
        .transition(.opacity)
    }

    private func color(_ level: Int) -> Color {
        level == 0 ? theme.fill3.color : theme.success.color.opacity([0, 0.3, 0.52, 0.76, 1][min(level, 4)])
    }

    // MARK: Words

    private var summary: String {
        guard mode == .calendar else { return "\(events.count) \(unit) by weekday and hour" }
        let yearAgo = calendar.date(byAdding: .year, value: -1, to: lastDay) ?? .distantPast
        let streak = ActivityStreak.days(events, calendar: calendar) // 2026-11-02
        return "\(events.filter { $0 > yearAgo }.count) \(unit) in the last year" + (streak > 1 ? " · \(streak)-day streak" : "")
    }

    private var peak: String {
        let counts = Dictionary(grouping: events) { calendar.startOfDay(for: $0) }.mapValues(\.count)
        guard let best = counts.max(by: { $0.value < $1.value || ($0.value == $1.value && $0.key < $1.key) }) else { return "No \(unit) yet" }
        return "Peak \(best.key.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())) · \(best.value)"
    }
}
