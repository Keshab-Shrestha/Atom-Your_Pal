import ArkDictationCore
import FluidAudio
import Foundation

/// Parakeet TDT v3 on the Neural Engine. Loaded on the first `start`; the first load downloads the model.
actor Parakeet: Transcriber {
    private var manager: AsrManager?

    func transcribe(_ samples: [Float]) async throws -> String {
        if manager == nil {
            manager = AsrManager(config: .default, models: try await AsrModels.downloadAndLoad(version: .v3))
        }
        guard let manager else { return "" }
        var state = TdtDecoderState.make()
        return try await manager.transcribe(samples, decoderState: &state).text
    }
}

final class Output: @unchecked Sendable {
    private let lock = NSLock()
    func write(_ event: Event) {
        lock.lock(); defer { lock.unlock() }
        FileHandle.standardOutput.write(Data((event.line + "\n").utf8))
    }
}

extension DictationCapture: MicSource {}

let output = Output()
let session = Session(audio: DictationCapture(), model: Parakeet(), emit: { output.write($0) })
output.write(.ready)
while let line = readLine() {
    guard let command = Command.parse(line) else { continue }
    await session.handle(command)
}
