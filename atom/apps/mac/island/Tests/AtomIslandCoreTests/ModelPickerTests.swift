import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Provider model picker")
struct ModelPickerTests {
    private var info: ModelInfo {
        ModelInfo(provider: "codex", model: "shared", providers: [
            ProviderOption(id: "codex", name: "Codex", available: true, models: [ModelOption(id: "shared", name: "Fast model"), ModelOption(id: "shared", name: "Duplicate")]),
            ProviderOption(id: "claude-plan", name: "Claude", available: true, models: [ModelOption(id: "shared", name: "Deep model")]),
            ProviderOption(id: "gemini-cli", name: "Gemini", available: false, models: [ModelOption(id: "other", name: "Other model")])
        ])
    }
    private var all: [ModelPickerEntry] { ModelPickerCatalog.entries(info: info, currentProvider: "codex", currentModel: "shared") }

    @Test func identitiesAreProviderScopedAndDuplicatesAreRemoved() {
        #expect(all.count == 3)
        #expect(Set(all.map(\.id)).count == 3)
        #expect(all[0].name == "Fast model")
        #expect(all[0].id != all[1].id)
    }

    @Test func searchMatchesProviderNameModelIdAndNameWithAllWords() {
        #expect(ModelPickerCatalog.filtered(all, query: "  codex FAST  ", provider: nil, favoritesOnly: false, favorites: []).map(\.name) == ["Fast model"])
        #expect(ModelPickerCatalog.filtered(all, query: "shared", provider: nil, favoritesOnly: false, favorites: []).count == 2)
        #expect(ModelPickerCatalog.filtered(all, query: "no-match", provider: nil, favoritesOnly: false, favorites: []).isEmpty)
    }

    @Test func filtersIntersectAndUnavailableProvidersRemainExplicit() {
        let stars: Set<String> = [all[0].id]
        #expect(ModelPickerCatalog.filtered(all, query: "", provider: "claude-plan", favoritesOnly: true, favorites: stars).isEmpty)
        #expect(ModelPickerCatalog.filtered(all, query: "", provider: nil, favoritesOnly: true, favorites: stars) == [all[0]])
        #expect(all.last?.available == false)
    }

    @Test func activeCustomModelAppearsOnlyUnderItsProvider() {
        let entries = ModelPickerCatalog.entries(info: info, currentProvider: "claude-plan", currentModel: "custom-v1")
        #expect(entries.filter { $0.model == "custom-v1" }.map(\.provider) == ["claude-plan"])
        #expect(entries.first { $0.model == "custom-v1" }?.available == true)
    }

    @Test @MainActor func favoritesPersistWithoutSelectingAModelAndCanBeRemoved() {
        let suite = "atom.test.model-picker.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = IslandSettings(defaults: defaults)
        settings.toggleFavoriteModel(provider: "codex", model: "shared")
        settings.toggleFavoriteModel(provider: "claude-plan", model: "shared")
        let reopened = IslandSettings(defaults: defaults)
        #expect(reopened.favoriteModels.count == 2)
        reopened.toggleFavoriteModel(provider: "codex", model: "shared")
        #expect(IslandSettings(defaults: defaults).favoriteModels == [ModelPickerEntry.key(provider: "claude-plan", model: "shared")])
    }

    @Test @MainActor func savedFavoritesAreBoundedAndRemainRemovableAtTheLimit() {
        let suite = "atom.test.model-picker.limit.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set((0..<200).map { "codex/model-\($0)" }, forKey: IslandSettings.favoriteModelsKey)
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.favoriteModels.count == 128)
        settings.toggleFavoriteModel(provider: "codex", model: "new")
        #expect(settings.favoriteModels.count == 128)
        settings.toggleFavoriteModel(provider: "codex", model: "model-0")
        settings.toggleFavoriteModel(provider: "codex", model: "new")
        #expect(settings.favoriteModels.contains("codex/new"))
        #expect(settings.favoriteModels.count == 128)
    }
}
