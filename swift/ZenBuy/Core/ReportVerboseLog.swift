import Foundation
import os

/// Temporary verbose report-stream logging for TestFlight diagnosis.
/// Auto-off after 2026-09-02 11:59:59 PM America/Los_Angeles
/// (i.e. `Date() < 2026-09-03 07:00:00 UTC`). After that instant: zero noise.
enum ReportVerboseLog {
    /// Exclusive end: logging enabled strictly before this UTC instant.
    static let deadlineUTC: Date = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(
            from: DateComponents(year: 2026, month: 9, day: 3, hour: 7, minute: 0, second: 0)
        )!
    }()

    static var enabled: Bool { Date() < deadlineUTC }

    private static let logger = Logger(subsystem: "info.zenbuy.app", category: "report")

    static func log(_ message: @autoclosure () -> String) {
        guard enabled else { return }
        // Evaluate first — Logger's string interpolation is an escaping
        // autoclosure and cannot capture a non-escaping `message` parameter
        // (Xcode 26 archive: "escaping autoclosure captures non-escaping parameter").
        let text = message()
        logger.info("\(text, privacy: .public)")
    }

    /// Truncated HTML preview — no secrets/PII; length only + short head.
    static func htmlPreview(_ html: String, limit: Int = 80) -> String {
        let collapsed = html
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if collapsed.count <= limit { return "len=\(html.count) preview=\(collapsed)" }
        let end = collapsed.index(collapsed.startIndex, offsetBy: limit)
        return "len=\(html.count) preview=\(collapsed[..<end])…"
    }
}
