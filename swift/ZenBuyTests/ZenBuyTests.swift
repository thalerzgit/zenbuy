import XCTest
@testable import ZenBuy

final class ZenBuyTests: XCTestCase {
    func testReportStreamEventParsesMeta() {
        let event = SSEEvent(
            name: "meta",
            data: #"{"cached":true,"asOf":"2026-01-01","showAsOf":false}"#
        )
        let parsed = ReportStreamEvent(sseEvent: event)
        guard case let .meta(cached, asOf, showAsOf) = parsed else {
            return XCTFail("Expected meta event")
        }
        XCTAssertTrue(cached)
        XCTAssertEqual(asOf, "2026-01-01")
        XCTAssertFalse(showAsOf)
    }

    func testSymbolResultIdentity() {
        let result = SymbolResult(symbol: "AAPL", name: "Apple Inc")
        XCTAssertEqual(result.id, "AAPL")
    }
}
