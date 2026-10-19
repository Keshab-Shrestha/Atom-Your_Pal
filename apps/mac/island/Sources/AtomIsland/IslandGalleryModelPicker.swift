import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeModelPicker(to directory: URL) {
        for (name, dark) in [("33-model-picker-dark", true), ("33-model-picker-light", false)] {
            let suite = "atom.gallery.model-picker.\(name).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let settings = IslandSettings(defaults: defaults)
            settings.toggleFavoriteModel(provider: "claude-plan", model: "claude-opus-5-5")
            let model = IslandModel(settings: settings)
            let info = ModelInfo(provider: "codex", model: "gpt-6-luna", providers: [
                ProviderOption(id: "claude-plan", name: "Claude", available: true, models: [
                    ModelOption(id: "claude-opus-5-5", name: "Claude Opus 5.5"),
                    ModelOption(id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5")]),
                ProviderOption(id: "codex", name: "Codex", available: true, models: [
                    ModelOption(id: "gpt-6-luna", name: "GPT-6 Luna"), ModelOption(id: "gpt-6-sol", name: "GPT-6 Sol")]),
                ProviderOption(id: "gemini-cli", name: "Gemini", available: false, models: [ModelOption(id: "gemini", name: "Gemini")])
            ])
            save(ChatModelPicker(model: model, info: info, close: {}).environment(\.islandSnapshot, true)
                .themed(ChatAppearance.palette(dark: dark)), name: name, to: directory)
        }
    }
}
