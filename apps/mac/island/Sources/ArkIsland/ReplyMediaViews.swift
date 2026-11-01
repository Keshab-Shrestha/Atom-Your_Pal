import AppKit
import Charts
import SwiftUI
import ArkIslandCore

/// A ```chart block drawn with Swift Charts (2026-11-02): bars, lines or a ring, with a legend when there is more than
/// one series and "Copy table" for the numbers.
struct ReplyChartView: View {
    let chart: ReplyChart
    let copyEnabled: Bool
    @Environment(\.theme) private var theme

    private struct Point: Identifiable {
        let id: Int
        let label: String
        let series: String
        let value: Double
    }

    private var points: [Point] {
        chart.series.enumerated().flatMap { s, series in
            series.values.enumerated().map { i, value in Point(id: s * ReplyChart.maxLabels + i, label: chart.labels[i], series: series.name, value: value) }
        }
    }

    var body: some View {
        let table = chart.table
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(chart.title ?? "Chart").appFont(.system(size: 13, weight: .semibold))
                Spacer()
                ChatCopyControl(title: "Copy table", choices: MarkdownCopy.Format.allCases.map { format in
                    ChatCopyControl.Choice(title: format.title) { MarkdownCopy.table(header: table.header, rows: table.rows, format: format) }
                })
                .disabled(!copyEnabled)
                .help(copyEnabled ? "Copy the chart's numbers as a table" : "Copy is available when this reply finishes")
            }
            plot.frame(height: chart.type == .pie ? 240 : 220)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: Radius.card).fill(theme.text.color.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).stroke(theme.border.color, lineWidth: 0.5))
        .frame(maxWidth: 640, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(table))
    }

    @ViewBuilder private var plot: some View {
        let many = chart.series.count > 1
        switch chart.type {
        case .pie:
            Chart(points) { p in
                SectorMark(angle: .value("Value", p.value), innerRadius: .ratio(0.55), angularInset: 1.5)
                    .foregroundStyle(by: .value("Label", p.label))
                    .cornerRadius(3)
            }
        case .bar:
            Chart(points) { p in
                BarMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .position(by: .value("Series", p.series))
                    .cornerRadius(3)
            }
            .chartForegroundStyleScale(range: palette)
            .chartLegend(many ? .visible : .hidden)
        case .line:
            Chart(points) { p in
                LineMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .interpolationMethod(.catmullRom)
                PointMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbolSize(18)
            }
            .chartForegroundStyleScale(range: palette)
            .chartLegend(many ? .visible : .hidden)
        }
    }

    /// The theme's accent first, so a one-series chart matches the app; the system colours after it.
    private var palette: [Color] { [theme.accent.color, .orange, .green, .pink, .purple, .teal] }

    private func accessibilityText(_ table: (header: [String], rows: [[String]])) -> String {
        let rows = table.rows.map { row in row.first.map { "\($0): " + row.dropFirst().joined(separator: ", ") } ?? "" }
        return "\(chart.type.rawValue.capitalized) chart\(chart.title.map { ", \($0)" } ?? ""). " + rows.joined(separator: "; ")
    }
}

/// An image line in a reply. A file on this Mac shows at once (a click opens it). A web image shows its address and loads
/// only on "Show image": a page's text could otherwise make ARK put the user's data into an image address that the window
/// would fetch on its own.
struct ReplyImageView: View {
    let image: ReplyImage
    @State private var web: WebState = .waiting
    @Environment(\.theme) private var theme

    private enum WebState: Equatable { case waiting, loading, loaded(NSImage), failed(String) }
    static let maxBytes = 20 * 1024 * 1024

    var body: some View {
        switch image.source {
        case .file(let url):
            if let picture = Self.file(url) {
                Button { NSWorkspace.shared.open(url) } label: { framed(picture) }
                    .buttonStyle(.plain)
                    .help("Open \(url.lastPathComponent)")
                    .accessibilityLabel(image.alt.isEmpty ? url.lastPathComponent : image.alt)
            } else {
                note("photo", "Image not found or too large: \(url.lastPathComponent)")
            }
        case .web(let url):
            switch web {
            case .loaded(let picture):
                framed(picture).accessibilityLabel(image.alt.isEmpty ? "Image from \(url.host ?? "the web")" : image.alt)
            case .waiting, .loading, .failed:
                webCard(url)
            }
        }
    }

    private func framed(_ picture: NSImage) -> some View {
        // The frame is the picture's own shape, at most 560 × 360, so the border hugs it.
        let size = picture.size, fit = min(1, 560 / max(size.width, 1), 360 / max(size.height, 1))
        return Image(nsImage: picture).resizable().interpolation(.high)
            .frame(width: size.width * fit, height: size.height * fit)
            .clipShape(RoundedRectangle(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).stroke(theme.border.color, lineWidth: 0.5))
    }

    private func webCard(_ url: URL) -> some View {
        HStack(spacing: 10) {
            Glyph(systemName: "photo").foregroundStyle(theme.text3.color)
            VStack(alignment: .leading, spacing: 2) {
                Text(image.alt.isEmpty ? "Image" : image.alt).appFont(.system(size: 13, weight: .medium)).lineLimit(1)
                Text(url.host ?? url.absoluteString).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
                if case .failed(let why) = web { Text(why).appFont(.system(size: 11)).foregroundStyle(theme.problem.color) }
            }
            Spacer(minLength: 8)
            if web == .loading { ProgressView().controlSize(.small) }
            else { QuietButton(title: "Show image", symbol: "eye") { load(url) } }
        }
        .padding(12)
        .frame(maxWidth: 560, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.card).fill(theme.text.color.opacity(0.05)))
        .help(url.absoluteString)
    }

    private func note(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol).appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
    }

    /// A file image up to `maxBytes`.
    static func file(_ url: URL) -> NSImage? {
        guard let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size <= maxBytes else { return nil }
        return NSImage(contentsOf: url)
    }

    /// One fetch with no cookies or cache, an image type, at most `maxBytes`.
    private func load(_ url: URL) {
        web = .loading
        Task {
            let session = URLSession(configuration: .ephemeral)
            defer { session.finishTasksAndInvalidate() }
            var request = URLRequest(url: url, timeoutInterval: 20)
            request.setValue("image/*", forHTTPHeaderField: "Accept")
            do {
                let (data, response) = try await session.data(for: request)
                let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { web = .failed("The site did not send the image."); return }
                guard type.hasPrefix("image/") else { web = .failed("That address is not an image."); return }
                guard data.count <= Self.maxBytes, let picture = NSImage(data: data) else { web = .failed("The image is too large or unreadable."); return }
                web = .loaded(picture)
            } catch {
                web = .failed("Could not load the image: \(error.localizedDescription)")
            }
        }
    }
}
