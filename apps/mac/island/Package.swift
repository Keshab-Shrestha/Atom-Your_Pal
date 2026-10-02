// swift-tools-version:6.0
// ZENO Island: the macOS app that gives ZENO its place on screen (ADR-034).
// ZenoIslandCore holds everything testable without a screen; ZenoIsland is the app itself.
import PackageDescription

let package = Package(
    name: "ZenoIsland",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ZenoIsland", targets: ["ZenoIsland"]),
    ],
    targets: [
        .target(name: "ZenoIslandCore"),
        .executableTarget(name: "ZenoIsland", dependencies: ["ZenoIslandCore"]),
        .testTarget(name: "ZenoIslandCoreTests", dependencies: ["ZenoIslandCore"]),
    ]
)
