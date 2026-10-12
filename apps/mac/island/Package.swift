// swift-tools-version:6.0
// ZENO Island: the macOS app that gives ZENO its place on screen (ADR-034).
// AtomIslandCore holds everything testable without a screen; AtomIsland is the app itself.
import PackageDescription

let package = Package(
    name: "AtomIsland",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AtomIsland", targets: ["AtomIsland"]),
        // Calendar and Reminders for the runtime (ADR-060); copied into ZENO.app as atom-calendar.
        .executable(name: "AtomCalendar", targets: ["AtomCalendar"]),
    ],
    dependencies: [
        // On-device speech recognition (Parakeet on the Neural Engine), Apache-2.0. Pinned: it is pre-1.0 and
        // its API moves between minor versions. Only the app target uses it; the testable core does not.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5"),
    ],
    targets: [
        .target(name: "AtomIslandCore"),
        .executableTarget(
            name: "AtomIsland",
            dependencies: ["AtomIslandCore", .product(name: "FluidAudio", package: "FluidAudio")]
        ),
        .executableTarget(name: "AtomCalendar"),
        .testTarget(name: "AtomIslandCoreTests", dependencies: ["AtomIslandCore"]),
    ]
)
