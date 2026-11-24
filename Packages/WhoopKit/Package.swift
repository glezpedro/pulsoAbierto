// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "WhoopKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WhoopKit", targets: ["WhoopKit"])
    ],
    targets: [
        .target(name: "WhoopKit", path: "Sources/WhoopKit"),
        .testTarget(name: "WhoopKitTests", dependencies: ["WhoopKit"], path: "Tests/WhoopKitTests")
    ]
)
