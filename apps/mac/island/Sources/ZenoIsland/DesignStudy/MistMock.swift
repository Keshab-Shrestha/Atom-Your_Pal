import SwiftUI
import ZenoIslandCore

// Direction B, Mist: a pale, cool daylight glass with Wisp's own ink (#1B2A44, the colour of its eyes) as the only
// accent. Wisp's words are set in New York, so its voice reads differently from the interface around it. The glow
// belongs to Wisp alone and to the live microphone.

enum Mist {
    static let base = hx(0xEDF1F6)
    static let top = hx(0xF8FAFD)
    static let ink = hx(0x1B2A44)
    static let ink2 = hx(0x4F5D78)
    static let ink3 = hx(0x626E87)
    static let glow = hx(0x8FD3FF)
    static let amber = hx(0xA86200)
    static let tile = Color.white.opacity(0.72)
    static let line = hx(0x1B2A44, 0.08)

    static let radiusPanel: CGFloat = 24
    static let radiusTile: CGFloat = 16
    static let size = CGSize(width: 380, height: 540)

    static func voice(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .serif) }
}

struct MistPanel: View {
    let page: StudyPage

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            StudyMenuBar(light: true) { MistMenuItem() }
                .frame(width: Mist.size.width + 40)
            VStack(spacing: 0) {
                MistHeader(page: page)
                switch page {
                case .conversation: MistConversation()
                case .settings: MistSettings()
                }
            }
            .frame(width: Mist.size.width, height: Mist.size.height, alignment: .top)
            .background(MistSurface())
            .padding(.trailing, 64)
        }
        .environment(\.colorScheme, .light)
    }
}

private struct MistSurface: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Mist.radiusPanel, style: .continuous)
        ZStack {
            shape.fill(LinearGradient(colors: [Mist.top, Mist.base], startPoint: .top, endPoint: .bottom))
            shape.strokeBorder(LinearGradient(colors: [.white, Mist.line], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        }
        .shadow(color: hx(0x1B2A44, 0.18), radius: 30, y: 16)
        .shadow(color: hx(0x1B2A44, 0.10), radius: 2, y: 1)
    }
}

/// The menu-bar item: Wisp in ink, the way template icons sit in a light menu bar.
private struct MistMenuItem: View {
    var body: some View {
        WispGlyph().fill(Mist.ink, style: FillStyle(eoFill: true)).frame(width: 14, height: 15)
            .frame(width: 26, height: 22)
            .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(hx(0x1B2A44, 0.10)))
    }
}

private struct MistHeader: View {
    let page: StudyPage

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                HStack {
                    MistIcon(symbol: "person.2")
                    Spacer()
                    MistIcon(symbol: "xmark")
                }
                VStack(spacing: 0) {
                    ZStack {
                        Circle().fill(Mist.glow.opacity(0.5)).frame(width: 60).blur(radius: 18)
                        WispView(mood: page == .conversation ? .speaking : .resting, time: 0.5, facing: 1, size: 40, glow: 0.7, style: .ghost)
                    }
                    .frame(width: 60, height: 52)
                    Text(page == .conversation ? "Speaking" : "Ready, on Claude Opus 5.5")
                        .font(.system(size: 11.5, weight: .medium)).foregroundStyle(Mist.ink2)
                }
            }
            MistToggle(selected: page)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 4)
    }
}

private struct MistIcon: View {
    let symbol: String
    var body: some View {
        Image(systemName: symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(Mist.ink2)
            .frame(width: 26, height: 26)
            .background(Circle().fill(hx(0x1B2A44, 0.06)))
    }
}

/// Two places, one ink pill that slides between them.
private struct MistToggle: View {
    let selected: StudyPage
    var body: some View {
        HStack(spacing: 0) {
            item("Talk", on: selected == .conversation)
            item("Settings", on: selected == .settings)
        }
        .padding(3)
        .background(Capsule().fill(hx(0x1B2A44, 0.06)))
    }

    private func item(_ title: String, on: Bool) -> some View {
        Text(title)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(on ? Color.white : Mist.ink2)
            .frame(width: 78, height: 24)
            .background(Capsule().fill(on ? Mist.ink : .clear))
    }
}

private struct MistConversation: View {
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                MistAsk(text: StudyCopy.ask1)
                Text(StudyCopy.reply1).font(Mist.voice(15)).foregroundStyle(Mist.ink2).lineSpacing(4)
                MistAsk(text: StudyCopy.ask2)
                StreamingText(settled: StudyCopy.reply2Settled, arriving: StudyCopy.reply2Arriving,
                              font: Mist.voice(15), color: Mist.ink, caret: hx(0x2E9BE0))
                    .lineSpacing(4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            Spacer(minLength: 0)
            MistComposer().padding(.horizontal, 14).padding(.bottom, 14)
        }
    }
}

/// What you said: plain interface type on a white slip, right-aligned.
private struct MistAsk: View {
    let text: String
    var body: some View {
        HStack {
            Spacer(minLength: 36)
            Text(text).font(.system(size: 12.5)).foregroundStyle(Mist.ink)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .shadow(color: hx(0x1B2A44, 0.07), radius: 3, y: 1)
        }
    }
}

private struct MistComposer: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus").font(.system(size: 12, weight: .semibold)).foregroundStyle(Mist.ink3)
                .accessibilityLabel("New conversation")
            Text("Type, or hold ⌃⌥ and speak").font(.system(size: 12.5)).foregroundStyle(Mist.ink3)
            Spacer()
            Image(systemName: "mic.fill").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Mist.ink))
        }
        .padding(.leading, 14).padding(.trailing, 5)
        .frame(height: 40)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Mist.line, lineWidth: 0.6))
        .shadow(color: hx(0x1B2A44, 0.06), radius: 6, y: 2)
    }
}

private struct MistSettings: View {
    var body: some View {
        VStack(spacing: 8) {
            MistModelTile()
            HStack(spacing: 8) {
                MistTile(title: "Shortcuts") {
                    HStack(spacing: 5) { MistKey("⌃"); MistKey("⌥") }
                } detail: { Text("Hold to talk").font(.system(size: 11)).foregroundStyle(Mist.ink3) }
                MistTile(title: "Wisp") {
                    HStack(spacing: 6) {
                        WispView(mood: .resting, time: 0.4, size: 22, glow: 0.4, style: .ghost).frame(width: 26, height: 26)
                        Text("Medium").font(Mist.voice(17, .medium)).foregroundStyle(Mist.ink)
                    }
                } detail: { Text("Floats along the Dock").font(.system(size: 11)).foregroundStyle(Mist.ink3) }
            }
            HStack(spacing: 8) {
                MistTile(title: "Memory") {
                    Text("3 facts").font(Mist.voice(17, .medium)).foregroundStyle(Mist.ink)
                } detail: { Text("Kept on this Mac").font(.system(size: 11)).foregroundStyle(Mist.ink3) }
                MistTile(title: "Dictation") {
                    Text("Hold or tap").font(Mist.voice(17, .medium)).foregroundStyle(Mist.ink)
                } detail: { Text("Right ⌥⌘").font(.system(size: 11)).foregroundStyle(Mist.ink3) }
            }
            MistList()
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
    }
}

private struct MistKey: View {
    let key: String
    init(_ key: String) { self.key = key }
    var body: some View {
        Text(key).font(.system(size: 14, weight: .medium)).foregroundStyle(Mist.ink)
            .frame(width: 28, height: 26)
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Mist.line, lineWidth: 0.8))
            .shadow(color: hx(0x1B2A44, 0.12), radius: 0, y: 1.5)
    }
}

private struct MistTile<Value: View, Detail: View>: View {
    let title: String
    @ViewBuilder let value: Value
    @ViewBuilder let detail: Detail
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(Mist.ink3)
            value.frame(height: 26, alignment: .leading)
            detail
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: Mist.radiusTile, style: .continuous).fill(Mist.tile))
        .overlay(RoundedRectangle(cornerRadius: Mist.radiusTile, style: .continuous).strokeBorder(Color.white, lineWidth: 0.8))
    }
}

private struct MistModelTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Text("Claude Opus 5.5").font(Mist.voice(19, .semibold)).foregroundStyle(Mist.ink)
                Spacer()
                Text("Change").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Mist.ink)
                    .padding(.horizontal, 10).frame(height: 22)
                    .background(Capsule().strokeBorder(hx(0x1B2A44, 0.25), lineWidth: 0.8))
            }
            HStack(spacing: 14) {
                MistMeter(label: "5-hour", value: 0.42)
                MistMeter(label: "Weekly", value: 0.86)
            }
            Text("On your Claude plan. Mac mini mic, voice ready.").font(.system(size: 11)).foregroundStyle(Mist.ink3)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: Mist.radiusTile, style: .continuous).fill(Mist.tile))
        .overlay(RoundedRectangle(cornerRadius: Mist.radiusTile, style: .continuous).strokeBorder(Color.white, lineWidth: 0.8))
    }
}

private struct MistMeter: View {
    let label: String
    let value: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(.system(size: 11)).foregroundStyle(Mist.ink2)
                Spacer()
                Text("\(Int(value * 100))%").font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundStyle(value > 0.8 ? Mist.amber : Mist.ink)
            }
            GeometryReader { p in
                ZStack(alignment: .leading) {
                    Capsule().fill(hx(0x1B2A44, 0.08))
                    Capsule().fill(value > 0.8 ? Mist.amber : Mist.ink).frame(width: p.size.width * value)
                }
            }
            .frame(height: 3)
        }
    }
}

private struct MistList: View {
    var body: some View {
        let pages = [StudyCopy.talking[0], StudyCopy.look[0], StudyCopy.mind[1]]
        VStack(spacing: 0) {
            ForEach(Array(pages.enumerated()), id: \.offset) { i, page in
                if i > 0 { Rectangle().fill(Mist.line).frame(height: 0.5).padding(.leading, 14) }
                HStack {
                    Text(page.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Mist.ink)
                    Spacer()
                    Text(page.value).font(.system(size: 11.5)).foregroundStyle(Mist.ink3)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Mist.ink3)
                }
                .padding(.horizontal, 14)
                .frame(height: 32)
            }
        }
        .background(RoundedRectangle(cornerRadius: Mist.radiusTile, style: .continuous).fill(Mist.tile))
        .overlay(RoundedRectangle(cornerRadius: Mist.radiusTile, style: .continuous).strokeBorder(Color.white, lineWidth: 0.8))
    }
}
