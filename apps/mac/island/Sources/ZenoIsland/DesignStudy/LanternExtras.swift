import SwiftUI
import ZenoIslandCore

// Direction A, Lantern, beyond the panel: Pal's bubble on the desktop, the work strip asking for approval, and the
// Helpers window. Same rule throughout: Pal's light marks what is live; amber marks what needs you.

struct LanternExtrasSheet: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("A. Lantern, on the desktop").font(.system(size: 22, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                Text("Pal's bubble, the approval strip and the Helpers window in the same light.")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.72))
            }
            HStack(alignment: .top, spacing: 36) {
                VStack(alignment: .leading, spacing: 26) {
                    LanternBubbleScene(mood: .listening) {
                        LanternBubble(lit: true) {
                            Text("…send the deck before the call").font(.system(size: 13.5)).foregroundStyle(Lantern.text)
                            Spacer(minLength: 8)
                            LightMeter(levels: [0.25, 0.5, 0.9, 0.6, 1.0, 0.7, 0.45, 0.8, 0.35])
                        }
                    }
                    LanternBubbleScene(mood: .resting) {
                        LanternBubble(lit: false) {
                            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Lantern.light)
                            Text("Typed 12 words").font(.system(size: 13.5, weight: .medium)).foregroundStyle(Lantern.text)
                            Spacer(minLength: 8)
                        }
                    }
                    LanternBubbleScene(mood: .worried) {
                        LanternBubble(lit: false, attention: true) {
                            Circle().fill(Lantern.amber).frame(width: 7, height: 7)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Copied to the clipboard").font(.system(size: 13, weight: .medium)).foregroundStyle(Lantern.text)
                                Text("A password field is focused. Paste it yourself.").font(.system(size: 11.5)).foregroundStyle(Lantern.text2)
                            }
                            Spacer(minLength: 8)
                        }
                    }
                    LanternApproval()
                }
                .frame(width: 380)
                LanternHelpers()
            }
        }
        .padding(.horizontal, 32)
        .padding(.top, 28)
        .padding(.bottom, 36)
        .background(StudyWallpaper.night.view)
        .clipped()
        .environment(\.colorScheme, .dark)
    }
}

/// Pal on the desktop with its bubble above. The bubble grows out of the tail, where Pal is.
private struct LanternBubbleScene<Bubble: View>: View {
    let mood: PetBrain.Mood
    @ViewBuilder let bubble: Bubble
    var body: some View {
        VStack(spacing: -10) {
            bubble
            PalView(mood: mood, time: 0.5, facing: 1, size: 56, glow: mood == .listening ? 1.6 : 1, style: .ghost)
        }
        .frame(width: 380)
    }
}

/// Night glass, a capsule-cornered body and a short tail. Lit: Pal's light runs along the top rim while it listens.
private struct LanternBubble<Content: View>: View {
    let lit: Bool
    var attention = false
    @ViewBuilder let content: Content
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) { content }
                .padding(.horizontal, 16)
                .frame(width: 320, height: 46)
                .background {
                    ZStack {
                        RoundedRectangle(cornerRadius: 18, style: .continuous).fill(LinearGradient(colors: [Lantern.nightTop, Lantern.night], startPoint: .top, endPoint: .bottom))
                        if lit {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(RadialGradient(colors: [Lantern.light.opacity(0.22), .clear], center: .bottom, startRadius: 0, endRadius: 160))
                        }
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(attention ? Lantern.amber.opacity(0.55) : (lit ? Lantern.light.opacity(0.45) : Color.white.opacity(0.12)), lineWidth: 0.8)
                    }
                }
            Triangle().fill(Lantern.night).frame(width: 16, height: 8).offset(y: -0.5)
        }
        .shadow(color: lit ? Lantern.light.opacity(0.28) : .black.opacity(0.35), radius: lit ? 16 : 12, y: 6)
    }
}

private struct Triangle: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.midX, y: r.maxY), control: CGPoint(x: r.midX + r.width * 0.12, y: r.minY + r.height * 0.55))
        p.addQuadCurve(to: CGPoint(x: r.minX, y: r.minY), control: CGPoint(x: r.midX - r.width * 0.12, y: r.minY + r.height * 0.55))
        p.closeSubpath()
        return p
    }
}

/// The microphone as Pal's light: bars that brighten with the voice, the newest on the right.
private struct LightMeter: View {
    let levels: [Double]
    var body: some View {
        HStack(alignment: .center, spacing: 2.5) {
            ForEach(Array(levels.enumerated()), id: \.offset) { i, level in
                Capsule().fill(Lantern.light.opacity(0.35 + 0.65 * Double(i) / Double(levels.count)))
                    .frame(width: 2.5, height: 4 + 16 * level)
            }
        }
        .shadow(color: Lantern.light.opacity(0.7), radius: 4)
    }
}

/// The work strip asking before a risky step: amber, because it needs you; Allow is the one filled button.
private struct LanternApproval: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(Lantern.amber).frame(width: 7, height: 7).shadow(color: Lantern.amber, radius: 4)
                Text("Pal needs your OK").font(.system(size: 11.5, weight: .medium)).foregroundStyle(Lantern.amber)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Click \u{201C}Send\u{201D} in Mail").font(Lantern.title(16)).foregroundStyle(Lantern.text)
                Text("It may send, buy, delete or change something.").font(.system(size: 12)).foregroundStyle(Lantern.text2)
            }
            HStack(spacing: 8) {
                Spacer()
                HStack(spacing: 6) {
                    Text("Decline").font(.system(size: 12.5, weight: .medium)).foregroundStyle(Lantern.text)
                    Text("esc").font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(Lantern.text3)
                }
                .padding(.horizontal, 16).frame(height: 32)
                .background(Capsule().fill(Color.white.opacity(0.07)))
                Text("Allow").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(hx(0x2B1A00))
                    .padding(.horizontal, 22).frame(height: 32)
                    .background(Capsule().fill(Lantern.amber))
                    .shadow(color: Lantern.amber.opacity(0.45), radius: 8)
            }
        }
        .padding(16)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(LinearGradient(colors: [Lantern.nightTop, Lantern.night], startPoint: .top, endPoint: .bottom))
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(RadialGradient(colors: [Lantern.amber.opacity(0.12), .clear], center: .topLeading, startRadius: 0, endRadius: 220))
                RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Lantern.amber.opacity(0.35), lineWidth: 0.8)
            }
        }
        .shadow(color: .black.opacity(0.4), radius: 18, y: 10)
    }
}

// MARK: - Helpers window

private struct LanternHelpers: View {
    var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 220)
            Rectangle().fill(Lantern.hair).frame(width: 0.5)
            detail
        }
        .frame(width: 720, height: 520)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(LinearGradient(colors: [Lantern.nightTop, Lantern.night], startPoint: .top, endPoint: .bottom))
                RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(LinearGradient(colors: [.white.opacity(0.16), .white.opacity(0.05)], startPoint: .top, endPoint: .bottom), lineWidth: 0.8)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.45), radius: 30, y: 18)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                ForEach([0xFF6B5F, 0xFFBD2E, 0x28C840] as [UInt32], id: \.self) { c in Circle().fill(hx(c)).frame(width: 12, height: 12) }
            }
            .padding(.bottom, 18)
            HelperRow(name: "Sid", line: "3 of 8 pages read", working: true, selected: true)
            HelperRow(name: "Kame", line: "Coming soon", working: false, selected: false).opacity(0.5)
            HelperRow(name: "Puff", line: "Coming soon", working: false, selected: false).opacity(0.5)
            Spacer()
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Large model for helpers").font(.system(size: 12, weight: .medium)).foregroundStyle(Lantern.text)
                    Text("Off keeps jobs on the medium model and saves your plan.").font(.system(size: 10.5)).foregroundStyle(Lantern.text3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                LightSwitch(on: true)
            }
        }
        .padding(14)
        .background(Color.black.opacity(0.18))
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 12) {
                HelperAvatar(initial: "S", working: true, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sid").font(Lantern.title(18)).foregroundStyle(Lantern.text)
                    Text("Researches on the web and writes you a report").font(.system(size: 11.5)).foregroundStyle(Lantern.text2)
                }
                Spacer()
            }
            HStack(spacing: 8) {
                InlineMenu(label: "Opens in", value: "Brave Browser")
                InlineMenu(label: "Model", value: "Chosen by Laya")
            }
            HStack {
                Text("Give Sid a task").font(.system(size: 12.5)).foregroundStyle(Lantern.text3)
                Spacer()
                Image(systemName: "arrow.up").font(.system(size: 11, weight: .bold)).foregroundStyle(Lantern.text3)
                    .frame(width: 24, height: 24).background(Circle().fill(Color.white.opacity(0.07)))
            }
            .padding(.leading, 14).padding(.trailing, 6).frame(height: 38)
            .background(Capsule().fill(Color.white.opacity(0.05)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 0.6))
            VStack(spacing: 0) {
                JobRow(state: .running, task: "Research how IPv6 is rolled out in home routers", meta: "Sonnet 4.5, Laya: moderate", progress: 3.0 / 8, step: "Reading 3 of 8 pages")
                Rectangle().fill(Lantern.hair).frame(height: 0.5)
                JobRow(state: .queued, task: "What year was TCP/IP adopted by ARPANET?", meta: "Added 1 min ago", progress: nil, step: nil)
                Rectangle().fill(Lantern.hair).frame(height: 0.5)
                JobRow(state: .done, task: "Networking basics", meta: "How data finds its way from your Mac to a website and back. Haiku 4.5, Laya: easy", progress: nil, step: nil)
            }
            .background(RoundedRectangle(cornerRadius: Lantern.radiusWell, style: .continuous).fill(Lantern.well))
            .overlay(RoundedRectangle(cornerRadius: Lantern.radiusWell, style: .continuous).strokeBorder(Lantern.wellLine, lineWidth: 0.5))
            Spacer(minLength: 0)
        }
        .padding(20)
    }
}

/// A helper's mark: a letter in a dark disc. While it works, Pal's light runs round it.
private struct HelperAvatar: View {
    let initial: String
    let working: Bool
    var size: CGFloat = 30
    var body: some View {
        Text(initial).font(.system(size: size * 0.42, weight: .semibold, design: .rounded)).foregroundStyle(Lantern.text)
            .frame(width: size, height: size)
            .background(Circle().fill(Color.white.opacity(0.08)))
            .overlay(Circle().trim(from: 0, to: working ? 0.7 : 0).stroke(AngularGradient(colors: [Lantern.light.opacity(0), Lantern.light], center: .center), style: StrokeStyle(lineWidth: 2, lineCap: .round)).rotationEffect(.degrees(-90)).padding(-3))
            .shadow(color: Lantern.light.opacity(working ? 0.4 : 0), radius: 6)
    }
}

private struct HelperRow: View {
    let name: String
    let line: String
    let working: Bool
    let selected: Bool
    var body: some View {
        HStack(spacing: 10) {
            HelperAvatar(initial: String(name.prefix(1)), working: working)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Lantern.text)
                Text(line).font(.system(size: 11)).foregroundStyle(working ? Lantern.light : Lantern.text3)
            }
            Spacer()
        }
        .padding(.horizontal, 8).padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(selected ? Color.white.opacity(0.07) : .clear))
    }
}

private struct InlineMenu: View {
    let label: String
    let value: String
    var body: some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 11.5)).foregroundStyle(Lantern.text3)
            Text(value).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Lantern.text)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(Lantern.text3)
        }
        .padding(.horizontal, 11).frame(height: 26)
        .background(Capsule().fill(Color.white.opacity(0.06)))
    }
}

private struct LightSwitch: View {
    let on: Bool
    var body: some View {
        Capsule().fill(on ? Lantern.light : Color.white.opacity(0.14))
            .frame(width: 32, height: 19)
            .overlay(alignment: on ? .trailing : .leading) { Circle().fill(on ? Lantern.lightCore : .white).padding(2) }
            .shadow(color: Lantern.light.opacity(on ? 0.5 : 0), radius: 6)
    }
}

private struct JobRow: View {
    enum State { case running, queued, done }
    let state: State
    let task: String
    let meta: String
    let progress: Double?
    let step: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            dot.padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                Text(task).font(.system(size: 13, weight: state == .done ? .semibold : .medium)).foregroundStyle(Lantern.text)
                if let step, let progress {
                    HStack(spacing: 8) {
                        GeometryReader { p in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.08))
                                Capsule().fill(Lantern.light).frame(width: p.size.width * progress).shadow(color: Lantern.light.opacity(0.7), radius: 4)
                            }
                        }
                        .frame(width: 120, height: 3)
                        Text(step).font(.system(size: 11)).foregroundStyle(Lantern.light)
                    }
                }
                Text(meta).font(.system(size: 11)).foregroundStyle(Lantern.text3).lineLimit(2)
            }
            Spacer(minLength: 8)
            action
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }

    @ViewBuilder private var dot: some View {
        switch state {
        case .running: Circle().fill(Lantern.light).frame(width: 7, height: 7).shadow(color: Lantern.light, radius: 4)
        case .queued: Circle().strokeBorder(Lantern.text3, lineWidth: 1.2).frame(width: 7, height: 7)
        case .done: Circle().fill(Lantern.text2).frame(width: 7, height: 7)
        }
    }

    @ViewBuilder private var action: some View {
        switch state {
        case .running, .queued:
            Text("Stop").font(.system(size: 11.5, weight: .medium)).foregroundStyle(Lantern.text2)
                .padding(.horizontal, 12).frame(height: 24).background(Capsule().fill(Color.white.opacity(0.06)))
        case .done:
            Text("Read report").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Lantern.light)
                .padding(.horizontal, 12).frame(height: 24).background(Capsule().strokeBorder(Lantern.light.opacity(0.4), lineWidth: 0.8))
        }
    }
}
