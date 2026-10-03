// swift-tools-version:6.0
// ZENO Island: the macOS app that gives ZENO its place on screen (ADR-034).
// ZenoIslandCore holds everything testable without a screen; ZenoIsland is the app itself.
import PackageDescription

let package = Package(
    name: "ZenoIsland",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ZenoIsland", targets: ["ZenoIsland"]),
        // Calendar and Reminders for the runtime (ADR-060); copied into ZENO.app as zeno-calendar.
        .executable(name: "ZenoCalendar", targets: ["ZenoCalendar"]),
    ],
    dependencies: [
        // On-device speech recognition (Parakeet on the Neural Engine), Apache-2.0. Pinned: it is pre-1.0 and
        // its API moves between minor versions. Only the app target uses it; the testable core does not.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5"),
    ],
    targets: [
        .target(name: "ZenoIslandCore"),
        .executableTarget(
            name: "ZenoIsland",
            dependencies: ["ZenoIslandCore", .product(name: "FluidAudio", package: "FluidAudio")]
        ),
        .executableTarget(name: "ZenoCalendar"),
        .testTarget(name: "ZenoIslandCoreTests", dependencies: ["ZenoIslandCore"]),
    ]
)
