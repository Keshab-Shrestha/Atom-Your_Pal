import SwiftUI
import AtomIslandCore

/// The AI model: pick a provider, then one of its models, from two menus (replaces the wall of chips).
struct ModelSection: View {
    let model: IslandModel
    /// ADR-097: the "Custom model…" field is open, and what is typed in it.
    @State private var customOpen = false
    @State private var customId = ""
    @Environment(\.theme) private var theme

    var body: some View {
        if let info = model.modelInfo {
            let current = info.currentProvider
            Card(footer: providerNote(current)) {
                Row(title: "Provider") {
                    Menu {
                        ForEach(info.providers) { provider in
                            Button {
                                // Switching provider picks its first model; the runtime confirms.
                                if let first = provider.models.first, provider.id != info.provider {
                                    model.chooseModel(provider: provider.id, model: first.id)
                                }
                            } label: {
                                if provider.id == info.provider { Label(provider.name, systemImage: "checkmark") } else { Text(provider.name) }
                            }
                            .disabled(!provider.available || model.pendingModel != nil)
                        }
                    } label: {
                        MenuLabel(text: current?.name ?? info.provider)
                    }
                    .menuStyle(.button).buttonStyle(.plain).fixedSize()
                }
                RowDivider()
                Row(title: "Model") {
                    HStack(spacing: 6) {
                        if model.pendingModel != nil { ProgressView().controlSize(.mini) }
                        Menu {
                            ForEach(current?.models ?? []) { option in
                                Button {
                                    model.chooseModel(provider: info.provider, model: option.id)
                                } label: {
                                    if option.id == info.model { Label(option.name, systemImage: "checkmark") } else { Text(option.name) }
                                }
                                .disabled(model.pendingModel != nil)
                            }
                            Divider()
                            Button("Custom model…") { customOpen = true }
                        } label: {
                            MenuLabel(text: info.currentModelName, identifier: true)
                        }
                        .menuStyle(.button).buttonStyle(.plain).fixedSize()
                    }
                }
                if customOpen {
                    RowDivider()
                    customRow(provider: info.provider)
                }
                RowDivider()
                Row(title: "Model list", detail: "Asks your Claude plan for its models again") {
                    HStack(spacing: 6) {
                        if model.refreshingModels { ProgressView().controlSize(.mini) }
                        PillButton(title: "Refresh") { model.refreshModels() }
                            .disabled(model.refreshingModels)
                    }
                }
                if let error = model.modelError {
                    RowDivider()
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.problem.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(Spacing.well)
                }
            }
            if info.provider == "claude-plan" { PlanMetersCard(usage: model.planUsage) }
            // ADR-093: the AI tools on this Mac, found or not, and what ATOM does with them.
            Card("Found on this Mac", footer: "Codex and the Gemini CLI answer in chat only: ATOM's tools and the team stay on Claude. Local models (Ollama, LM Studio) are not used.") {
                if info.tools.isEmpty {
                    Row(title: "Looking for AI tools…") { ProgressView().controlSize(.small) }
                }
                ForEach(Array(info.tools.enumerated()), id: \.element.id) { index, tool in
                    if index > 0 { RowDivider() }
                    Row(title: tool.name, detail: tool.note) {
                        StatusDot(color: tool.found ? (tool.signedIn == false ? theme.attention.color : tool.provider == nil ? theme.text3.color : theme.success.color) : theme.text3.color, size: 7)
                    }
                }
                RowDivider()
                Row(title: "Look again", detail: "After installing or signing in to a tool") {
                    PillButton(title: "Scan") { model.send(.toolsScan) }
                }
            }
        } else {
            Card {
                Row(title: "Waiting for ATOM to start…") { ProgressView().controlSize(.small) }
            }
        }
    }

    /// ADR-097: a model id Keshab types for the provider in use. Return saves.
    private func customRow(provider: String) -> some View {
        let id = customId.trimmingCharacters(in: .whitespaces)
        let valid = ModelInfo.isValidModelId(id)
        let save = {
            guard valid else { return }
            model.chooseModel(provider: provider, model: id)
            customOpen = false
            customId = ""
        }
        return Row(title: "Custom model", detail: id.isEmpty || valid ? "The model id, as the provider names it" : "Use up to 100 letters, digits, \".\", \"_\", \":\" or \"-\"") {
            HStack(spacing: 6) {
                TextField("model-id", text: $customId)
                    .textFieldStyle(.plain)
                    .font(theme.idFont(.system(size: 12), size: 11.5))
                    .frame(width: 180)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                        .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
                    .onSubmit(save)
                    .accessibilityLabel("Custom model id")
                SaveButton(enabled: valid && model.pendingModel == nil, action: save)
            }
        }
    }

    private func providerNote(_ provider: ProviderOption?) -> String? {
        guard let provider else { return nil }
        switch provider.id {
        case "claude-plan": return "Runs on your Claude plan, no API key needed."
        case "codex": return "Runs on your ChatGPT plan through Codex. Chat only: ATOM's tools stay with Claude."
        case "gemini-cli": return "Runs on your Google sign-in through the Gemini CLI. Chat only: ATOM's tools stay with Claude."
        default: return nil
        }
    }
}
