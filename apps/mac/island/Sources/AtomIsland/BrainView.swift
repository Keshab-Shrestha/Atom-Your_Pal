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

struct BrainPane: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let positions = State(initialValue: [Int: CGPoint]())
    private let zoom = State(initialValue: 1.0)
    private let zoomStart = State(initialValue: 1.0)
    private let pan = State(initialValue: CGSize.zero)
    private let panStart = State(initialValue: CGSize.zero)
    private let words = State(initialValue: "")
    private let creating = State(initialValue: false)
    @Environment(\.theme) private var theme

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let state = model.brain
        VStack(alignment: .leading, spacing: 0) {
            header(state)
            Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5)
            if let graph = state.graph {
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
                Text("Waiting for ATOM…").font(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(Spacing.panel)
                Spacer(minLength: 0)
            }
        }
        .onAppear { model.openBrain() }
    }

    // MARK: header

    @ViewBuilder private func header(_ state: BrainState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Second brain").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text(subtitle(state)).font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                Spacer(minLength: 8)
                searchField
                PillButton(title: "New note", symbol: "plus", prominent: true) {
                    model.selectBrainNote(nil)
                    creating.wrappedValue = true
                }
            }
            if state.graph != nil { legend(state) }
        }
        .padding(.horizontal, Spacing.panel)
        .padding(.top, 28)
        .padding(.bottom, 12)
    }

    private func subtitle(_ state: BrainState) -> String {
        guard let graph = state.graph else { return "Notes that link to each other." }
        let links = graph.edges.count
        let base = "\(graph.noteCount) note\(graph.noteCount == 1 ? "" : "s"), \(links) link\(links == 1 ? "" : "s")"
        return graph.omitted > 0 ? "\(base). \(graph.omitted) less linked notes are not drawn." : base
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(theme.text3.color)
            TextField("Search notes", text: words.projectedValue)
                .textFieldStyle(.plain)
                .font(.system(size: 12.5))
                .frame(width: 170)
                .onChange(of: words.wrappedValue) { _, value in model.searchBrain(value) }
            if !words.wrappedValue.isEmpty {
                Button { words.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
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
                        Text("\(entry.kind.title) \(entry.count)").font(.system(size: 11)).foregroundStyle(hidden ? theme.text3.color : theme.text2.color)
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
                        Text("#\(tag.tag) \(tag.count)").font(.system(size: 11, weight: on ? .semibold : .regular))
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
            Image(systemName: "brain.head.profile").font(.system(size: 26)).foregroundStyle(theme.text3.color)
            Text("Your second brain is empty").font(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color)
            Text("Tell ATOM “Note this in my second brain…”, or write a note yourself. Link notes with [[double brackets]] and tag them with #tags. Facts and conversation notes ATOM keeps appear here too.")
                .font(.system(size: 12)).foregroundStyle(theme.text2.color).multilineTextAlignment(.center).frame(maxWidth: 420)
            PillButton(title: "Write the first note", symbol: "plus", prominent: true) { creating.wrappedValue = true; model.selectBrainNote(nil) }
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
                        if let id = nodeAt(value.location, size: proxy.size, state: state) {
                            creating.wrappedValue = false
                            model.selectBrainNote(id)
                        } else {
                            model.selectBrainNote(nil)
                        }
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
        .background(theme.fill1.color.opacity(0.35))
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
        4 + min(9, CGFloat(node.degree).squareRoot() * 2.2)
    }

    private func draw(context: GraphicsContext, size: CGSize, state: BrainState, graph: BrainGraphData) {
        let t = transform(size)
        let visible = state.visibleIds
        let matched = state.matchedIds
        let selected = state.selectedId
        let pos = positions.wrappedValue
        func point(_ id: Int) -> CGPoint? {
            guard let p = pos[id] else { return nil }
            return CGPoint(x: t.center.x + p.x * CGFloat(t.scale), y: t.center.y + p.y * CGFloat(t.scale))
        }
        // Lines first.
        for edge in graph.edges where visible.contains(edge.a) && visible.contains(edge.b) {
            guard let a = point(edge.a), let b = point(edge.b) else { continue }
            var path = Path()
            path.move(to: a)
            path.addLine(to: b)
            let touchesSelected = selected == edge.a || selected == edge.b
            let color = touchesSelected ? theme.accent.color.opacity(0.9) : theme.text3.color.opacity(matched == nil ? 0.38 : 0.14)
            context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: touchesSelected ? 1.6 : 0.9, dash: edge.auto ? [3, 3] : []))
        }
        // Then the dots, and the names of the ones worth naming.
        let neighbours = Set(graph.edges.filter { $0.a == selected || $0.b == selected }.flatMap { [$0.a, $0.b] })
        for node in graph.nodes where visible.contains(node.id) {
            guard let p = point(node.id) else { continue }
            let r = radius(node)
            let dim = matched.map { !$0.contains(node.id) } ?? false
            let color = kindColor(node.kind, theme).opacity(dim ? 0.22 : 1)
            let circle = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
            if node.ghost {
                context.stroke(circle, with: .color(theme.text3.color.opacity(dim ? 0.2 : 0.8)), style: StrokeStyle(lineWidth: 1.2, dash: [2.5, 2.5]))
            } else {
                context.fill(circle, with: .color(color))
            }
            if node.id == selected {
                let ring = Path(ellipseIn: CGRect(x: p.x - r - 4, y: p.y - r - 4, width: (r + 4) * 2, height: (r + 4) * 2))
                context.stroke(ring, with: .color(theme.accent.color), lineWidth: 1.6)
            }
            let named = node.id == selected || neighbours.contains(node.id) || (matched?.contains(node.id) ?? false) || zoom.wrappedValue > 1.5 || node.degree >= 4
            if named && !dim {
                let label = Text(node.title.count > 26 ? String(node.title.prefix(25)) + "…" : node.title)
                    .font(.system(size: 10.5, weight: node.id == selected ? .semibold : .regular))
                    .foregroundStyle(theme.text.color.opacity(node.ghost ? 0.6 : 0.92))
                context.draw(label, at: CGPoint(x: p.x, y: p.y + r + 8), anchor: .top)
            }
        }
    }
}

// MARK: - the side panel

/// The open note: read it, change it, follow its links; or the search results; or the form for a new note.
private struct BrainSidePanel: View {
    let model: IslandModel
    let creating: State<Bool>
    @Environment(\.theme) private var theme

    var body: some View {
        let state = model.brain
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                if let problem = state.error { ProblemLine(text: problem) }
                if creating.wrappedValue {
                    NoteEditor(model: model, note: nil, creating: creating).id("new")
                } else if let note = state.note {
                    NoteEditor(model: model, note: note, creating: creating).id("\(note.id)-\(note.updatedAt?.timeIntervalSince1970 ?? 0)-\(note.title)")
                    BrainLinksSection(model: model, title: "Links to", links: note.links)
                    BrainLinksSection(model: model, title: "Linked from", links: note.backlinks)
                } else if let hits = state.hits, !state.query.trimmingCharacters(in: .whitespaces).isEmpty {
                    BrainHitsSection(model: model, hits: hits)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Pick a note").font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                        Text("Click a dot to read it. A dashed line is a link ATOM found itself. A dashed ring is a note nobody wrote yet; open it and write it.")
                            .font(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
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
                Text("\(title) · \(links.count)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                ForEach(links) { link in
                    Button { model.selectBrainNote(link.id) } label: {
                        HStack(spacing: 8) {
                            Circle().fill(kindColor(link.kind, theme)).frame(width: 7, height: 7).opacity(link.ghost ? 0.4 : 1)
                            Text(link.title).font(.system(size: 12.5)).foregroundStyle(link.ghost ? theme.text3.color : theme.text.color).lineLimit(1)
                            if link.auto { Text("found by ATOM").font(.system(size: 10)).foregroundStyle(theme.text3.color) }
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
            Text(hits.isEmpty ? "No note matches" : "\(hits.count) match\(hits.count == 1 ? "" : "es")").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(hits) { hit in
                Button { model.selectBrainNote(hit.id) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Circle().fill(kindColor(hit.kind, theme)).frame(width: 7, height: 7)
                            Text(hit.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                        }
                        Text(hit.snippet).font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(2)
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
    private let title: State<String>
    private let text: State<String>
    private let confirming = State(initialValue: false)
    @Environment(\.theme) private var theme

    init(model: IslandModel, note: BrainNoteData?, creating: State<Bool>) {
        self.model = model
        self.note = note
        self.creating = creating
        self.title = State(initialValue: note?.title ?? "")
        self.text = State(initialValue: note?.body ?? "")
    }

    private var editable: Bool { note == nil || note!.isEditable }
    private var changed: Bool {
        guard let note else { return !title.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty }
        return title.wrappedValue != note.title || text.wrappedValue != note.body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let note {
                HStack(spacing: 6) {
                    Image(systemName: note.kind.symbol).font(.system(size: 10.5)).foregroundStyle(kindColor(note.kind, theme))
                    Text(note.ghost ? "Not written yet" : note.kind.title).font(.system(size: 11)).foregroundStyle(theme.text3.color)
                    Spacer(minLength: 0)
                    if let date = note.updatedAt, !note.ghost { Text(date.formatted(date: .abbreviated, time: .omitted)).font(.system(size: 11)).foregroundStyle(theme.text3.color) }
                }
            } else {
                Text("New note").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            }
            if editable {
                TextField("Title", text: title.projectedValue)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15, weight: .semibold, design: theme.titleDesign))
                    .foregroundStyle(theme.text.color)
                TextEditor(text: text.projectedValue)
                    .font(.system(size: 12.5))
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 180)
                    .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.fill1.color))
                    .overlay(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
                Text("Link notes with [[Title]]. Tag with #tag.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                HStack(spacing: 8) {
                    SaveButton(title: note == nil ? "Create" : "Save", enabled: changed) {
                        model.saveBrainNote(id: note?.id, title: title.wrappedValue, body: text.wrappedValue)
                        creating.wrappedValue = false
                    }
                    if note == nil {
                        PillButton(title: "Cancel") { creating.wrappedValue = false }
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
                Text(note.title).font(.system(size: 15, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                Text(note.body.isEmpty ? "(empty)" : note.body).font(.system(size: 12.5)).foregroundStyle(theme.text.color).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Text("ATOM mirrors this from its memory, so it changes there. Forget it in Settings → Memory.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            }
            if let note, !note.tags.isEmpty {
                HStack(spacing: 5) {
                    ForEach(note.tags, id: \.self) { tag in
                        Text("#\(tag)").font(.system(size: 11)).foregroundStyle(theme.text2.color)
                            .padding(.horizontal, 8).frame(height: 20).background(Capsule().fill(theme.fill1.color))
                    }
                }
            }
        }
    }
}
