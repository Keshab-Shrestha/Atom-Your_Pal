// swift-tools-version:5.9
// Check C3 (ADR-278 Phase 0.2): Rune's embed host inside a SwiftUI view. Not part of apps/mac.
// Build and run with ./build.sh (it builds the Rust static library first).
import PackageDescription

let package = Package(
    name: "EmbedHost",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "EmbedHost",
            linkerSettings: [
                .unsafeFlags(["-L../../../target/debug", "-lark_spike"]),
                .linkedFramework("AppKit"), .linkedFramework("Metal"), .linkedFramework("QuartzCore"),
                .linkedFramework("CoreText"), .linkedFramework("CoreVideo"), .linkedFramework("CoreMedia"),
                .linkedFramework("AVFoundation"), .linkedFramework("CoreAudio"), .linkedFramework("IOSurface"),
                .linkedFramework("Carbon"), .linkedFramework("WebKit"), .linkedLibrary("iconv"),
            ]
        ),
    ]
)
