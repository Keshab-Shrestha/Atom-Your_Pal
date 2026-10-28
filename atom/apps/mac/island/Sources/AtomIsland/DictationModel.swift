import FluidAudio
import Foundation
import AtomIslandCore

/// Speech to text with Parakeet TDT v3 on the Apple Neural Engine (ADR-047). The only file that touches FluidAudio,
/// so the engine can be swapped without changing anything else.
actor DictationModel {
    enum ModelError: Error, CustomStringConvertible {
        case notLoaded
        case loadFailed(String)

        var description: String {
            switch self {
            case .notLoaded: "The speech model is not loaded yet."
            case .loadFailed(let detail):
                "The speech model could not be loaded (\(detail)). It is downloaded on first use, so check the internet connection and try again."
            }
        }
    }

    private var manager: AsrManager?
    private var vocabulary = DictationVocabulary.builtIn

    /// Whether the model files are already on this Mac (so loading needs no download).
    static var isDownloaded: Bool {
        AsrModels.modelsExist(at: AsrModels.defaultCacheDirectory())
    }

    var isLoaded: Bool { manager != nil }

    /// Loads the model (downloading it first if it is not on this Mac). Slow the first time; call it at launch,
    /// off the key-press path.
    func load() async throws {
        guard manager == nil else { return }
        do {
            let models = try await AsrModels.downloadAndLoad(version: .v3)
            manager = AsrManager(config: .default, models: models)
        } catch {
            throw ModelError.loadFailed("\(error)")
        }
    }

    /// Replaces the user's spelling fixes. The built-in ones always apply.
    func setVocabulary(_ user: DictationVocabulary) {
        vocabulary = DictationVocabulary.builtIn.merging(user)
    }

    /// Transcribes one recording (16 kHz mono). Short clips are padded first. The text is as the model wrote it;
    /// `polish` applies the user's spelling fixes.
    func transcribe(_ samples: [Float]) async throws -> String {
        guard let manager else { throw ModelError.notLoaded }
        var state = TdtDecoderState.make()
        let result = try await manager.transcribe(DictationAudio.padded(samples), decoderState: &state)
        return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The user's spelling fixes (and the built-in ones), whichever engine wrote the text.
    func polish(_ text: String) -> String { vocabulary.apply(to: text) }
}
