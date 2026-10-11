import SwiftUI
import ZenoIslandCore

/// ADR-090: the office floor: each pal at its own desk, those at work playing "working" with their step in a bubble,
/// idle ones in the lounge, Pal at the manager's desk; a hand-off sends an envelope desk to desk; a finished goal makes
/// its workers celebrate. Pals walk between the lounge and their desk when their state changes. ZENO's own drawing.
struct OfficeFloor: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    static let height: CGFloat = 400
    private static let columns = 4

    var body: some View {
        let plan = model.helpers.list.map { OfficePlan(list: $0) } ?? OfficePlan(list: HelpersList(helpers: [], apps: []))
        GeometryReader { proxy in
            let size = proxy.size
            ZStack(alignment: .topLeading) {
                Canvas { context, canvas in drawRoom(in: context, size: canvas, plan: plan) }
                manager(size: size)
                ForEach(plan.seats) { seat in
                    pal(seat, at: point(for: seat.spot, size: size))
                }
                envelopes(plan, size: size)
            }
            .animation(.easeInOut(duration: 1.4), value: plan)
        }
        .frame(height: Self.height)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    // MARK: - Places

    private func deskCentre(_ index: Int, size: CGSize) -> CGPoint {
        let row = index / Self.columns, column = index % Self.columns
        let left = size.width * 0.25, right = size.width * 0.76
        let x = left + (right - left) * (CGFloat(column) + 0.5) / CGFloat(Self.columns)
        let y = size.height * (row == 0 ? 0.36 : row == 1 ? 0.78 : 0.95)
        return CGPoint(x: x, y: y)
    }

    private func loungeSpot(_ index: Int, size: CGSize) -> CGPoint {
        let column = index % 2, row = index / 2
        return CGPoint(x: size.width * (0.84 + 0.1 * CGFloat(column)), y: size.height * (0.24 + 0.16 * CGFloat(row)))
    }

    private func point(for spot: OfficePlan.Spot, size: CGSize) -> CGPoint {
        switch spot {
        case .desk(let i): let d = deskCentre(i, size: size); return CGPoint(x: d.x, y: d.y - 50)
        case .lounge(let i): return loungeSpot(i, size: size)
        }
    }

    // MARK: - The room

    private func drawRoom(in context: GraphicsContext, size: CGSize, plan: OfficePlan) {
        let line = theme.isFlat ? theme.border.color : theme.separator.color
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(theme.isDark ? Color.white.opacity(0.015) : Color.black.opacity(0.02)))
        // A quiet floor grid.
        var grid = Path()
        stride(from: 0, through: size.width, by: 32).forEach { x in grid.move(to: CGPoint(x: x, y: 0)); grid.addLine(to: CGPoint(x: x, y: size.height)) }
        stride(from: 0, through: size.height, by: 32).forEach { y in grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: size.width, y: y)) }
        context.stroke(grid, with: .color(line.opacity(0.35)), lineWidth: 0.5)
        // Areas: the manager's office on the left, the lounge on the right.
        let office = CGRect(x: 14, y: 14, width: size.width * 0.2, height: size.height - 28)
        let lounge = CGRect(x: size.width * 0.78, y: 14, width: size.width * 0.22 - 14, height: size.height - 28)
        for area in [office, lounge] {
            context.stroke(Path(roundedRect: area, cornerRadius: 14, style: .continuous), with: .color(line), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
        label(context, "Pal's office", at: CGPoint(x: office.minX + 12, y: office.minY + 10))
        label(context, "Lounge", at: CGPoint(x: lounge.minX + 12, y: lounge.minY + 10))
        // The manager's desk, and a sofa in the lounge.
        desk(context, centre: CGPoint(x: office.midX, y: size.height * 0.62), lit: model.status.isBusy, line: line)
        let sofa = CGRect(x: lounge.minX + 12, y: lounge.maxY - 64, width: lounge.width - 24, height: 40)
        context.fill(Path(roundedRect: sofa, cornerRadius: 12, style: .continuous), with: .color(theme.fill2.color))
        context.stroke(Path(roundedRect: sofa, cornerRadius: 12, style: .continuous), with: .color(line), lineWidth: 1)
        // A desk for each worker; its monitor lights while that worker works.
        for seat in plan.seats {
            desk(context, centre: deskCentre(seat.desk, size: size), lit: seat.animation == "working", line: line)
        }
    }

    private func desk(_ context: GraphicsContext, centre: CGPoint, lit: Bool, line: Color) {
        let top = CGRect(x: centre.x - 38, y: centre.y - 10, width: 76, height: 28)
        context.fill(Path(roundedRect: top, cornerRadius: 8, style: .continuous), with: .color(theme.fill1.color))
        context.stroke(Path(roundedRect: top, cornerRadius: 8, style: .continuous), with: .color(line), lineWidth: 1)
        let monitor = CGRect(x: centre.x + 6, y: centre.y - 4, width: 24, height: 15)
        context.fill(Path(roundedRect: monitor, cornerRadius: 3), with: .color(lit ? theme.live.color.opacity(0.85) : theme.fill3.color))
        if lit {
            context.fill(Path(ellipseIn: monitor.insetBy(dx: -10, dy: -8)), with: .radialGradient(Gradient(colors: [theme.live.color.opacity(0.25), .clear]),
                                                                                                  center: CGPoint(x: monitor.midX, y: monitor.midY), startRadius: 0, endRadius: 30))
        }
    }

    private func label(_ context: GraphicsContext, _ text: String, at point: CGPoint) {
        context.draw(Text(text).font(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color), at: point, anchor: .topLeading)
    }

    // MARK: - Pals

    private func manager(size: CGSize) -> some View {
        let centre = CGPoint(x: 14 + size.width * 0.1, y: size.height * 0.62 - 36)
        return Group {
            if let pal = PalLibrary.pal {
                animated { time in
                    PalPortrait(character: pal, animation: PalAnimation.name(mood: PetBrain.mood(for: model.status.kind) ?? .resting, reaction: nil), time: time, size: 70, glow: theme.usesGlow)
                }
                .position(centre)
                nameTag("Pal").position(x: centre.x, y: centre.y + 64)
            }
        }
    }

    private func pal(_ seat: OfficePlan.Seat, at point: CGPoint) -> some View {
        VStack(spacing: 2) {
            if let bubble = seat.bubble {
                Text(bubble).font(.system(size: 10)).foregroundStyle(theme.text.color).lineLimit(2).multilineTextAlignment(.center)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .frame(maxWidth: 130)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(theme.surfaceSolid.color))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
                    .fixedSize(horizontal: false, vertical: true)
            }
            ZStack(alignment: .topTrailing) {
                if let character = PalLibrary.character(for: seat.helperId) {
                    animated { time in
                        PalPortrait(character: character, animation: seat.animation, time: time + Double(seat.desk) * 1.7, size: 58, glow: theme.usesGlow)
                    }
                }
                if let flag = seat.flag { StatusDot(color: flag == .failed ? theme.problem.color : theme.attention.color, size: 8).padding(4) }
            }
            nameTag(seat.name)
        }
        .position(x: point.x, y: point.y - (seat.bubble == nil ? 0 : 14))
        .onTapGesture {
            if let task = seat.taskId { model.sendHelpers(model.helpers.openThread(task)) } else { model.helpers.selectHelper(seat.helperId) }
        }
        .help(seat.bubble.map { "\(seat.name): \($0)" } ?? seat.name)
    }

    private func nameTag(_ name: String) -> some View {
        Text(name).font(theme.idFont(.system(size: 10.5, weight: .medium), size: 10)).foregroundStyle(theme.idColor(theme.text2))
    }

    private func envelopes(_ plan: OfficePlan, size: CGSize) -> some View {
        animated { time in
            ZStack {
                ForEach(plan.envelopes) { envelope in
                    if let from = plan.seats.first(where: { $0.helperId == envelope.from }), let to = plan.seats.first(where: { $0.helperId == envelope.to }) {
                        let a = deskCentre(from.desk, size: size), b = deskCentre(to.desk, size: size)
                        let p = (time / 2.4).truncatingRemainder(dividingBy: 1)
                        let control = CGPoint(x: (a.x + b.x) / 2, y: min(a.y, b.y) - 70)
                        let x = (1 - p) * (1 - p) * a.x + 2 * (1 - p) * p * control.x + p * p * b.x
                        let y = (1 - p) * (1 - p) * a.y + 2 * (1 - p) * p * control.y + p * p * b.y
                        Image(systemName: "envelope.fill").font(.system(size: 14)).foregroundStyle(theme.attention.color)
                            .position(x: x, y: y - 20)
                    }
                }
            }
        }
    }

    /// A view that moves with time, still in snapshots.
    @ViewBuilder private func animated<Content: View>(@ViewBuilder _ content: @escaping (Double) -> Content) -> some View {
        if snapshot {
            content(1.2)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 24)) { context in content(context.date.timeIntervalSinceReferenceDate) }
        }
    }
}

/// One of two ways to see something (Floor, Columns): a quiet pill, outlined when chosen.
struct ViewChoice: View {
    let title: String
    let symbol: String
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.system(size: 12, weight: .medium))
                .foregroundStyle(selected ? theme.text.color : theme.text3.color)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
                    .strokeBorder(selected ? (theme.isFlat ? theme.border.color : theme.separator.color) : .clear, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
