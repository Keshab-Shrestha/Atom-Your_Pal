import AppKit
import SwiftUI
import ArkIslandCore

/// ADR-271: the first-run question "What should ARK call you?", over the window until a name is saved. Prefilled with
/// the Mac user's full name. The name is changed later in Settings → General.
struct OwnerWelcomeSheet: View {
    let model: IslandModel
    @State private var name: String
    @Environment(\.theme) private var theme

    init(model: IslandModel, name: String = NSFullUserName()) {
        self.model = model
        _name = State(initialValue: name)
    }

    private var valid: Bool { OwnerName.clean(name) != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("ARK")
                .appFont(.system(size: 13, weight: .bold)).tracking(1.5)
                .foregroundStyle(theme.onAccent.color)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(theme.accent.color))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text("Welcome to ARK").appFont(theme.pageTitleFont(22)).foregroundStyle(theme.text.color).accessibilityAddTraits(.isHeader)
                Text("What should ARK call you? ARK uses this name when it talks to you and in the notes it gives its agents.")
                    .appFont(.system(size: 13)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            }
            InlineField(placeholder: "Your name", text: $name, size: 15, submit: submit) { EmptyView() }
                .accessibilityLabel("Your name")
            HStack {
                Text("You can change it in Settings → General.").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                Spacer(minLength: 12)
                PillButton(title: "Continue", prominent: true, action: submit)
                    .keyboardShortcut(.defaultAction).disabled(!valid)
            }
        }
        .padding(24)
        .frame(width: 420)
        .background(theme.surfaceSolid.color)
        .interactiveDismissDisabled()
    }

    private func submit() {
        guard valid else { return }
        model.setOwnerName(name)
    }
}

/// ADR-271: Settings → General's "Your name" row. Saves on Return or Save.
struct OwnerNameRow: View {
    let model: IslandModel
    @State private var draft = ""
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let saved = model.settings.ownerName ?? ""
        Row(title: "Your name", detail: "ARK calls you this, on screen and in its prompts") {
            InlineField(placeholder: model.ownerDisplayName, text: $draft, submit: save) {
                if !snapshot, OwnerName.clean(draft) != nil, OwnerName.clean(draft) != saved {
                    FieldAction(symbol: "checkmark", label: "Save name", action: save)
                }
            }
            .frame(width: 200)
        }
        .onAppear { draft = saved }
    }

    private func save() {
        guard OwnerName.clean(draft) != nil else { draft = model.settings.ownerName ?? ""; return }
        model.setOwnerName(draft)
        draft = model.settings.ownerName ?? ""
    }
}
