import SwiftUI
import ZenoIslandCore

/// The AI model: pick a provider, then one of its models, from two menus (replaces the wall of chips).
struct ModelSection: View {
    let model: IslandModel
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
                        } label: {
                            MenuLabel(text: info.currentModelName)
                        }
                        .menuStyle(.button).buttonStyle(.plain).fixedSize()
                    }
                }
                if let error = model.modelError {
                    RowDivider()
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.problem.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(11)
                }
            }
            if info.provider == "claude-plan" { PlanMetersCard(usage: model.planUsage) }
            let unavailable = info.providers.filter { !$0.available }
            if !unavailable.isEmpty {
                Card("Not set up") {
                    ForEach(Array(unavailable.enumerated()), id: \.element.id) { index, provider in
                        if index > 0 { RowDivider() }
                        Row(title: provider.name, detail: provider.id == "claude-plan" ? "Claude Code not found or not signed in" : "No API key in .env") { EmptyView() }
                    }
                }
            }
        } else {
            Card {
                Row(title: "Waiting for ZENO to start…") { ProgressView().controlSize(.small) }
            }
        }
    }

    private func providerNote(_ provider: ProviderOption?) -> String? {
        guard let provider else { return nil }
        if provider.id == "claude-plan" { return "Runs on your Claude plan, no API key needed." }
        return nil
    }
}
