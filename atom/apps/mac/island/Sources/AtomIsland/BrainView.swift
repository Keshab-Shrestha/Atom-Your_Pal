import SwiftUI
import AtomIslandCore

// The second brain: ATOM's notes drawn as a graph, as in Obsidian. Dots are notes, lines are [[links]]; a dim dashed dot is
// a link to a note nobody wrote yet. Drag to move, pinch or the buttons to zoom, click a dot to read the note.
// The logic lives in `BrainState` and `BrainLayout`; these views only draw it.

private func kindColor(_ kind: BrainKind, _ theme: ThemePalette) -> Color {
    switch kind {
    case .note: return theme.accent.color
    case .memory: return theme.live.color
    case .episode: return theme.success.color
    case .chat: return theme.attention.color
    case .project: return theme.text2.color
    case .entity: return theme.text.color
    }
}

/// The two tabs of the Second brain page: the graph of notes, and what ATOM keeps (facts, conversation notes, kept chats;
/// it was Settings → Memory until 2026-10-15).
private enum BrainTab: String, CaseIterable {
    case graph = "Graph", memory = "Memory", sources = "Sources"
}

struct BrainPane: View {
    @Environment(\.appTextSize) private var textSize
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let positions = State(initialValue: [Int: CGPoint]())
    private let zoom = State(initialValue: 1.0)
    private let zoomStart = State(initialValue: 1.0)
    private let pan = State(initialValue: CGSize.zero)
    private let panStart = State(initialValue: CGSize.zero)
    private let words = State(initialValue: "")
    private let creating = State(initialValue: false)
    private let tab = State(initialValue: BrainTab.graph)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let state = model.brain
        VStack(alignment: .leading, spacing: 0) {
            header(state)
            Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5)
            if tab.wrappedValue == .sources {
                BrainSourcesPane(model: model, openNote: { id in tab.wrappedValue = .graph; model.selectBrainNote(id) })
            } else if tab.wrappedValue == .memory {
                memoryTab
            } else if let graph = state.graph {
                if graph.noteCount == 0 && graph.nodes.isEmpty {
                    emptyState
                } else {
                    HStack(alignment: .top, spacing: 0) {
                        canvasArea(state, graph)
                        Rectangle().fill(theme.separator.color).frame(width: theme.isFlat ? 1 : 0.5)
                        BrainSidePanel(model: model, creating: creating)
                            .frame(width: 320)
                    }
                }
            } else {
                Text("Waiting for ATOM…").appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(Spacing.panel)
                Spacer(minLength: 0)
            }
        }
        .onAppear { model.openBrain() }
    }

    // MARK: header

    @ViewBuilder private func header(_ state: BrainState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Circle().fill(hud).frame(width: 7, height: 7).opacity(0.9)
                        Text("SECOND BRAIN").appFont(.system(size: 17, weight: .semibold, design: .monospaced)).tracking(2).foregroundStyle(theme.text.color)
                    }
                    Text("// " + subtitle(state).uppercased()).appFont(.system(size: 10, design: .monospaced)).tracking(0.8).foregroundStyle(theme.text2.color)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                tabSwitch
                if tab.wrappedValue == .graph {
                    searchField
                    PillButton(title: "New note", symbol: "plus", prominent: true) {
                        selectBrain(nil, newEditor: true)
                    }
                }
            }
            if tab.wrappedValue == .graph, state.graph != nil { legend(state) }
        }
        .padding(.horizontal, Spacing.panel)
        .padding(.top, 28)
        .padding(.bottom, 12)
    }

    /// Graph or Memory: one page for everything ATOM keeps.
    private var tabSwitch: some View {
        HStack(spacing: 2) {
            ForEach(BrainTab.allCases, id: \.self) { item in
                let on = tab.wrappedValue == item
                Button {
                    guard tab.wrappedValue != item else { return }
                    model.navigate { tab.wrappedValue = item }
                } label: {
                    Text(item.rawValue.uppercased()).appFont(.system(size: 10.5, weight: on ? .semibold : .regular, design: .monospaced)).tracking(1)
                        .foregroundStyle(on ? theme.text.color : theme.text2.color)
                        .padding(.horizontal, 12).frame(height: 24)
                        .background(Capsule().fill(on ? theme.fill3.color : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(2)
        .background(Capsule().fill(theme.fill1.color))
        .overlay(Capsule().strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
    }

    /// What ATOM keeps: the facts, the conversation notes and the kept chats, with a way to forget each.
    private var memoryTab: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) { MemorySection(model: model) }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.panel)
                .padding(.vertical, Spacing.panel)
        }
    }

    private func subtitle(_ state: BrainState) -> String {
        if tab.wrappedValue == .sources { return "Selected notes folders, provenance and refresh." }
        if tab.wrappedValue == .memory { return "What ATOM keeps about you: facts, conversation notes and kept chats." }
        guard let graph = state.graph else { return "Notes that link to each other." }
        let links = graph.edges.count
        let base = "\(graph.noteCount) note\(graph.noteCount == 1 ? "" : "s"), \(links) link\(links == 1 ? "" : "s")"
        return graph.omitted > 0 ? "\(base). \(graph.omitted) less linked notes are not drawn." : base
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            if snapshot {
                Text("Search notes").appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color).frame(width: 170, alignment: .leading) // `ImageRenderer` cannot draw a text field
            } else {
                TextField("Search notes", text: words.projectedValue)
                    .textFieldStyle(.plain)
                    .appFont(.system(size: 12.5))
                    .frame(width: 170)
                    .onChange(of: words.wrappedValue) { _, value in model.searchBrain(value) }
            }
            if !words.wrappedValue.isEmpty {
                Button { words.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").appFont(.system(size: 11)).foregroundStyle(theme.text3.color) }
                    .buttonStyle(.plain)
                    .help("Clear the search")
                    .accessibilityLabel("Clear the search")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(Capsule().fill(theme.fill1.color))
        .overlay(Capsule().strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
    }

    /// Kinds and tags as chips: a click hides a kind or shows only one tag.
    @ViewBuilder private func legend(_ state: BrainState) -> some View {
        let counts = state.counts()
        let tags = Array((state.graph?.tags ?? []).prefix(8))
        HStack(spacing: 6) {
            ForEach(counts) { entry in
                let hidden = state.hiddenKinds.contains(entry.kind)
                Button {
                    if hidden { model.brain.hiddenKinds.remove(entry.kind) } else { model.brain.hiddenKinds.insert(entry.kind) }
                } label: {
                    HStack(spacing: 5) {
                        Circle().fill(kindColor(entry.kind, theme)).frame(width: 7, height: 7).opacity(hidden ? 0.3 : 1)
                        Text("\(entry.kind.title) \(entry.count)".uppercased()).appFont(.system(size: 9.5, design: .monospaced)).tracking(0.5).foregroundStyle(hidden ? theme.text3.color : theme.text2.color)
                    }
                    .padding(.horizontal, 9).frame(height: 22)
                    .background(Capsule().fill(theme.fill1.color))
                }
                .buttonStyle(.plain)
                .help(hidden ? "Show \(entry.kind.title.lowercased())" : "Hide \(entry.kind.title.lowercased())")
            }
            if !tags.isEmpty {
                Rectangle().fill(theme.separator.color).frame(width: 1, height: 14).padding(.horizontal, 2)
                ForEach(tags) { tag in
                    let on = state.tagFilter == tag.tag
                    Button { model.brain.tagFilter = on ? nil : tag.tag } label: {
                        Text("#\(tag.tag) \(tag.count)".uppercased()).appFont(.system(size: 9.5, weight: on ? .semibold : .regular, design: .monospaced)).tracking(0.5)
                            .foregroundStyle(on ? theme.text.color : theme.text2.color)
                            .padding(.horizontal, 9).frame(height: 22)
                            .background(Capsule().fill(on ? theme.fill3.color : theme.fill1.color))
                    }
                    .buttonStyle(.plain)
                    .help(on ? "Show every tag" : "Only notes tagged \(tag.tag)")
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "brain.head.profile").appFont(.system(size: 26)).foregroundStyle(theme.text3.color)
            Text("Your second brain is empty").appFont(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color)
            Text("Tell ATOM “Note this in my second brain…”, or write a note yourself. Link notes with [[double brackets]] and tag them with #tags. Facts and conversation notes ATOM keeps appear here too.")
                .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).multilineTextAlignment(.center).frame(maxWidth: 420)
            PillButton(title: "Write the first note", symbol: "plus", prominent: true) {
                selectBrain(nil, newEditor: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Spacing.panel)
    }

    // MARK: graph

    private func canvasArea(_ state: BrainState, _ graph: BrainGraphData) -> some View {
        let key = layoutKey(graph)
        return ZStack(alignment: .bottomTrailing) {
            GeometryReader { proxy in
                Canvas { context, size in
                    draw(context: context, size: size, state: state, graph: graph)
                }
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        let id = nodeAt(value.location, size: proxy.size, state: state)
                        selectBrain(id, newEditor: id == nil ? nil : false)
                    }
                )
                .simultaneousGesture(
                    DragGesture(minimumDistance: 4)
                        .onChanged { value in
                            pan.wrappedValue = CGSize(width: panStart.wrappedValue.width + value.translation.width, height: panStart.wrappedValue.height + value.translation.height)
                        }
                        .onEnded { _ in panStart.wrappedValue = pan.wrappedValue }
                )
                .simultaneousGesture(
                    MagnifyGesture()
                        .onChanged { value in zoom.wrappedValue = min(6, max(0.3, zoomStart.wrappedValue * Double(value.magnification))) }
                        .onEnded { _ in zoomStart.wrappedValue = zoom.wrappedValue }
                )
            }
            zoomButtons
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                theme.fill1.color.opacity(0.25)
                RadialGradient(colors: [hud.opacity(0.08), .clear], center: .center, startRadius: 0, endRadius: 460)
            }
        }
        .overlay(alignment: .topLeading) { hudReadout(state, graph) }
        .overlay { HUDBrackets().stroke(hud.opacity(0.55), lineWidth: 1.2).padding(10).allowsHitTesting(false) }
        .task(id: key) { await relayout(graph) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Graph of \(graph.noteCount) notes")
    }

    private var zoomButtons: some View {
        HStack(spacing: 6) {
            IconButton(symbol: "minus", label: "Zoom out") { setZoom(zoom.wrappedValue / 1.3) }
            IconButton(symbol: "plus", label: "Zoom in") { setZoom(zoom.wrappedValue * 1.3) }
            IconButton(symbol: "arrow.up.left.and.down.right.magnifyingglass", label: "Fit the graph") {
                setZoom(1)
                pan.wrappedValue = .zero
                panStart.wrappedValue = .zero
            }
        }
        .padding(12)
    }

    private func setZoom(_ value: Double) {
        zoom.wrappedValue = min(6, max(0.3, value))
        zoomStart.wrappedValue = zoom.wrappedValue
    }

    /// Selects or clears the Brain editor only after the window has had a chance to guard unsaved text.
    /// Dragging the graph never calls this; only a tap or an explicit selection does.
    private func selectBrain(_ id: Int?, newEditor: Bool? = nil) {
        let selectionChanges = model.brain.selectedId != id
        let editorChanges = newEditor.map { creating.wrappedValue != $0 } ?? false
        guard selectionChanges || editorChanges else { return }
        model.navigate {
            if let newEditor { creating.wrappedValue = newEditor }
            model.selectBrainNote(id)
        }
    }

    /// Changes whenever the notes or links change, so the layout runs again.
    private func layoutKey(_ graph: BrainGraphData) -> String {
        "\(graph.nodes.map(\.id).hashValue)-\(graph.edges.count)"
    }

    private func relayout(_ graph: BrainGraphData) async {
        let ids = graph.nodes.map(\.id)
        let edges = graph.edges.map { ($0.a, $0.b) }
        let previous = positions.wrappedValue
        let result = await Task.detached(priority: .userInitiated) { BrainLayout.solve(ids: ids, edges: edges, previous: previous) }.value
        positions.wrappedValue = result
    }

    /// The scale from the layout's square to points, and where its middle is.
    private func transform(_ size: CGSize) -> (center: CGPoint, scale: Double) {
        (CGPoint(x: size.width / 2 + pan.wrappedValue.width, y: size.height / 2 + pan.wrappedValue.height),
         Double(min(size.width, size.height)) / 2 * 0.84 * zoom.wrappedValue)
    }

    private func nodeAt(_ point: CGPoint, size: CGSize, state: BrainState) -> Int? {
        let t = transform(size)
        guard t.scale > 0 else { return nil }
        let field = CGPoint(x: (point.x - t.center.x) / CGFloat(t.scale), y: (point.y - t.center.y) / CGFloat(t.scale))
        let visible = state.visibleIds
        let shown = positions.wrappedValue.filter { visible.contains($0.key) }
        return BrainLayout.nearest(to: field, in: shown, within: 16 / t.scale)
    }

    private func radius(_ node: BrainNode) -> CGFloat {
        3.5 + min(8, CGFloat(node.degree).squareRoot() * 2)
    }

    /// The HUD colour of the grid, the rings and the links: the theme's "live" colour (blue in Void).
    private var hud: Color { theme.live.color }

    /// Corner readouts: what is on the screen, and what is locked.
    private func hudReadout(_ state: BrainState, _ graph: BrainGraphData) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("SYS // ONLINE").foregroundStyle(hud.opacity(0.9))
            Text(String(format: "NODES %03d  LINKS %03d  ZOOM %.2f×", graph.nodes.count, graph.edges.count, zoom.wrappedValue)).foregroundStyle(theme.text3.color)
            Text("TARGET: " + (state.note?.title.uppercased() ?? "NONE")).foregroundStyle(state.note == nil ? theme.text3.color : theme.accent.color).lineLimit(1)
        }
        .appFont(.system(size: 9, design: .monospaced)).tracking(0.8)
        .padding(.leading, 22).padding(.top, 20)
        .allowsHitTesting(false)
    }

    /// The grid, three range rings with ticks, and the two axes. They move with the pan and grow with the zoom.
    private func drawGrid(context: GraphicsContext, size: CGSize, t: (center: CGPoint, scale: Double)) {
        let spacing = max(18, min(64, 30 * CGFloat(zoom.wrappedValue)))
        var grid = Path()
        var x = t.center.x.truncatingRemainder(dividingBy: spacing)
        while x < size.width { grid.move(to: CGPoint(x: x, y: 0)); grid.addLine(to: CGPoint(x: x, y: size.height)); x += spacing }
        var y = t.center.y.truncatingRemainder(dividingBy: spacing)
        while y < size.height { grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: size.width, y: y)); y += spacing }
        context.stroke(grid, with: .color(hud.opacity(0.06)), lineWidth: 0.5)
        var axes = Path()
        axes.move(to: CGPoint(x: 0, y: t.center.y)); axes.addLine(to: CGPoint(x: size.width, y: t.center.y))
        axes.move(to: CGPoint(x: t.center.x, y: 0)); axes.addLine(to: CGPoint(x: t.center.x, y: size.height))
        context.stroke(axes, with: .color(hud.opacity(0.10)), lineWidth: 0.6)
        let scale = CGFloat(t.scale)
        for fraction in [0.34, 0.67, 1.0] as [CGFloat] {
            let r = scale * fraction
            let ring = Path(ellipseIn: CGRect(x: t.center.x - r, y: t.center.y - r, width: r * 2, height: r * 2))
            context.stroke(ring, with: .color(hud.opacity(0.17)), style: StrokeStyle(lineWidth: 0.7, dash: [1.5, 5]))
        }
        var ticks = Path()
        for step in 0..<36 {
            let angle = Double(step) * .pi / 18, long = step % 3 == 0, outer = scale, inner = scale - (long ? 8 : 4)
            ticks.move(to: CGPoint(x: t.center.x + cos(angle) * inner, y: t.center.y + sin(angle) * inner))
            ticks.addLine(to: CGPoint(x: t.center.x + cos(angle) * outer, y: t.center.y + sin(angle) * outer))
        }
        context.stroke(ticks, with: .color(hud.opacity(0.28)), lineWidth: 0.8)
    }

    private func draw(context: GraphicsContext, size: CGSize, state: BrainState, graph: BrainGraphData) {
        let t = transform(size)
        drawGrid(context: context, size: size, t: t)
        let visible = state.visibleIds
        let matched = state.matchedIds
        let selected = state.selectedId
        // A snapshot has no async task to lay the graph out: solve it here, once.
        let pos = snapshot ? BrainLayout.solve(ids: graph.nodes.map(\.id), edges: graph.edges.map { ($0.a, $0.b) }, previous: [:]) : positions.wrappedValue
        func point(_ id: Int) -> CGPoint? {
            guard let p = pos[id] else { return nil }
            return CGPoint(x: t.center.x + p.x * CGFloat(t.scale), y: t.center.y + p.y * CGFloat(t.scale))
        }
        // Links first: thin HUD lines; the ones that touch the target light up.
        for edge in graph.edges where visible.contains(edge.a) && visible.contains(edge.b) {
            guard let a = point(edge.a), let b = point(edge.b) else { continue }
            var path = Path()
            path.move(to: a)
            path.addLine(to: b)
            let touchesSelected = selected == edge.a || selected == edge.b
            let color = touchesSelected ? theme.accent.color.opacity(0.95) : hud.opacity(matched == nil ? 0.34 : 0.10)
            context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: touchesSelected ? 1.5 : 0.8, dash: edge.auto ? [2, 4] : []))
        }
        // Then the nodes as small targets: a core, a ring, and a second dashed ring for the hubs.
        let neighbours = Set(graph.edges.filter { $0.a == selected || $0.b == selected }.flatMap { [$0.a, $0.b] })
        for node in graph.nodes where visible.contains(node.id) {
            guard let p = point(node.id) else { continue }
            let r = radius(node)
            let dim = matched.map { !$0.contains(node.id) } ?? false
            let color = kindColor(node.kind, theme).opacity(dim ? 0.22 : 1)
            let ring = Path(ellipseIn: CGRect(x: p.x - r - 2.5, y: p.y - r - 2.5, width: (r + 2.5) * 2, height: (r + 2.5) * 2))
            if node.ghost {
                context.stroke(ring, with: .color(theme.text3.color.opacity(dim ? 0.2 : 0.8)), style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
            } else {
                let core = Path(ellipseIn: CGRect(x: p.x - r * 0.62, y: p.y - r * 0.62, width: r * 1.24, height: r * 1.24))
                var lit = context
                if theme.usesGlow && !dim { lit.addFilter(.shadow(color: color.opacity(0.75), radius: 5)) }
                lit.fill(core, with: .color(color))
                context.stroke(ring, with: .color(color.opacity(dim ? 0.15 : 0.55)), lineWidth: 0.8)
                if node.degree >= 4 {
                    let outer = Path(ellipseIn: CGRect(x: p.x - r - 6, y: p.y - r - 6, width: (r + 6) * 2, height: (r + 6) * 2))
                    context.stroke(outer, with: .color(color.opacity(dim ? 0.1 : 0.3)), style: StrokeStyle(lineWidth: 0.7, dash: [2, 3]))
                }
            }
            if node.id == selected {
                // The target lock: four corner brackets around the node.
                let reach = r + 11, arm: CGFloat = 5
                var lock = Path()
                for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] as [(CGFloat, CGFloat)] {
                    let corner = CGPoint(x: p.x + sx * reach, y: p.y + sy * reach)
                    lock.move(to: CGPoint(x: corner.x - sx * arm, y: corner.y)); lock.addLine(to: corner); lock.addLine(to: CGPoint(x: corner.x, y: corner.y - sy * arm))
                }
                context.stroke(lock, with: .color(theme.accent.color), lineWidth: 1.5)
            }
            let named = node.id == selected || neighbours.contains(node.id) || (matched?.contains(node.id) ?? false) || zoom.wrappedValue > 1.5 || node.degree >= 4
            if named && !dim {
                let name = node.title.count > 24 ? String(node.title.prefix(23)) + "…" : node.title
                let label = Text(name.uppercased())
                    .appFont(.system(size: 8.5, weight: node.id == selected ? .semibold : .regular, design: .monospaced), scaledBy: textSize)
                    .foregroundStyle(theme.text.color.opacity(node.ghost ? 0.6 : 0.9))
                context.draw(label, at: CGPoint(x: p.x, y: p.y + r + 10), anchor: .top)
            }
        }
    }
}

/// Four corner brackets around a rectangle, like a viewfinder.
private struct HUDBrackets: Shape {
    func path(in rect: CGRect) -> Path {
        let arm: CGFloat = 16
        var path = Path()
        for (x, y, dx, dy) in [(rect.minX, rect.minY, 1.0, 1.0), (rect.maxX, rect.minY, -1.0, 1.0), (rect.maxX, rect.maxY, -1.0, -1.0), (rect.minX, rect.maxY, 1.0, -1.0)] as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
            path.move(to: CGPoint(x: x + dx * arm, y: y)); path.addLine(to: CGPoint(x: x, y: y)); path.addLine(to: CGPoint(x: x, y: y + dy * arm))
        }
        return path
    }
}

// MARK: - the side panel

/// The open note: read it, change it, follow its links; or the search results; or the form for a new note.
private struct BrainSidePanel: View {
    let model: IslandModel
    let creating: State<Bool>
    /// Create was pressed and the runtime has not answered yet: the editor closes when a note arrives, and stays (with its text) when an error does.
    private let submitted = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        let state = model.brain
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                if let problem = state.error { ProblemLine(text: problem) }
                if creating.wrappedValue {
                    NoteEditor(model: model, note: nil, creating: creating, submitted: submitted).id("new")
                        // The runtime answered with a note while the new-note editor was open: the note was made, so the editor closes. An error does not
                        // close it (the text stays, the problem shows above).
                        .onChange(of: state.note?.id) { _, _ in
                            if submitted.wrappedValue {
                                model.markEdited("brain-note", false)
                                creating.wrappedValue = false
                                submitted.wrappedValue = false
                            }
                        }
                        .onChange(of: state.error) { _, error in if error != nil { submitted.wrappedValue = false } }
                } else if let note = state.note {
                    NoteEditor(model: model, note: note, creating: creating, submitted: submitted).id("note-\(note.id)") // stable per note: an id with the date and title recreated the editor whenever the runtime pushed a change, and wiped what was being typed
                    BrainLinksSection(model: model, title: "Links to", links: note.links)
                    BrainLinksSection(model: model, title: "Linked from", links: note.backlinks)
                } else if let hits = state.hits, !state.query.trimmingCharacters(in: .whitespaces).isEmpty {
                    BrainHitsSection(model: model, hits: hits)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Pick a note").appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                        Text("Click a dot to read it. A dashed line is a link ATOM found itself. A dashed ring is a note nobody wrote yet; open it and write it.")
                            .appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(Spacing.panel)
        }
    }
}

private struct BrainLinksSection: View {
    let model: IslandModel
    let title: String
    let links: [BrainLink]
    @Environment(\.theme) private var theme

    var body: some View {
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("// \(title) · \(links.count)".uppercased()).appFont(.system(size: 9.5, weight: .medium, design: .monospaced)).tracking(0.8).foregroundStyle(theme.text3.color)
                ForEach(links) { link in
                    Button {
                        guard model.brain.selectedId != link.id else { return }
                        model.navigate { model.selectBrainNote(link.id) }
                    } label: {
                        HStack(spacing: 8) {
                            Circle().fill(kindColor(link.kind, theme)).frame(width: 7, height: 7).opacity(link.ghost ? 0.4 : 1)
                            Text(link.title).appFont(.system(size: 12.5)).foregroundStyle(link.ghost ? theme.text3.color : theme.text.color).lineLimit(1)
                            if link.auto { Text("found by ATOM").appFont(.system(size: 10)).foregroundStyle(theme.text3.color) }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 3)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct BrainHitsSection: View {
    let model: IslandModel
    let hits: [BrainHit]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(hits.isEmpty ? "No note matches" : "\(hits.count) match\(hits.count == 1 ? "" : "es")").appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(hits) { hit in
                Button {
                    guard model.brain.selectedId != hit.id else { return }
                    model.navigate { model.selectBrainNote(hit.id) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Circle().fill(kindColor(hit.kind, theme)).frame(width: 7, height: 7)
                            Text(hit.title).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                        }
                        Text(hit.snippet).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// A note's title and text, for reading, or for changing when it is the user's own. `note` nil: a new note.
private struct NoteEditor: View {
    let model: IslandModel
    let note: BrainNoteData?
    let creating: State<Bool>
    let submitted: State<Bool>
    private let title: State<String>
    private let text: State<String>
    private let confirming = State(initialValue: false)
    private let restoringSource = State(initialValue: false)
    @Environment(\.theme) private var theme

    init(model: IslandModel, note: BrainNoteData?, creating: State<Bool>, submitted: State<Bool>) {
        self.model = model
        self.note = note
        self.creating = creating
        self.submitted = submitted
        self.title = State(initialValue: note?.title ?? "")
        self.text = State(initialValue: note?.body ?? "")
    }

    private var editable: Bool { note == nil || note!.isEditable }
    private var changed: Bool {
        guard let note else {
            return !title.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return title.wrappedValue != note.title || text.wrappedValue != note.body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let note {
                HStack(spacing: 6) {
                    Image(systemName: note.kind.symbol).appFont(.system(size: 10.5)).foregroundStyle(kindColor(note.kind, theme))
                    Text((note.ghost ? "Not written yet" : note.kind.title).uppercased()).appFont(.system(size: 9.5, design: .monospaced)).tracking(0.8).foregroundStyle(theme.text3.color)
                    Spacer(minLength: 0)
                    if let date = note.updatedAt, !note.ghost { Text(date.formatted(date: .abbreviated, time: .omitted)).appFont(.system(size: 11)).foregroundStyle(theme.text3.color) }
                }
            } else {
                Text("New note").appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            }
            if let source = note?.source {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Imported · \(source.state)").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                    Text(source.path + "/" + source.relativePath).appFont(.system(size: 10.5, design: .monospaced)).foregroundStyle(theme.text3.color).textSelection(.enabled)
                    Text("Checked \(source.checkedAt). Edits here stay in ATOM. Delete excludes this copy from refresh; the original file stays untouched.")
                        .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                    if source.state == "corrected" || source.state == "conflict" {
                        PillButton(title: "Use file version…", symbol: "arrow.counterclockwise") { restoringSource.wrappedValue = true }
                            .disabled(changed || model.brainSourcePending != nil)
                    }
                }
            }
            if let note, !note.ghost, note.kind == .note {
                let included = model.dailyBrief.settings.preparationNoteIds.contains(note.id)
                DisclosureGroup(included ? "Included in suggestions" : "Suggestions") {
                    VStack(alignment: .leading, spacing: 6) {
                        Toggle("Use this note for prepared work", isOn: Binding(get: { included }, set: { model.selectPreparationNote(note.id, included: $0) }))
                            .disabled(model.dailyBrief.preparationBudget == nil || (!included && (changed || note.source?.state == "missing" || note.source?.state == "conflict")))
                        Text("When Prepare work for review is on, an excerpt of this saved note and future saved changes may go to the selected model. Missing/conflicting copies are skipped. Suggestions stay on Dashboard; this note never enters the delivered brief. Remove it here or clear selected notes in Daily brief settings.")
                            .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                        if let error = model.dailyBrief.error { ProblemLine(text: error) }
                    }.padding(.top, 5)
                }
                .appFont(.system(size: 11.5))
                .onAppear { if let command = model.dailyBrief.open() { model.send(command) } }
            }
            if editable {
                TextField("Title", text: title.projectedValue)
                    .textFieldStyle(.plain)
                    .appFont(.system(size: 15, weight: .semibold, design: theme.titleDesign))
                    .foregroundStyle(theme.text.color)
                SoulField(label: "Note", text: text.projectedValue, lines: 9)
                AskAtomPanel(model: model, text: text) // upgrades.md B3: change the text by asking
                Text("Link notes with [[Title]]. Tag with #tag.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                HStack(spacing: 8) {
                    SaveButton(title: note == nil ? "Create" : "Save", enabled: changed) {
                        if note == nil { submitted.wrappedValue = true }
                        model.saveBrainNote(id: note?.id, title: title.wrappedValue, body: text.wrappedValue)
                        // A new note's editor stays open until the runtime answers with the note (the side panel closes it then). The runtime may refuse the
                        // note; closing at once threw away the title and the text with the error (code check, 2026-10-16).
                    }
                    if note == nil {
                        PillButton(title: "Cancel") {
                            model.markEdited("brain-note", false)
                            submitted.wrappedValue = false
                            creating.wrappedValue = false
                        }
                    } else if confirming.wrappedValue {
                        PillButton(title: "Cancel") { confirming.wrappedValue = false }
                        PillButton(title: "Delete for good", prominent: true) {
                            confirming.wrappedValue = false
                            if let id = note?.id { model.deleteBrainNote(id) }
                        }
                    } else if let note, !note.ghost {
                        PillButton(title: "Delete", symbol: "trash") { confirming.wrappedValue = true }
                    }
                    Spacer(minLength: 0)
                }
            } else if let note {
                Text(note.title).appFont(.system(size: 15, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                Text(note.body.isEmpty ? "(empty)" : note.body).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Text("ATOM mirrors this from its memory, so it changes there. Forget it on the Memory tab.")
                    .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            }
            if let note, !note.tags.isEmpty {
                HStack(spacing: 5) {
                    ForEach(note.tags, id: \.self) { tag in
                        Text("#\(tag)").appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                            .padding(.horizontal, 8).frame(height: 20).background(Capsule().fill(theme.fill1.color))
                    }
                }
            }
        }
        .tracksEdits(model, "brain-note", changed) // leaving the page with unsaved text asks first
        .confirmationDialog("Replace this ATOM copy with the current source file and discard its saved local corrections? The source file stays untouched.", isPresented: restoringSource.projectedValue) {
            Button("Use file version", role: .destructive) { if let id = note?.id { model.requestBrainSource("restore", id: id) } }
            Button("Cancel", role: .cancel) {}
        }
        // The runtime changed this note (ATOM edited it, or it was saved): take the new text only where nothing was typed.
        .onChange(of: note?.body) { old, new in if text.wrappedValue == (old ?? "") { text.wrappedValue = new ?? "" } }
        .onChange(of: note?.title) { old, new in if title.wrappedValue == (old ?? "") { title.wrappedValue = new ?? "" } }
    }
}
