import SwiftUI
import AtomIslandCore

// Form polish (2026-10-31): one input field look for in-place edits (an agent's name, a project's name), after
// EasyUI's form inputs: a filled rounded box, a soft focus ring, and its actions inside the box on the right.

/// A filled input box with its trailing actions inside. In snapshots the field draws as text (`ImageRenderer`
/// cannot draw a text field).
struct InlineField<Trailing: View>: View {
    let placeholder: String
    @Binding var text: String
    var size: CGFloat = 13
    var weight: Font.Weight = .regular
    var submit: () -> Void = {}
    var cancel: (() -> Void)? = nil
    @ViewBuilder var trailing: Trailing
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        HStack(spacing: 6) {
            Group {
                if snapshot {
                    Text(text.isEmpty ? placeholder : text).foregroundStyle(text.isEmpty ? theme.text3.color : theme.text.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField(placeholder, text: $text)
                        .textFieldStyle(.plain)
                        .foregroundStyle(theme.text.color)
                        .focused($focused)
                        .onSubmit(submit)
                        .onExitCommand { cancel?() }
                }
            }
            .appFont(.system(size: size, weight: weight))
            .lineLimit(1)
            trailing
        }
        .padding(.leading, 12).padding(.trailing, 5)
        .frame(minHeight: size + 20)
        .background(theme.fill2.color, in: shape)
        .composerFocus(focused, shape: shape)
    }
}

/// A small round action inside an `InlineField` (save, cancel). Dimmed and inert while not `enabled`.
struct FieldAction: View {
    let symbol: String
    let label: String
    var prominent = false
    var enabled = true
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .appFont(.system(size: 10.5, weight: .bold))
                .foregroundStyle(prominent ? theme.onAccent.color : theme.text2.color)
                .frame(width: 24, height: 24)
                .background(Circle().fill(prominent ? AnyShapeStyle(theme.accentFill) : AnyShapeStyle(theme.fill3.color)))
                .contentShape(Circle())
        }
        .buttonStyle(.pressable)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .help(label)
        .accessibilityLabel(label)
    }
}

/// A settings card: a header with a title (and an optional line under it), then rows separated by hairlines.
struct SettingsCard<Content: View>: View {
    let title: String
    var detail: String? = nil
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).appFont(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                if let detail { Text(detail).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true) }
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color, in: shape)
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// One row of a `SettingsCard`: a hairline above, a title and an optional line under it, the control on the right.
struct SettingsCardRow<Control: View>: View {
    let title: String
    var detail: String? = nil
    @ViewBuilder let control: Control
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5)
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color)
                    if let detail { Text(detail).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 12)
                control
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
        }
    }
}
