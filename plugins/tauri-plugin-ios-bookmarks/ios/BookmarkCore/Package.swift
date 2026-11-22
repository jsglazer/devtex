// swift-tools-version:5.9
// Pure vault-bookmark and NSFileCoordinator logic (no Tauri, no UIKit).
// Test on macOS: `swift test` in this folder.
import PackageDescription

let package = Package(
    name: "BookmarkCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "BookmarkCore", targets: ["BookmarkCore"])],
    targets: [
        .target(name: "BookmarkCore", path: "Sources/BookmarkCore"),
        .testTarget(name: "BookmarkCoreTests", dependencies: ["BookmarkCore"], path: "Tests/BookmarkCoreTests"),
    ]
)
