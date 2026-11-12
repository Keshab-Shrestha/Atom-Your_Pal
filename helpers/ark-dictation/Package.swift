// swift-tools-version:6.0
// ark-dictation: the Parakeet speech-to-text helper of the Rust app. It speaks line JSON on stdio
// (the contract of ark_speech::HelperListener). ArkDictationCore has the protocol and the session logic
// and needs no microphone or model, so it is unit-tested. Only the executable uses FluidAudio.
import PackageDescription

let package = Package(
    name: "ark-dictation",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ark-dictation", targets: ["ark-dictation"])],
    dependencies: [
        // Apache-2.0. Same pin as apps/mac/island: the API moves between minor versions.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5"),
    ],
    targets: [
        .target(name: "ArkDictationCore"),
        .executableTarget(
            name: "ark-dictation",
            dependencies: ["ArkDictationCore", .product(name: "FluidAudio", package: "FluidAudio")]
        ),
        .testTarget(name: "ArkDictationCoreTests", dependencies: ["ArkDictationCore"]),
    ]
)
