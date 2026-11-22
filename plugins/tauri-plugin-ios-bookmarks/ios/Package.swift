// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-ios-bookmarks",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "tauri-plugin-ios-bookmarks", type: .static, targets: ["IosBookmarksPlugin"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        .package(name: "BookmarkCore", path: "BookmarkCore"),
    ],
    targets: [
        .target(
            name: "IosBookmarksPlugin",
            dependencies: [.byName(name: "Tauri"), .product(name: "BookmarkCore", package: "BookmarkCore")],
            path: "Sources/IosBookmarksPlugin"
        ),
    ]
)
