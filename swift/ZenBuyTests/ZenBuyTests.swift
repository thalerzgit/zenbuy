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

    func testProcessingEstimateMatchesWeb() {
        XCTAssertEqual(ProcessingProgressLogic.estimateProcessingMs(symbolCount: 1, mode: .separate), 85_000)
        XCTAssertEqual(ProcessingProgressLogic.estimateProcessingMs(symbolCount: 2, mode: .separate), 155_000)
        XCTAssertEqual(ProcessingProgressLogic.estimateProcessingMs(symbolCount: 2, mode: .comparative), 145_000)
    }

    func testProcessingEtaCopy() {
        XCTAssertEqual(ProcessingProgressLogic.formatEta(remainingMs: 0, percent: 100), "Complete")
        XCTAssertEqual(ProcessingProgressLogic.formatEta(remainingMs: 4_000, percent: 90), "Almost there…")
        XCTAssertEqual(ProcessingProgressLogic.formatEta(remainingMs: 42_000, percent: 40), "About 42s remaining")
        XCTAssertEqual(ProcessingProgressLogic.formatEta(remainingMs: 70_000, percent: 20), "About 2 min remaining")
    }

    func testProcessingQuotesIncludeDavidMorgenthaler() {
        let authors = Set(ProcessingProgressLogic.quotes.map(\.author))
        XCTAssertTrue(authors.contains("David Morgenthaler"))
        XCTAssertGreaterThanOrEqual(ProcessingProgressLogic.quotes.filter { $0.author == "David Morgenthaler" }.count, 8)
    }

    func testWorkerErrorEventUsesErrorField() {
        let event = SSEEvent(
            name: "error",
            data: #"{"error":"We couldn't pull market data for DDOG.","retry":true}"#
        )
        let parsed = ReportStreamEvent(sseEvent: event)
        guard case let .error(message) = parsed else {
            return XCTFail("Expected error event")
        }
        XCTAssertTrue(message.contains("DDOG"))
    }

    func testResearchRequestEncodesProfitHorizon() throws {
        let body = ResearchRequest(symbols: ["DDOG"], mode: .separate, directive: "growth", profitHorizonYears: 12)
        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["profitHorizonYears"] as? Int, 12)
        XCTAssertEqual(json["directive"] as? String, "growth")
    }

    func testDefaultProfitHorizonMatchesWebDirectives() {
        XCTAssertEqual(InvestmentDirectiveInfo.defaultProfitHorizonYears(for: "growth"), 12)
        XCTAssertEqual(InvestmentDirectiveInfo.defaultProfitHorizonYears(for: "aggressive_growth"), 18)
        XCTAssertEqual(InvestmentDirectiveInfo.defaultProfitHorizonYears(for: "conservative"), 5)
    }

    func testTimeoutErrorIsActionable() {
        let error = ZenBuyAPIError.transport(URLError(.timedOut))
        XCTAssertTrue(error.localizedDescription.contains("90 seconds"))
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
