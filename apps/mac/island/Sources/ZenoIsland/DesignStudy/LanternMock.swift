import SwiftUI
import ZenoIslandCore

// Direction A, Lantern: deep night glass, cool greys, and one colour, Wisp's own light (#8FD3FF). Listening,
// thinking and speaking change how bright and how alive that light is, never its hue. Amber and coral appear only
// for "needs you" and "went wrong".

enum Lantern {
    static let night = hx(0x10162A)
    static let nightTop = hx(0x161F3A)
    static let text = hx(0xEAF1FF)
    static let text2 = hx(0xA7B4CC)
    static let text3 = hx(0x7F8BA6)
    static let light = hx(0x8FD3FF)
    static let lightCore = hx(0xD6F1FF)
    static let amber = hx(0xFFC069)
    static let well = Color.white.opacity(0.045)
    static let wellLine = Color.white.opacity(0.07)
    static let hair = Color.white.opacity(0.07)

    static let radiusPanel: CGFloat = 22
    static let radiusWell: CGFloat = 14
    static let size = CGSize(width: 380, height: 540)

    static func title(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .semibold, design: .rounded) }
}

/// The panel surface: night glass lit from Wisp's corner, a rim that catches light at the top, a two-layer shadow.
struct LanternSurface: View {
    /// How brightly Wisp burns: about 0.15 at rest, 0.3 listening, 0.4 speaking.
    var brightness: Double = 0.3
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Lantern.radiusPanel, style: .continuous)
        ZStack {
            shape.fill(LinearGradient(colors: [Lantern.nightTop, Lantern.night], startPoint: .top, endPoint: .bottom))
            // Wisp's light falling on the glass from the header.
            shape.fill(RadialGradient(colors: [Lantern.light.opacity(brightness), Lantern.light.opacity(brightness * 0.28), Lantern.light.opacity(0.0)],
                                      center: UnitPoint(x: 0.1, y: 0.06), startRadius: 2, endRadius: 280))
            shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.16), .white.opacity(0.05)], startPoint: .top, endPoint: .bottom), lineWidth: 0.8)
        }
        .shadow(color: .black.opacity(0.45), radius: 28, y: 18)
        .shadow(color: .black.opacity(0.30), radius: 3, y: 1)
    }
}

struct LanternPanel: View {
    let page: StudyPage

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            StudyMenuBar { LanternMenuItem(listening: false) }
                .frame(width: Lantern.size.width + 40)
            VStack(spacing: 0) {
                LanternHeader(page: page)
                Rectangle().fill(Lantern.hair).frame(height: 0.5)
                switch page {
                case .conversation: LanternConversation()
                case .settings: LanternSettings()
                }
            }
            .frame(width: Lantern.size.width, height: Lantern.size.height, alignment: .top)
            .background(LanternSurface(brightness: page == .conversation ? 0.42 : 0.16))
            .padding(.trailing, 64)
        }
        .environment(\.colorScheme, .dark)
    }
}

/// The menu-bar item: a tiny Wisp silhouette in template white; while ZENO listens it gains the light.
struct LanternMenuItem: View {
    let listening: Bool

    var body: some View {
        WispGlyph()
            .fill(listening ? Lantern.light : Color.white.opacity(0.92), style: FillStyle(eoFill: true))
            .frame(width: 14, height: 15)
            .shadow(color: Lantern.light.opacity(listening ? 0.9 : 0), radius: 4)
            .frame(width: 26, height: 22)
            .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.white.opacity(0.18)))
    }
}

/// Wisp's outline as a single shape: a dome with a three-scallop hem. Used for the menu-bar item.
struct WispGlyph: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height, x = r.minX, y = r.minY
        p.move(to: CGPoint(x: x, y: y + h * 0.5))
        p.addCurve(to: CGPoint(x: x + w, y: y + h * 0.5), control1: CGPoint(x: x, y: y - h * 0.16), control2: CGPoint(x: x + w, y: y - h * 0.16))
        p.addLine(to: CGPoint(x: x + w, y: y + h * 0.9))
        let step = w / 3
        for i in 0..<3 {
            let right = x + w - CGFloat(i) * step
            p.addQuadCurve(to: CGPoint(x: right - step, y: y + h * 0.9), control: CGPoint(x: right - step / 2, y: y + h * 1.12))
        }
        p.closeSubpath()
        // Eyes, cut out.
        let eye = w * 0.15
        p.addEllipse(in: CGRect(x: x + w * 0.28, y: y + h * 0.34, width: eye, height: eye * 1.25))
        p.addEllipse(in: CGRect(x: x + w * 0.57, y: y + h * 0.34, width: eye, height: eye * 1.25))
        return p
    }
}

private struct LanternHeader: View {
    let page: StudyPage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                WispView(mood: page == .conversation ? .speaking : .resting, time: 0.45, facing: 1, size: 34, glow: 1.5, style: .ghost)
                    .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text(page == .conversation ? "Speaking" : "Ready").font(Lantern.title()).foregroundStyle(Lantern.text)
                    Text("Claude Opus 5.5").font(.system(size: 11.5)).foregroundStyle(Lantern.text2)
                }
                Spacer()
                LanternIcon(symbol: "person.2")
                LanternIcon(symbol: "xmark")
            }
            HStack(spacing: 20) {
                LanternTab(title: "Conversation", selected: page == .conversation)
                LanternTab(title: "Settings", selected: page == .settings)
                Spacer()
                if page == .conversation {
                    Image(systemName: "square.and.pencil").font(.system(size: 12, weight: .medium)).foregroundStyle(Lantern.text3)
                        .accessibilityLabel("New conversation")
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 10)
    }
}

private struct LanternIcon: View {
    let symbol: String
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Lantern.text2)
            .frame(width: 26, height: 26)
            .background(Circle().fill(Color.white.opacity(0.06)))
    }
}

/// A tab is a word; the selected one has a small light lying under it, the way a lantern lights the floor.
private struct LanternTab: View {
    let title: String
    let selected: Bool
    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: 12.5, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? Lantern.text : Lantern.text3)
            Capsule().fill(selected ? Lantern.light : .clear).frame(width: 16, height: 2.5)
                .shadow(color: Lantern.light.opacity(selected ? 0.9 : 0), radius: 4)
        }
    }
}

private struct LanternConversation: View {
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                LanternAsk(text: StudyCopy.ask1)
                // Earlier turns recede: the light stays with the newest words.
                Text(StudyCopy.reply1).font(.system(size: 13.5)).foregroundStyle(Lantern.text2).lineSpacing(3.5)
                LanternAsk(text: StudyCopy.ask2)
                StreamingText(settled: StudyCopy.reply2Settled, arriving: StudyCopy.reply2Arriving,
                              font: .system(size: 13.5), color: Lantern.text, caret: Lantern.light)
                    .lineSpacing(3.5)
                    .background(alignment: .leading) {
                        // A faint pool of light under the reply Wisp is speaking now.
                        Ellipse().fill(Lantern.light.opacity(0.10)).frame(width: 300, height: 90).blur(radius: 28).offset(x: -30)
                    }
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            Spacer(minLength: 0)
            LanternComposer().padding(.horizontal, 14).padding(.bottom, 14)
        }
    }
}

private struct LanternAsk: View {
    let text: String
    var body: some View {
        HStack {
            Spacer(minLength: 56)
            Text(text)
                .font(.system(size: 12.5))
                .foregroundStyle(Lantern.text2)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white.opacity(0.055)))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5))
        }
    }
}

/// A reply still arriving: settled words, the newest ones fading in, and a point of Wisp's light where the next word
/// lands. The glow is the same text drawn again with only the light visible, blurred behind it, so it sits exactly on
/// the caret wherever the line wraps.
struct StreamingText: View {
    let settled: String
    let arriving: [String]
    let font: Font
    let color: Color
    let caret: Color

    private func text(caretOnly: Bool) -> Text {
        let fades = [0.75, 0.5, 0.28]
        var t = Text(settled).foregroundColor(caretOnly ? .clear : color)
        for (i, word) in arriving.enumerated() {
            t = t + Text(" " + word).foregroundColor(caretOnly ? .clear : color.opacity(fades[min(i, fades.count - 1)]))
        }
        let dot = Text(Image(systemName: "circle.fill")).font(.system(size: 6.5)).baselineOffset(1.5).foregroundColor(caret)
        return (t + Text(" ") + dot).font(font)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            text(caretOnly: true).blur(radius: 6)
            text(caretOnly: true).blur(radius: 6)
            text(caretOnly: true).blur(radius: 2.5)
            text(caretOnly: false)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct LanternComposer: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("Ask Wisp, or hold ⌃⌥ to talk").font(.system(size: 12.5)).foregroundStyle(Lantern.text3)
            Spacer()
            ZStack {
                Circle().fill(RadialGradient(colors: [Lantern.lightCore, Lantern.light, Lantern.light.opacity(0.5)], center: .center, startRadius: 1, endRadius: 15))
                Image(systemName: "mic.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(hx(0x0B1B33))
            }
            .frame(width: 28, height: 28)
            .shadow(color: Lantern.light.opacity(0.55), radius: 8)
        }
        .padding(.leading, 16).padding(.trailing, 6)
        .frame(height: 40)
        .background(Capsule().fill(Color.white.opacity(0.05)))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 0.6))
    }
}

private struct LanternSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LanternNow()
            LanternGroup(pages: StudyCopy.talking)
            LanternGroup(pages: StudyCopy.look + StudyCopy.mind)
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
    }
}

/// What Status used to hold, folded into the top of Settings: the model, the plan's meters, the microphone and voice.
private struct LanternNow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Claude plan").font(Lantern.title(14)).foregroundStyle(Lantern.text)
                    Text("Replies from Opus 5.5").font(.system(size: 11)).foregroundStyle(Lantern.text2)
                }
                Spacer()
                Text("Change model").font(.system(size: 12, weight: .medium)).foregroundStyle(Lantern.light)
            }
            VStack(spacing: 8) {
                LanternMeter(label: "5-hour", value: 0.42, color: Lantern.light)
                LanternMeter(label: "Weekly", value: 0.86, color: Lantern.amber)
            }
            HStack(spacing: 14) {
                Label("Mac mini mic", systemImage: "mic").labelStyle(LanternSmallLabel())
                Label("Voice ready", systemImage: "waveform").labelStyle(LanternSmallLabel())
                Spacer()
                Text("2.7 s to first sound").font(.system(size: 11)).foregroundStyle(Lantern.text3)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Lantern.radiusWell, style: .continuous).fill(Lantern.well))
        .overlay(RoundedRectangle(cornerRadius: Lantern.radiusWell, style: .continuous).strokeBorder(Lantern.wellLine, lineWidth: 0.5))
    }
}

private struct LanternSmallLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.font(.system(size: 10, weight: .medium)).foregroundStyle(Lantern.text3)
            configuration.title.font(.system(size: 11)).foregroundStyle(Lantern.text2)
        }
    }
}

private struct LanternMeter: View {
    let label: String
    let value: Double
    let color: Color
    var body: some View {
        HStack(spacing: 10) {
            Text(label).font(.system(size: 11.5)).foregroundStyle(Lantern.text2).frame(width: 48, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08))
                    Capsule().fill(color).frame(width: proxy.size.width * value)
                        .shadow(color: color.opacity(0.6), radius: 4)
                }
            }
            .frame(height: 4)
            Text("\(Int(value * 100))%").font(.system(size: 11.5, weight: .medium).monospacedDigit())
                .foregroundStyle(value > 0.8 ? Lantern.amber : Lantern.text2).frame(width: 32, alignment: .trailing)
        }
    }
}

private struct LanternGroup: View {
    let pages: [StudyCopy.Page]
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(pages.enumerated()), id: \.offset) { i, page in
                if i > 0 { Rectangle().fill(Lantern.hair).frame(height: 0.5).padding(.leading, 40) }
                HStack(spacing: 12) {
                    Image(systemName: page.symbol).font(.system(size: 12.5, weight: .regular)).foregroundStyle(Lantern.text2)
                        .frame(width: 18)
                    Text(page.title).font(.system(size: 13)).foregroundStyle(Lantern.text)
                    Spacer()
                    Text(page.value).font(.system(size: 12)).foregroundStyle(Lantern.text3)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Lantern.text3.opacity(0.7))
                }
                .padding(.horizontal, 12)
                .frame(height: 34)
            }
        }
        .background(RoundedRectangle(cornerRadius: Lantern.radiusWell, style: .continuous).fill(Lantern.well))
        .overlay(RoundedRectangle(cornerRadius: Lantern.radiusWell, style: .continuous).strokeBorder(Lantern.wellLine, lineWidth: 0.5))
    }
}
