// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "ScreenCapture",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "ScreenCapture",
            path: "Sources/ScreenCapture",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("AVFoundation"),
            ]
        )
    ]
)
