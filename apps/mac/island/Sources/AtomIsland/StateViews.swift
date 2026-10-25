import SwiftUI
import AtomIslandCore

// The states a list or a page must show besides "full" (design/atom-design-system, section 9): loading, empty, error and
// edge. Loading and empty are different states: a page that has not heard from ATOM yet must not say "nothing here".

/// An empty list: a short headline, one sentence that says what will appear and why, and optionally one action.
struct EmptyStateView: View {
    let title: String
    let detail: String
    var action: (title: String, symbol: String?, run: () -> Void)? = nil
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
            Text(detail).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            if let action { QuietButton(title: action.title, symbol: action.symbol, action: action.run).padding(.top, 4) }
        }
        .padding(.top, 6)
        .frame(maxWidth: 460, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A page or list that has not heard from ATOM yet. After 15 seconds it says it is taking longer than expected and offers
/// a way to ask again, so a stopped runtime never looks like a page that is still loading.
struct LoadingStateView: View {
    let text: String
    var retry: (() -> Void)? = nil
    /// Demonstration views can keep the loading sample stable without starting a timeout.
    private let automaticallyShowsSlow: Bool
    /// How long before the "taking longer" line appears.
    static let slowAfter: Duration = .seconds(15)
    @State private var slow: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    /// `slow` starts the view in its "taking longer" form: for the gallery.
    init(text: String, retry: (() -> Void)? = nil, slow: Bool = false, automaticallyShowsSlow: Bool = true) {
        self.text = text
        self.retry = retry
        self.automaticallyShowsSlow = automaticallyShowsSlow
        _slow = State(initialValue: slow)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                // `ImageRenderer` cannot draw a spinner.
                if snapshot { Image(systemName: "ellipsis").appFont(.system(size: 11)).foregroundStyle(theme.text3.color) } else { ProgressView().controlSize(.small) }
                Text(text).appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color)
            }
            if slow {
                Text("This is taking longer than expected. ATOM may still be starting, or it may have stopped.")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                if let retry { QuietButton(title: "Ask again", symbol: "arrow.clockwise", action: retry) }
            }
        }
        .padding(.top, 6)
        .frame(maxWidth: 460, alignment: .leading)
        .task {
            guard automaticallyShowsSlow, !slow else { return }
            try? await Task.sleep(for: Self.slowAfter)
            if !Task.isCancelled { slow = true }
        }
        .accessibilityElement(children: .combine)
    }
}
