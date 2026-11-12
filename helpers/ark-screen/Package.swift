// swift-tools-version:6.0
// ark-screen: screenshot, Accessibility tree and point marker for the Rust app, as line JSON on stdio.
// It posts no input events: input stays in Rust (ark-computer) behind the policy and the approver.
// ArkScreenCore has the wire format and the command logic and needs no screen, so it is unit-tested.
import PackageDescription

let package = Package(
    name: "ark-screen",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ark-screen", targets: ["ark-screen"])],
    targets: [
        .target(name: "ArkScreenCore"),
        .executableTarget(name: "ark-screen", dependencies: ["ArkScreenCore"]),
        .testTarget(name: "ArkScreenCoreTests", dependencies: ["ArkScreenCore"]),
    ]
)
