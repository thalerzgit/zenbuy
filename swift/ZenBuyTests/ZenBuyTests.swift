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

    func testReportHTMLParsesHeadingsListsAndLinks() {
        let html = """
        <h2>BOTTOM LINE</h2>
        <p>Buy <strong>AAPL</strong> via <a class="src-link" href="https://example.com">Yahoo</a>.</p>
        <ul><li>Elite FCF</li><li>Premium valuation</li></ul>
        """
        let nodes = ReportHTML.parse(html)
        XCTAssertEqual(nodes.count, 3)
        guard case let .heading(level, text) = nodes[0] else {
            return XCTFail("Expected heading")
        }
        XCTAssertEqual(level, 2)
        XCTAssertEqual(text, "BOTTOM LINE")
        guard case let .paragraph(inlines) = nodes[1] else {
            return XCTFail("Expected paragraph")
        }
        XCTAssertTrue(inlines.contains(.strong("AAPL")))
        XCTAssertTrue(inlines.contains(.link(label: "Yahoo", url: "https://example.com")))
        guard case let .list(items) = nodes[2] else {
            return XCTFail("Expected list")
        }
        XCTAssertEqual(items.count, 2)
    }

    func testReportHTMLParsesScorecard() {
        let html = """
        <div class="scorecard">
          <div class="score-row"><span class="score-label">Growth</span><div class="score-bar"><div class="score-fill" style="width:80%"></div></div><span class="score-num">8/10</span></div>
          <div class="score-row"><span class="score-label">Overall</span><div class="score-bar"><div class="score-fill" style="width:70%"></div></div><span class="score-num">7/10</span></div>
        </div>
        """
        let nodes = ReportHTML.parse(html)
        guard case let .scorecard(rows) = nodes.first else {
            return XCTFail("Expected scorecard")
        }
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].label, "Growth")
        XCTAssertEqual(rows[0].value, "8/10")
        XCTAssertEqual(rows[0].fraction, 0.8, accuracy: 0.001)
    }

    func testReportHTMLParsesTable() {
        let html = """
        <div class="table-scroll"><table><thead><tr><th>Ticker</th><th>Verdict</th></tr></thead>
        <tbody><tr><td>AAPL</td><td>Hold</td></tr></tbody></table></div>
        """
        let nodes = ReportHTML.parse(html)
        guard case let .table(headers, rows) = nodes.first else {
            return XCTFail("Expected table, got \(nodes)")
        }
        XCTAssertEqual(headers, ["Ticker", "Verdict"])
        XCTAssertEqual(rows, [["AAPL", "Hold"]])
    }

    @MainActor
    func testSingleTickerSkipsModeStep() {
        let vm = SearchViewModel(api: ZenBuyAPIClient())
        vm.picks = [SymbolResult(symbol: "AAPL", name: "Apple Inc")]
        vm.beginGenerate()
        XCTAssertEqual(vm.path, [.report])
        XCTAssertEqual(vm.selectedMode, .separate)
    }

    @MainActor
    func testMultiTickerPushesReportModeThenReport() {
        let vm = SearchViewModel(api: ZenBuyAPIClient())
        vm.picks = [
            SymbolResult(symbol: "AAPL", name: "Apple Inc"),
            SymbolResult(symbol: "MSFT", name: "Microsoft"),
        ]
        vm.beginGenerate()
        XCTAssertEqual(vm.path, [.reportMode])
        vm.confirmMode(.comparative)
        XCTAssertEqual(vm.selectedMode, .comparative)
        XCTAssertEqual(vm.path, [.reportMode, .report])
    }
}
