// swift-tools-version:6.0
// ARK Island: the macOS app that gives ARK its place on screen (ADR-034).
// ArkIslandCore holds everything testable without a screen; ArkIsland is the app itself.
import PackageDescription

let package = Package(
    name: "ArkIsland",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ArkIsland", targets: ["ArkIsland"]),
        // Calendar and Reminders for the runtime (ADR-060); copied into ARK.app as ark-calendar.
        .executable(name: "ArkCalendar", targets: ["ArkCalendar"]),
        .executable(name: "ArkDocuments", targets: ["ArkDocuments"]),
    ],
    dependencies: [
        // On-device speech recognition (Parakeet on the Neural Engine), Apache-2.0. Pinned: it is pre-1.0 and
        // its API moves between minor versions. Only the app target uses it; the testable core does not.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5"),
        // Native VT emulator; the standard library has no interactive terminal renderer (ADR-186).
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", exact: "1.19.0"),
    ],
    targets: [
        .target(name: "ArkPTY"),
        .target(name: "ArkIslandCore", dependencies: ["ArkPTY"]),
        .executableTarget(
            name: "ArkIsland",
            dependencies: ["ArkIslandCore", .product(name: "FluidAudio", package: "FluidAudio"), .product(name: "SwiftTerm", package: "SwiftTerm")]
        ),
        .executableTarget(name: "ArkCalendar"),
        .executableTarget(name: "ArkDocuments"),
        .testTarget(name: "ArkIslandCoreTests", dependencies: ["ArkIslandCore"]),
    ]
)
