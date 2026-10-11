import SwiftUI
import ZenoIslandCore

// Direction C, Halo: a true-black island that grows out of the menu bar (square shoulders, deep rounded hem). Its rim
// is lit in the colour of what Pal is doing, one colour at a time: listening cyan, thinking violet, speaking ice,
// asking amber, a problem coral, done mint. At rest the rim goes dark. Big rounded type names the state.

enum Halo {
    static let text = Color.white.opacity(0.94)
    static let text2 = Color.white.opacity(0.64)
    static let text3 = Color.white.opacity(0.48)
    static let raised = Color.white.opacity(0.07)
    static let line = Color.white.opacity(0.08)

    static let listening = hx(0x5BE3FF)
    static let thinking = hx(0xA98BFF)
    static let speaking = hx(0x9AD8FF)
    static let asking = hx(0xFFC069)
    static let problem = hx(0xFF7A6B)
    static let done = hx(0x6EE7B7)
    static let amber = hx(0xFFC069)

    static let size = CGSize(width: 380, height: 540)
    static let shape = UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 30, bottomTrailingRadius: 30, topTrailingRadius: 12, style: .continuous)
}

struct HaloPanel: View {
    let page: StudyPage

    var body: some View {
        let lit: Color? = page == .conversation ? Halo.speaking : nil
        VStack(alignment: .trailing, spacing: 0) {
            StudyMenuBar { HaloMenuItem(color: lit) }
                .frame(width: Halo.size.width + 40)
            VStack(spacing: 0) {
                HaloStage(page: page, lit: lit)
                switch page {
                case .conversation: HaloConversation()
                case .settings: HaloSettings()
                }
            }
            .frame(width: Halo.size.width, height: Halo.size.height, alignment: .top)
            .background(HaloSurface(lit: lit))
            .padding(.trailing, 64)
            .padding(.top, 2)
        }
        .environment(\.colorScheme, .dark)
    }
}

/// Black glass with the state's colour running round the rim: bright where it starts, fading as it goes.
private struct HaloSurface: View {
    let lit: Color?
    var body: some View {
        ZStack {
            Halo.shape.fill(Color.black)
            if let lit {
                Halo.shape.fill(RadialGradient(colors: [lit.opacity(0.16), .clear], center: .top, startRadius: 0, endRadius: 240))
                Halo.shape.strokeBorder(AngularGradient(colors: [lit, lit.opacity(0.15), lit.opacity(0.05), lit.opacity(0.35), lit],
                                                        center: .center, angle: .degrees(-90)), lineWidth: 1.4)
                    .blur(radius: 3)
                Halo.shape.strokeBorder(AngularGradient(colors: [lit, lit.opacity(0.1), lit.opacity(0.02), lit.opacity(0.3), lit],
                                                        center: .center, angle: .degrees(-90)), lineWidth: 1)
            } else {
                Halo.shape.strokeBorder(Color.white.opacity(0.10), lineWidth: 0.8)
            }
        }
        .shadow(color: (lit ?? .black).opacity(lit == nil ? 0.5 : 0.35), radius: 26, y: 12)
        .shadow(color: .black.opacity(0.4), radius: 3, y: 1)
    }
}

/// The menu-bar item: a small pill that fills with the state's colour while Pal is busy (and stays template white at rest).
private struct HaloMenuItem: View {
    let color: Color?
    var body: some View {
        HStack(spacing: 5) {
            PalGlyph().fill(color == nil ? Color.white : Color.black, style: FillStyle(eoFill: true)).frame(width: 12, height: 13)
            if color != nil {
                HaloBars(color: .black).frame(width: 14, height: 10)
            }
        }
        .padding(.horizontal, 7)
        .frame(height: 20)
        .background(Capsule().fill(color ?? Color.white.opacity(0.18)))
        .shadow(color: (color ?? .clear).opacity(0.8), radius: 5)
    }
}

private struct HaloBars: View {
    let color: Color
    var body: some View {
        HStack(alignment: .center, spacing: 1.5) {
            ForEach([0.45, 0.85, 0.6, 1.0, 0.5], id: \.self) { h in
                Capsule().fill(color).frame(width: 1.8, height: 10 * h)
            }
        }
    }
}

private struct HaloStage: View {
    let page: StudyPage
    let lit: Color?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            PalView(mood: page == .conversation ? .speaking : .resting, time: 0.5, facing: 1, size: 46)
                .frame(width: 54, height: 54)
            VStack(alignment: .leading, spacing: 2) {
                Text(page == .conversation ? "Speaking" : "Ready")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(lit ?? Halo.text)
                Text("Claude Opus 5.5").font(.system(size: 12, weight: .medium)).foregroundStyle(Halo.text2)
            }
            Spacer()
            HStack(spacing: 2) {
                HaloTab(symbol: "bubble.left.fill", on: page == .conversation)
                HaloTab(symbol: "gearshape.fill", on: page == .settings)
                HaloTab(symbol: "person.2.fill", on: false)
            }
            .padding(3)
            .background(Capsule().fill(Halo.raised))
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }
}

private struct HaloTab: View {
    let symbol: String
    let on: Bool
    var body: some View {
        Image(systemName: symbol).font(.system(size: 11.5))
            .foregroundStyle(on ? Color.black : Halo.text2)
            .frame(width: 30, height: 24)
            .background(Capsule().fill(on ? Color.white : .clear))
    }
}

private struct HaloConversation: View {
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                HaloAsk(text: StudyCopy.ask1)
                Text(StudyCopy.reply1).font(.system(size: 13.5)).foregroundStyle(Halo.text2).lineSpacing(3)
                HaloAsk(text: StudyCopy.ask2)
                HStack(alignment: .top, spacing: 10) {
                    Capsule().fill(Halo.speaking).frame(width: 2.5).shadow(color: Halo.speaking, radius: 4)
                    StreamingText(settled: StudyCopy.reply2Settled, arriving: StudyCopy.reply2Arriving,
                                  font: .system(size: 15, weight: .medium), color: Halo.text, caret: Halo.speaking)
                        .lineSpacing(3)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 18)
            .padding(.top, 4)
            Spacer(minLength: 0)
            HaloComposer().padding(.horizontal, 14).padding(.bottom, 16)
        }
    }
}

/// What you said, as a quiet line with a chevron, like a prompt you typed.
private struct HaloAsk: View {
    let text: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .heavy)).foregroundStyle(Halo.text3)
            Text(text).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Halo.text3)
        }
    }
}

private struct HaloComposer: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("Hold ⌃⌥ to talk, or type").font(.system(size: 12.5)).foregroundStyle(Halo.text3)
            Spacer()
            HaloBars(color: Halo.speaking).frame(width: 18, height: 12)
        }
        .padding(.horizontal, 16)
        .frame(height: 42)
        .background(Capsule().fill(Halo.raised))
    }
}

private struct HaloSettings: View {
    private let cells: [StudyCopy.Page] = StudyCopy.talking + StudyCopy.look + StudyCopy.mind
    var body: some View {
        VStack(spacing: 12) {
            HaloNow()
            let all = cells + [StudyCopy.Page(symbol: "person.2", title: "Helpers", value: "Sid is reading")]
            VStack(spacing: 0) {
                ForEach(0..<(all.count / 2), id: \.self) { row in
                    if row > 0 { Rectangle().fill(Halo.line).frame(height: 0.5) }
                    HStack(spacing: 0) {
                        HaloCell(page: all[row * 2])
                        Rectangle().fill(Halo.line).frame(width: 0.5, height: 34)
                        HaloCell(page: all[row * 2 + 1])
                    }
                }
            }
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Halo.line, lineWidth: 0.6))
            HStack {
                Text("Last turn").font(.system(size: 11.5, weight: .medium)).foregroundStyle(Halo.text2)
                Spacer()
                Text("heard in 0.6 s, first sound in 2.7 s").font(.system(size: 11.5).monospacedDigit()).foregroundStyle(Halo.text3)
            }
            .padding(.horizontal, 6)
        }
        .padding(.horizontal, 14)
    }
}

/// The model and the plan's two windows as rings: the outer ring the 5-hour window, the inner the week.
private struct HaloNow: View {
    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                ring(0.42, color: Halo.speaking, size: 48)
                ring(0.86, color: Halo.amber, size: 30)
            }
            .frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 3) {
                Text("Claude plan").font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundStyle(Halo.text)
                Text("42% of 5 hours, 86% of the week").font(.system(size: 11.5)).foregroundStyle(Halo.text2)
                Text("Mac mini mic, voice ready").font(.system(size: 11.5)).foregroundStyle(Halo.text3)
            }
            Spacer()
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Halo.raised))
    }

    private func ring(_ value: Double, color: Color, size: CGFloat) -> some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.1), lineWidth: 4)
            Circle().trim(from: 0, to: value).stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}

/// A cell in the settings keypad: no card, just the icon, the name and the current value; hairlines divide the grid.
private struct HaloCell: View {
    let page: StudyCopy.Page
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: page.symbol).font(.system(size: 13, weight: .medium)).foregroundStyle(Halo.text2)
                .frame(width: 18).padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(page.title).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Halo.text)
                Text(page.value).font(.system(size: 11)).foregroundStyle(Halo.text3).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 58)
    }
}
