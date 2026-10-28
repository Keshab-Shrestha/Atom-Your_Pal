import Foundation

/// Provider-scoped model identities keep equal model IDs in different providers separate.
public struct ModelPickerEntry: Sendable, Equatable, Identifiable {
    public let provider: String
    public let providerName: String
    public let model: String
    public let name: String
    public let available: Bool
    public var id: String { Self.key(provider: provider, model: model) }
    public static func key(provider: String, model: String) -> String { provider + "/" + model }
}

public enum ModelPickerCatalog {
    /// Keeps provider order, removes duplicate identities, and includes an active custom model missing from the catalog.
    public static func entries(info: ModelInfo, currentProvider: String, currentModel: String) -> [ModelPickerEntry] {
        var seen = Set<String>()
        var result: [ModelPickerEntry] = []
        for provider in info.providers {
            var models = provider.models
            if provider.id == currentProvider, !models.contains(where: { $0.id == currentModel }) {
                models.append(ModelOption(id: currentModel, name: currentModel))
            }
            for model in models {
                let entry = ModelPickerEntry(provider: provider.id, providerName: provider.name, model: model.id, name: model.name, available: provider.available)
                if seen.insert(entry.id).inserted { result.append(entry) }
            }
        }
        return result
    }

    public static func filtered(_ entries: [ModelPickerEntry], query: String, provider: String?, favoritesOnly: Bool, favorites: Set<String>) -> [ModelPickerEntry] {
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
        return entries.filter { entry in
            (provider == nil || entry.provider == provider)
                && (!favoritesOnly || favorites.contains(entry.id))
                && words.allSatisfy { word in
                    [entry.name, entry.model, entry.providerName].contains { $0.localizedStandardContains(word) }
                }
        }
    }
}
