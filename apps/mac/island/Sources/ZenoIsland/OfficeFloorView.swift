import SwiftUI
import ZenoIslandCore

/// ADR-090: the office floor in 2D, after munder-difflin's office (our own art; smooth vector shapes since ADR-104,
/// drawn in `OfficeDrawing` and `PalDrawing`): each worker has a desk; one at work sits there typing, its monitor lit and its step in a bubble; one
/// waiting for Keshab has an amber "!" (a note goes up on the "Needs you" board); idle ones rest in the lounge; a
/// failed last task shows a red "!"; a finished goal makes its workers cheer. Pal runs the floor from its office. Pals
/// walk between the lounge and their desk when their state changes, and a hand-off sends an envelope desk to desk.
/// Drawn as antialiased vector shapes at any scale. ADR-094: twelve seats
/// and ten lounge spots; a "+N" sign stands in for the rest and opens "All agents".
struct OfficeFloor: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let walker = State(initialValue: OfficeWalker())
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let plan = model.helpers.list.map { OfficePlan(list: $0) } ?? OfficePlan(list: HelpersList(helpers: [], apps: []))
        let looks = Dictionary(uniqueKeysWithValues: plan.seats.compactMap { s in PalLibrary.character(for: s.helperId).map { (s.helperId, $0) } })
        let scene = OfficeScene(plan: plan, looks: looks, pal: PalLibrary.pal, palBusy: model.status.isBusy, walker: walker.wrappedValue, animate: !snapshot)
        GeometryReader { proxy in
            // Vector art: as large as fits, at any scale.
            let scale = max(0.5, proxy.size.width / CGFloat(OfficeMap.width))
            let size = CGSize(width: CGFloat(OfficeMap.width) * scale, height: CGFloat(OfficeMap.height) * scale)
            ticking { date in
                Canvas { context, _ in scene.draw(in: &context, scale: scale, date: date) }
                    .frame(width: size.width, height: size.height)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { location in
                let origin = CGPoint(x: (proxy.size.width - size.width) / 2, y: (proxy.size.height - size.height) / 2)
                tap(CGPoint(x: (location.x - origin.x) / scale, y: (location.y - origin.y) / scale), plan: plan)
            }
        }
        .aspectRatio(CGFloat(OfficeMap.width) / CGFloat(OfficeMap.height), contentMode: .fit)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel((plan.seats.map { "\($0.name): \($0.bubble ?? ($0.spot == .desk($0.desk) ? "at the desk" : "in the lounge"))" }
            + OfficeScene.signs(plan).map(\.text)).joined(separator: ", "))
    }

    /// A worker clicked: its task, or its page. Pal: the chat.
    private func tap(_ point: CGPoint, plan: OfficePlan) {
        let pal = OfficeMap.managerSeat
        if abs(point.x - pal.x) < 12, point.y > pal.y - 20, point.y < pal.y + 8 { model.navigate { model.windowPage = .chat }; return }
        // ADR-094: a "+N" sign: everyone, searchable.
        if OfficeScene.signs(plan).contains(where: { $0.rect.contains(point) }) { model.navigate { model.showsAllAgents = true }; return }
        for seat in plan.seats {
            guard let at = walker.wrappedValue.positions[seat.helperId], abs(point.x - at.x) < 12, point.y > at.y - 20, point.y < at.y + 10 else { continue }
            // ADR-095: a Manager's desk opens its page.
            model.navigate {
                if seat.manager { model.helpers.selectManager(seat.helperId) }
                else if let task = seat.taskId { model.sendHelpers(model.helpers.openThread(task)) } else { model.helpers.selectHelper(seat.helperId) }
            }
            return
        }
    }

    /// Redrawn twenty times a second while on screen; once in snapshots.
    @ViewBuilder private func ticking<Content: View>(@ViewBuilder _ content: @escaping (Date) -> Content) -> some View {
        if snapshot {
            content(Date(timeIntervalSinceReferenceDate: 0.6))
        } else {
            TimelineView(.periodic(from: .now, by: 1.0 / 20)) { context in content(context.date) }
        }
    }
}

/// Where each pal is, walking from its last place to a new one when its place changes.
final class OfficeWalker {
    private var targets: [String: OfficeMap.Place] = [:]
    private var walks: [String: OfficeWalk] = [:]
    /// Where each pal was last drawn, in map pixels (for clicks and envelopes).
    private(set) var positions: [String: CGPoint] = [:]

    func place(_ id: String, at target: OfficeMap.Place, now: Date, animate: Bool) -> (point: CGPoint, walking: Bool, heading: Int) {
        if animate, let old = targets[id], old != target {
            let here = walks[id]?.position(at: now).point ?? old.point
            let from = OfficeMap.Place(tile: OfficeMap.Tile(Int(here.x) / OfficeMap.tile, Int(here.y) / OfficeMap.tile), point: here, seated: false)
            walks[id] = OfficeWalk(from: from, to: target, start: now)
        }
        targets[id] = target
        if let walk = walks[id] {
            let p = walk.position(at: now)
            if p.walking {
                positions[id] = p.point
                return p
            }
            walks[id] = nil
        }
        positions[id] = target.point
        return (target.point, false, 0)
    }
}

/// One frame of the floor.
@MainActor
struct OfficeScene {
    let plan: OfficePlan
    let looks: [String: PalDefinition]
    let pal: PalDefinition?
    let palBusy: Bool
    let walker: OfficeWalker
    let animate: Bool

    private struct Actor {
        var id: String
        var name: String
        var look: PalDefinition
        var point: CGPoint
        var pose: PalStance.Pose
        var eyes: Int
        var seat: OfficePlan.Seat?
        var desk: OfficeMap.Tile?
        var walking: Bool
    }

    func draw(in context: inout GraphicsContext, scale s: CGFloat, date: Date) {
        let time = date.timeIntervalSinceReferenceDate
        let frame = Int(time * 5)
        let actors = cast(date: date, frame: frame)
        let byId = Dictionary(uniqueKeysWithValues: actors.map { ($0.id, $0.point) })
        var g = context
        g.scaleBy(x: s, y: s)
        OfficeDrawing.background(g)
        // Notes on the "Needs you" board, one per worker waiting for Keshab (drawn or not).
        for i in 0..<min(plan.needsYou, 10) {
            OfficeDrawing.note(g, index: i, x: CGFloat(163 + (i % 5) * 7), y: CGFloat(9 + (i / 5) * 7))
        }
        for sign in Self.signs(plan) { OfficeDrawing.sign(g, sign.rect) }
        for a in actors.sorted(by: { $0.point.y < $1.point.y }) {
            PalDrawing.draw(a.look, pose: a.pose, look: a.eyes, in: g, origin: CGPoint(x: a.point.x - 16, y: a.point.y - 18), unit: 1, shadow: true)
        }
        OfficeDrawing.foreground(g)
        for a in actors where a.pose == .typeA || a.pose == .typeB {
            guard let desk = a.desk else { continue }
            OfficeDrawing.monitorGlow(g, x: CGFloat(desk.x * OfficeMap.tile), y: CGFloat(desk.y * OfficeMap.tile - 9), frame: frame)
            // Hands on the keyboard, taking turns.
            let body = PalRGB(hex: a.look.colors.body) ?? PalRGB(r: 0.95, g: 0.95, b: 0.95)
            OfficeDrawing.hand(g, x: CGFloat(desk.x * OfficeMap.tile + 17), y: CGFloat(desk.y * OfficeMap.tile + 1 + (frame % 2)), body: body)
            OfficeDrawing.hand(g, x: CGFloat(desk.x * OfficeMap.tile + 23), y: CGFloat(desk.y * OfficeMap.tile + 2 - (frame % 2)), body: body)
        }
        for a in actors {
            guard let seat = a.seat else { continue }
            if let flag = seat.flag {
                let bounce = frame % 4 < 2 ? 0.0 : 1.0
                OfficeDrawing.alert(g, x: a.point.x - 2, y: a.point.y - 32 - bounce, failed: flag == .failed)
            }
            if a.pose == .cheer || seat.animation == "celebrate" { OfficeDrawing.confetti(g, at: a.point, frame: frame) }
        }
        for envelope in plan.envelopes {
            guard let from = byId[envelope.from], let to = byId[envelope.to] else { continue }
            let p = (time / 2.4).truncatingRemainder(dividingBy: 1)
            let control = CGPoint(x: (from.x + to.x) / 2, y: min(from.y, to.y) - 40)
            let x = (1 - p) * (1 - p) * from.x + 2 * (1 - p) * p * control.x + p * p * to.x
            let y = (1 - p) * (1 - p) * from.y + 2 * (1 - p) * p * control.y + p * p * to.y
            OfficeDrawing.envelope(g, x: x - 5, y: y - 26)
        }
        for sign in Self.signs(plan) { signText(&context, sign, scale: s) }
        for a in actors { nameplate(&context, a, scale: s) }
        if palBusy || plan.seats.contains(where: { $0.animation == "working" }) {
            bubble(&context, "Running the floor", over: OfficeMap.managerSeat, raise: 0, scale: s)
        }
        for a in actors {
            guard let text = a.seat?.bubble, !a.walking else { continue }
            // ADR-094: the four meeting seats are a tile apart, too close for four bubbles; their steps show on a click.
            if case .desk(let d) = a.seat?.spot, d >= OfficeMap.desks.count { continue }
            bubble(&context, text, over: a.point, raise: (a.seat?.desk ?? 0) % 2 == 1 ? 1 : 0, scale: s)
        }
    }

    /// ADR-094: the "+N" signs for workers left off the floor.
    struct Sign {
        var text: String
        var rect: CGRect
    }

    static func signs(_ plan: OfficePlan) -> [Sign] {
        (plan.moreAtWork > 0 ? [Sign(text: "+\(plan.moreAtWork) at work", rect: OfficeMap.atWorkSign)] : [])
            + (plan.moreIdle > 0 ? [Sign(text: "+\(plan.moreIdle) more", rect: OfficeMap.loungeSign)] : [])
    }

    /// A sign's words, in the nameplates' type, centred on its board.
    private func signText(_ context: inout GraphicsContext, _ sign: Sign, scale s: CGFloat) {
        let text = context.resolve(Text(sign.text).font(.system(size: 3.6 * s, weight: .bold, design: .rounded))
            .foregroundStyle(Color(red: 0.17, green: 0.18, blue: 0.23)))
        context.draw(text, at: CGPoint(x: sign.rect.midX * s, y: (sign.rect.minY + (sign.rect.height - 4) / 2 - 0.5) * s))
    }

    /// Everyone on the floor this frame: where, in which pose.
    private func cast(date: Date, frame: Int) -> [Actor] {
        var actors: [Actor] = []
        if let pal {
            let pose: PalStance.Pose = palBusy ? (frame % 2 == 0 ? .typeA : .typeB) : idlePose("pal", frame: frame)
            actors.append(Actor(id: "pal", name: "ATOM", look: pal, point: OfficeMap.managerSeat, pose: pose, eyes: 0, seat: nil,
                                desk: palBusy ? OfficeMap.managerDesk : nil, walking: false))
        }
        for seat in plan.seats {
            guard let look = looks[seat.helperId] else { continue }
            let target: OfficeMap.Place
            var desk: OfficeMap.Tile?
            switch seat.spot {
            case .desk(let i):
                target = OfficeMap.seat(i) ?? OfficeMap.lounge(i)
                desk = OfficeMap.desks.indices.contains(i) ? OfficeMap.desks[i] : nil
            case .lounge(let i):
                target = OfficeMap.lounge(i)
            }
            let at = walker.place(seat.helperId, at: target, now: date, animate: animate)
            var pose: PalStance.Pose
            if at.walking {
                pose = frame % 2 == 0 ? .walkA : .walkB
                desk = nil
            } else {
                switch seat.animation {
                case "working": pose = frame % 2 == 0 ? .typeA : .typeB
                case "celebrate": pose = frame % 4 < 2 ? .cheer : .idle
                case "sad": pose = .sad
                default: pose = idlePose(seat.helperId, frame: frame)
                }
                if pose != .typeA && pose != .typeB { desk = nil }
            }
            let eyes = at.walking ? at.heading : glance(seat.helperId, frame: frame)
            actors.append(Actor(id: seat.helperId, name: seat.name, look: look, point: at.point, pose: pose, eyes: eyes, seat: seat, desk: desk, walking: at.walking))
        }
        return actors
    }

    /// Breathing, with a blink now and then, each pal on its own beat.
    private func idlePose(_ id: String, frame: Int) -> PalStance.Pose {
        let beat = frame + abs(id.hashValue % 17)
        if beat % 23 == 0 { return .blink }
        return beat % 6 < 3 ? .idle : .bob
    }

    private func glance(_ id: String, frame: Int) -> Int {
        let beat = (frame / 10 + abs(id.hashValue % 5)) % 6
        return beat == 1 ? -1 : beat == 4 ? 1 : 0
    }

    private func nameplate(_ context: inout GraphicsContext, _ a: Actor, scale s: CGFloat) {
        let text = context.resolve(Text(a.name).font(.system(size: 3.6 * s, weight: .semibold, design: .rounded)).foregroundStyle(Color.white))
        let size = text.measure(in: CGSize(width: 200, height: 40))
        // Under the desk for one sitting at it, under the feet otherwise.
        var atDesk = a.id == "pal"
        if let spot = a.seat?.spot, case .desk = spot, !a.walking { atDesk = true }
        let below: CGFloat = atDesk ? 20 : 12
        let centre = CGPoint(x: a.point.x * s, y: (a.point.y + below) * s + size.height / 2)
        var rect = CGRect(x: centre.x - size.width / 2 - 2 * s / 2, y: centre.y - size.height / 2, width: size.width + 2 * s, height: size.height)
        // ADR-094: the lounge's bottom row stands at the floor's edge; keep its names on the floor.
        rect.origin.y = min(rect.origin.y, (CGFloat(OfficeMap.height) - 2) * s - rect.height)
        context.fill(Path(roundedRect: rect, cornerRadius: rect.height / 2, style: .continuous), with: .color(Color(red: 0.12, green: 0.13, blue: 0.17).opacity(0.74)))
        context.draw(text, at: CGPoint(x: rect.midX, y: rect.midY))
    }

    /// A soft white speech bubble with a tail, over a pal's head; `raise` lifts it a row to clear a neighbour's.
    private func bubble(_ context: inout GraphicsContext, _ line: String, over point: CGPoint, raise: Int, scale s: CGFloat) {
        let short = line.count > 24 ? String(line.prefix(23)) + "…" : line
        let text = context.resolve(Text(short).font(.system(size: 4.2 * s, weight: .medium, design: .rounded)).foregroundStyle(Color(red: 0.17, green: 0.18, blue: 0.23)))
        let size = text.measure(in: CGSize(width: 400, height: 60))
        let w = size.width / s + 6, h = size.height / s + 3
        let bottom = point.y - 19 - CGFloat(raise) * (h + 2)
        let x = point.x - w / 2, y = bottom - h
        let ink = Color(red: 0.17, green: 0.18, blue: 0.23)
        var g = context
        g.scaleBy(x: s, y: s)
        // One path for the body and its tail, so the outline runs round both.
        var shape = Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: min(3, h / 2), style: .continuous)
        var tail = Path()
        tail.move(to: CGPoint(x: point.x - 2.2, y: y + h - 0.3))
        tail.addQuadCurve(to: CGPoint(x: point.x, y: y + h + 2.6), control: CGPoint(x: point.x - 0.6, y: y + h + 1.2))
        tail.addQuadCurve(to: CGPoint(x: point.x + 1.6, y: y + h - 0.3), control: CGPoint(x: point.x + 0.3, y: y + h + 1))
        tail.closeSubpath()
        shape.addPath(tail)
        g.fill(shape.offsetBy(dx: 0, dy: 0.7), with: .color(.black.opacity(0.14)))
        g.fill(shape, with: .color(.white))
        g.stroke(shape, with: .color(ink.opacity(0.75)), style: StrokeStyle(lineWidth: 0.6, lineJoin: .round))
        // The seam where the tail joins the body hides under a white patch.
        g.fill(Path(CGRect(x: point.x - 1.9, y: y + h - 0.9, width: 3.3, height: 1.2)), with: .color(.white))
        context.draw(text, at: CGPoint(x: (x + w / 2) * s, y: (y + h / 2) * s))
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
