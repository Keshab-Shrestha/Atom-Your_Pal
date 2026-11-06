import SwiftUI
import ArkIslandCore

// ADR-276: notes on a work plan's portions (design reference: Ghostex's plan annotations). A note is per portion: plan text is a
// SwiftUI Text, and a selection inside it cannot be read back, so the portion is the unit, as P2 is its line number.

extension IslandModel {
    func planNotes(_ plan: WorkPlanItem) -> [PlanNote] { settings.planNotes.notes(plan: plan.id, goal: plan.goal) }

    func setPlanNotes(_ notes: [PlanNote], for plan: WorkPlanItem) {
        settings.planNotes = settings.planNotes.saving(notes, plan: plan.id, goal: plan.goal)
    }

    /// Puts every note in the current chat's composer after any draft, opens the chat, and clears the notes. Never sends.
    func sendPlanNotes(_ plan: WorkPlanItem) {
        guard chats?.currentReadOnlyNotice == nil,
              let message = PlanNotes.message(goal: plan.goal, notes: planNotes(plan), portions: plan.portions) else { return }
        composerText = PlanNotes.appending(message, to: composerText)
        setPlanNotes([], for: plan)
        navigate { self.windowPage = .chat }
        composerFocusTick += 1
    }
}

/// The note editor under a portion: one of the three marks and optional words; Add needs a mark or words.
struct PlanNoteEditor: View {
    let portion: PlanPortion
    let add: (PlanNote) -> Void
    let cancel: () -> Void
    @State private var mark: PlanNote.Mark?
    @State private var text = ""
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: max(theme.radiusCard - 2, 0), style: .continuous)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ForEach(PlanNote.Mark.allCases, id: \.self) { choice in
                    Button { mark = mark == choice ? nil : choice } label: {
                        Text(choice.title).appFont(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(mark == choice ? theme.onAccent.color : theme.text2.color)
                            .padding(.horizontal, 10).frame(height: 24)
                            .background(Capsule().fill(mark == choice ? theme.accent.color : theme.fill2.color))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(mark == choice ? .isSelected : [])
                }
            }
            Group {
                if snapshot { Text("Add words (optional)").foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading) }
                else { TextField("Add words (optional)", text: $text, axis: .vertical).textFieldStyle(.plain).lineLimit(1...4).onSubmit(save) }
            }
            .appFont(.system(size: 12.5))
            HStack(spacing: 6) {
                Spacer()
                QuietButton(title: "Cancel", action: cancel)
                QuietButton(title: "Add note", symbol: "plus", action: save)
                    .disabled(PlanNote(portion: portion.n, mark: mark, text: text) == nil)
            }
        }
        .padding(10)
        .background(shape.fill(theme.fill2.color.opacity(0.6)))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Note on P\(portion.n)")
    }

    private func save() {
        guard let note = PlanNote(portion: portion.n, mark: mark, text: text) else { return }
        add(note)
    }
}

/// The plan's notes in the order Send notes numbers them, each with Remove; Send notes puts them in the composer.
struct PlanNotesList: View {
    let model: IslandModel
    let plan: WorkPlanItem
    @Environment(\.theme) private var theme

    var body: some View {
        let notes = model.planNotes(plan).enumerated().sorted { ($0.element.portion, $0.offset) < ($1.element.portion, $1.offset) }.map(\.element)
        if !notes.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(notes.count == 1 ? "1 note" : "\(notes.count) notes").appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text2.color)
                    Spacer()
                    QuietButton(title: "Clear") { model.setPlanNotes([], for: plan) }
                        .help("Remove every note on this plan")
                    QuietButton(title: "Send notes", symbol: "text.append") { model.sendPlanNotes(plan) }
                        .disabled(model.chats?.currentReadOnlyNotice != nil)
                        .help("Put the notes in the chat box as numbered feedback. Nothing is sent until you send it.")
                }
                ForEach(Array(notes.enumerated()), id: \.element.id) { index, note in row(index + 1, note) }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
    }

    private func row(_ number: Int, _ note: PlanNote) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(number).").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).frame(width: 18, alignment: .trailing)
            Text("P\(note.portion)").appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
            if let mark = note.mark {
                Text(mark.title).appFont(.system(size: 10.5, weight: .semibold)).foregroundStyle(color(mark))
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(Capsule().fill(color(mark).opacity(0.14)))
            }
            Text(note.text.isEmpty ? " " : note.text).appFont(.system(size: 12)).foregroundStyle(theme.text.color)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button { model.setPlanNotes(model.planNotes(plan).filter { $0.id != note.id }, for: plan) } label: {
                Glyph(systemName: "xmark").appFont(.system(size: 9, weight: .semibold)).foregroundStyle(theme.text3.color)
            }
            .buttonStyle(.plain).accessibilityLabel("Remove note \(number)").help("Remove this note")
        }
        .accessibilityElement(children: .contain)
    }

    private func color(_ mark: PlanNote.Mark) -> Color {
        switch mark {
        case .looksGood: theme.success.color
        case .clarify: theme.attention.color
        case .needsTests: theme.problem.color
        }
    }
}
