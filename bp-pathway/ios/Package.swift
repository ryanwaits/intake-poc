// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "BPPathway",
  platforms: [.iOS(.v17), .macOS(.v15)],
  products: [
    .library(name: "BPCore", targets: ["BPCore"]),
    .library(name: "HealthSync", targets: ["HealthSync"]),
  ],
  targets: [
    // The contract, the on-device rules and the sync engine. No HealthKit, so it tests anywhere.
    .target(name: "BPCore"),
    // HealthKit and the API client. The only code that touches the health store or the network.
    .target(
      name: "HealthSync",
      dependencies: ["BPCore"],
      linkerSettings: [.linkedFramework("HealthKit")]
    ),
    .testTarget(name: "BPCoreTests", dependencies: ["BPCore"]),
    // Swift client against the running TS server. ../check.sh starts the server and sets the URL.
    .testTarget(name: "ContractTests", dependencies: ["BPCore", "HealthSync"]),
  ]
)
