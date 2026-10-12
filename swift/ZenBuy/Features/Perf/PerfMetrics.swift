#if os(iOS)
import Foundation
import MetricKit
import os

/// iOS-only MetricKit subscriber. Apple publishes no field metrics for ZenBuy
/// yet (install volume is below its threshold), so collect our own daily
/// payloads — launch, hangs, memory, CPU, disk — and diagnostics, and log them
/// for Xcode / Console. No UI, no network, no stored user data.
final class PerfMetrics: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = PerfMetrics()

    private let logger = Logger(subsystem: "info.zenbuy.app", category: "perf")
    private var started = false

    /// Call once from app init. Cheap: registers with MetricKit and marks launch.
    func start() {
        guard !started else { return }
        started = true
        PerfSignpost.event("app.launch")
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            let json = String(decoding: payload.jsonRepresentation(), as: UTF8.self)
            logger.log("metric payload \(json, privacy: .public)")
        }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            let json = String(decoding: payload.jsonRepresentation(), as: UTF8.self)
            logger.log("diagnostic payload \(json, privacy: .public)")
        }
    }
}
#endif
