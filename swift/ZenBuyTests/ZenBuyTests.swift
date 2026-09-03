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

    func testReportHTMLUnescapeNamedAndNumericEntities() {
        XCTAssertEqual(ReportHTML.unescape("A &amp; B &#183; C &middot; D"), "A & B · C · D")
        XCTAssertEqual(ReportHTML.unescape("arrow &#x2192; here"), "arrow → here")
        XCTAssertEqual(ReportHTML.unescape("times &#215;"), "times ×")
    }

    func testReportHTMLRepairsUTF8Mojibake() {
        // UTF-8 middot (C2 B7) mis-decoded byte-as-scalar → Â·
        let middotMojibake = String(bytes: [0xC2, 0xB7], encoding: .isoLatin1)!
        XCTAssertEqual(ReportHTML.repairMojibake("Growth 9/10\(middotMojibake) Moat"), "Growth 9/10· Moat")
        // UTF-8 arrow (E2 86 92)
        let arrowMojibake = String(bytes: [0xE2, 0x86, 0x92], encoding: .isoLatin1)!
        XCTAssertEqual(ReportHTML.repairMojibake("bear \(arrowMojibake) $140"), "bear → $140")
        // UTF-8 multiply (C3 97)
        let timesMojibake = String(bytes: [0xC3, 0x97], encoding: .isoLatin1)!
        XCTAssertEqual(ReportHTML.repairMojibake("38\(timesMojibake) sales"), "38× sales")
    }

    func testReportHTMLProgressiveHoldsIncompleteList() {
        let html = """
        <h2>BOTTOM LINE</h2>
        <ul><li>Complete bullet</li><li>Still writing
        """
        let parsed = ReportHTML.parseProgressive(html)
        XCTAssertTrue(parsed.isIncomplete)
        XCTAssertEqual(parsed.nodes.count, 2)
        guard case let .list(items) = parsed.nodes[1] else {
            return XCTFail("Expected list of complete items only, got \(parsed.nodes)")
        }
        XCTAssertEqual(items.count, 1)
        XCTAssertTrue(parsed.incompleteTail.contains("<li>Still writing"))
    }

    func testReportHTMLProgressiveHoldsIncompleteParagraph() {
        let html = #"<h2>MOAT</h2><p>Wide moat via <a href="https://finance.yahoo.com">Yahoo"#
        let parsed = ReportHTML.parseProgressive(html)
        XCTAssertTrue(parsed.isIncomplete)
        XCTAssertEqual(parsed.nodes.count, 1)
        guard case let .heading(_, text) = parsed.nodes[0] else {
            return XCTFail("Expected heading only")
        }
        XCTAssertEqual(text, "MOAT")
        XCTAssertTrue(parsed.incompleteTail.hasPrefix("<p>"))
    }

    func testReportHTMLDropsScoreDumpWhenScorecardPresent() {
        let html = """
        <h2>SUMMARY</h2>
        <p>Growth: 9/10 · Moat: 8/10 · Management: 7/10 · Valuation: 2/10 · Balance sheet: 7/10 · Catalysts: 6/10 · Overall: 6/10</p>
        <ul><li>12-mo: +3.3% expected</li></ul>
        """
        let parsed = ReportHTML.parseProgressive(html, hasScorecard: true)
        let sections = ReportHTML.sections(from: parsed.nodes, hasScorecard: true)
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections[0].title, "SUMMARY")
        XCTAssertFalse(sections[0].nodes.contains { node in
            if case let .paragraph(inlines) = node {
                return inlines.contains { inline in
                    if case let .text(s) = inline { return s.lowercased().contains("growth:") }
                    return false
                }
            }
            return false
        })
        guard case let .list(items) = sections[0].nodes.first else {
            return XCTFail("Expected outlook list to remain")
        }
        XCTAssertEqual(items.count, 1)
    }

    func testReportHTMLSkipsEmptySectionHeaders() {
        let html = "<h2>CATALYSTS AND RISKS</h2>"
        let sections = ReportHTML.sections(from: ReportHTML.parse(html))
        XCTAssertTrue(sections.isEmpty)
    }

    func testReportHTMLLiftsCitationChips() {
        let html = """
        <h2>SECTOR AND MACRO</h2>
        <p>Tech mixed. Fact · <a class="src-link" href="https://finance.yahoo.com/quote/AAPL">Yahoo</a> · today.</p>
        """
        let nodes = ReportHTML.parse(html)
        let sections = ReportHTML.sections(from: nodes)
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections[0].sources.map(\.label), ["Yahoo"])
        guard case let .paragraph(inlines) = sections[0].nodes.first else {
            return XCTFail("Expected paragraph")
        }
        XCTAssertTrue(inlines.contains(.text("Yahoo")))
        XCTAssertFalse(inlines.contains { if case .link = $0 { return true }; return false })
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
        XCTAssertEqual(vm.report.activeRequest?.symbols, ["AAPL"])
        XCTAssertTrue(vm.report.isStreaming)
        vm.report.cancel()
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
        XCTAssertEqual(vm.report.activeRequest?.symbols, ["AAPL", "MSFT"])
        XCTAssertEqual(vm.report.activeRequest?.mode, .comparative)
        vm.report.cancel()
    }

    func testReportStreamPolicyReusesInFlightAndCompleted() {
        let request = ReportRequest(symbols: ["DDOG"], mode: .separate, directive: "growth", profitHorizonYears: 12)
        XCTAssertTrue(
            ReportStreamPolicy.shouldStartNewStream(
                incoming: request,
                active: nil,
                isStreaming: false,
                didFinishSuccessfully: false
            )
        )
        XCTAssertFalse(
            ReportStreamPolicy.shouldStartNewStream(
                incoming: request,
                active: request,
                isStreaming: true,
                didFinishSuccessfully: false
            )
        )
        XCTAssertFalse(
            ReportStreamPolicy.shouldStartNewStream(
                incoming: request,
                active: request,
                isStreaming: false,
                didFinishSuccessfully: true
            )
        )
        let other = ReportRequest(symbols: ["AAPL"], mode: .separate, directive: "growth", profitHorizonYears: 12)
        XCTAssertTrue(
            ReportStreamPolicy.shouldStartNewStream(
                incoming: other,
                active: request,
                isStreaming: true,
                didFinishSuccessfully: false
            )
        )
        XCTAssertTrue(
            ReportStreamPolicy.shouldStartNewStream(
                incoming: request,
                active: request,
                isStreaming: false,
                didFinishSuccessfully: false
            )
        )
    }

    func testReportStreamPolicyRetriesLostConnection() {
        XCTAssertTrue(ReportStreamPolicy.shouldRetryTransport(URLError(.networkConnectionLost)))
        XCTAssertTrue(ReportStreamPolicy.shouldRetryTransport(ZenBuyAPIError.transport(URLError(.timedOut))))
        XCTAssertFalse(ReportStreamPolicy.shouldRetryTransport(URLError(.badServerResponse)))
        XCTAssertFalse(ReportStreamPolicy.shouldRetryTransport(ZenBuyAPIError.invalidURL))
    }

    func testProcessingReconnectingCopy() {
        XCTAssertEqual(ProcessingPhase.reconnecting.copy, "Still generating…")
    }

    @MainActor
    func testEnsureStartedDoesNotDuplicateInFlight() {
        let vm = ReportViewModel(api: ZenBuyAPIClient())
        vm.ensureStarted(symbols: ["DDOG"], mode: .separate, directive: "growth", profitHorizonYears: 12)
        XCTAssertTrue(vm.isStreaming)
        let first = vm.activeRequest
        vm.ensureStarted(symbols: ["DDOG"], mode: .separate, directive: "growth", profitHorizonYears: 12)
        XCTAssertEqual(first, vm.activeRequest)
        XCTAssertTrue(vm.isStreaming)
        vm.cancel()
    }

    func testFlowLayoutSizingNeverReturnsInfinity() {
        XCTAssertEqual(FlowLayoutSizing.wrapWidth(proposalWidth: nil), 10_000)
        XCTAssertEqual(FlowLayoutSizing.wrapWidth(proposalWidth: .infinity), 10_000)
        XCTAssertEqual(FlowLayoutSizing.wrapWidth(proposalWidth: 0), 10_000)
        XCTAssertEqual(FlowLayoutSizing.wrapWidth(proposalWidth: -1), 10_000)
        XCTAssertEqual(FlowLayoutSizing.wrapWidth(proposalWidth: 320), 320)

        XCTAssertEqual(FlowLayoutSizing.reportedWidth(proposalWidth: nil, usedWidth: 180), 180)
        XCTAssertEqual(FlowLayoutSizing.reportedWidth(proposalWidth: .infinity, usedWidth: 180), 180)
        XCTAssertEqual(FlowLayoutSizing.reportedWidth(proposalWidth: 0, usedWidth: 180), 180)
        XCTAssertEqual(FlowLayoutSizing.reportedWidth(proposalWidth: 320, usedWidth: 180), 320)
        XCTAssertFalse(FlowLayoutSizing.reportedWidth(proposalWidth: nil, usedWidth: 42).isInfinite)
        XCTAssertEqual(FlowLayoutSizing.reportedHeight(usedHeight: 24), 24)
    }

    func testReportVerboseLogDeadlineIsSep17_2026_0700UTC() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let expected = calendar.date(
            from: DateComponents(year: 2026, month: 9, day: 17, hour: 7, minute: 0, second: 0)
        )!
        XCTAssertEqual(ReportVerboseLog.deadlineUTC, expected)
        // Before deadline → enabled; at/after → off (zero permanent noisy prod logs).
        XCTAssertEqual(ReportVerboseLog.enabled, Date() < expected)
    }

    func testReportHTMLHasVisibleContentRequiresSections() {
        XCTAssertFalse(
            ReportHTML.hasVisibleContent(bottomLineHTML: "", bodyHTML: "", scorecardHTML: "")
        )
        // Header-only sticky is visible via plainText so fallback can take over
        // after done. Mid-stream empty chrome is handled by shouldShowProcessingPanel.
        XCTAssertTrue(
            ReportHTML.hasVisibleContent(
                bottomLineHTML: "<h2>BOTTOM LINE</h2>",
                bodyHTML: "",
                scorecardHTML: ""
            )
        )
        XCTAssertTrue(
            ReportHTML.hasVisibleContent(
                bottomLineHTML: "<h2>BOTTOM LINE</h2><p>Buy AAPL.</p>",
                bodyHTML: "",
                scorecardHTML: ""
            )
        )
        XCTAssertEqual(ReportHTML.fallbackPlainText("<h2>X</h2>"), "X")
        XCTAssertEqual(ReportHTML.fallbackPlainText("   "), "Receiving report…")
    }

    func testReportHTMLHasVisibleContentTreatsUnsectionedPlainTextAsVisible() {
        XCTAssertTrue(
            ReportHTML.hasVisibleContent(
                bottomLineHTML: "<h2>BOTTOM LINE</h2>",
                bodyHTML: "",
                scorecardHTML: ""
            )
        )
        XCTAssertTrue(
            ReportHTML.hasVisibleContent(
                bottomLineHTML: "Buy AAPL on the dip.",
                bodyHTML: "",
                scorecardHTML: ""
            )
        )
        XCTAssertTrue(
            ReportHTML.hasVisibleContent(
                bottomLineHTML: "",
                bodyHTML: "<div>Unsectioned body copy.</div>",
                scorecardHTML: ""
            )
        )
        XCTAssertFalse(
            ReportHTML.hasVisibleContent(
                bottomLineHTML: "<div>   </div>",
                bodyHTML: "",
                scorecardHTML: ""
            )
        )
    }

    func testShouldShowProcessingPanelHidesAfterDoneWhenEmpty() {
        XCTAssertTrue(
            ReportStreamPolicy.shouldShowProcessingPanel(
                hasError: false,
                hasVisibleReportContent: false,
                isStreaming: true,
                didFinishSuccessfully: false,
                processingIsVisible: true
            ),
            "Mid-stream empty chrome must keep the panel"
        )
        XCTAssertFalse(
            ReportStreamPolicy.shouldShowProcessingPanel(
                hasError: false,
                hasVisibleReportContent: false,
                isStreaming: false,
                didFinishSuccessfully: true,
                processingIsVisible: false
            ),
            "After done + hide, empty content must not pin Report ready"
        )
        XCTAssertTrue(
            ReportStreamPolicy.shouldShowProcessingPanel(
                hasError: false,
                hasVisibleReportContent: false,
                isStreaming: false,
                didFinishSuccessfully: true,
                processingIsVisible: true
            ),
            "onDone may keep the panel visible for the ~700ms hide delay"
        )
        XCTAssertFalse(
            ReportStreamPolicy.shouldShowProcessingPanel(
                hasError: true,
                hasVisibleReportContent: false,
                isStreaming: false,
                didFinishSuccessfully: true,
                processingIsVisible: true
            )
        )
        XCTAssertEqual(
            ReportStreamPolicy.emptyFinishedReportMessageIfNeeded(
                bottomLineHTML: "",
                bodyHTML: "",
                scorecardHTML: ""
            ),
            ReportStreamPolicy.emptyFinishedReportMessage
        )
        XCTAssertNil(
            ReportStreamPolicy.emptyFinishedReportMessageIfNeeded(
                bottomLineHTML: "<p>Buy</p>",
                bodyHTML: "",
                scorecardHTML: ""
            )
        )
    }

    func testReportStreamEventMetaToleratesMissingShowAsOf() {
        let event = SSEEvent(name: "meta", data: #"{"cached":true,"asOf":"2026-01-01"}"#)
        let parsed = ReportStreamEvent(sseEvent: event)
        guard case let .meta(cached, asOf, showAsOf) = parsed else {
            return XCTFail("Expected meta without showAsOf")
        }
        XCTAssertTrue(cached)
        XCTAssertEqual(asOf, "2026-01-01")
        XCTAssertFalse(showAsOf)
    }

    func testReportStreamEventStickyToleratesMissingHtmlAndOddBadges() {
        let missingHtml = SSEEvent(
            name: "sticky",
            data: #"{"badges":{"recommendation":"Buy"},"scorecardHtml":null}"#
        )
        let parsedMissing = ReportStreamEvent(sseEvent: missingHtml)
        guard case let .sticky(html, badges, scorecard) = parsedMissing else {
            return XCTFail("Expected sticky with missing bottomLineHtml")
        }
        XCTAssertEqual(html, "")
        XCTAssertEqual(badges?.recommendation, "Buy")
        XCTAssertNil(scorecard)

        let oddBadges = SSEEvent(
            name: "sticky",
            data: #"{"bottomLineHtml":"<p>Buy AAPL.</p>","badges":["Buy"],"scorecardHtml":""}"#
        )
        let parsedOdd = ReportStreamEvent(sseEvent: oddBadges)
        guard case let .sticky(oddHtml, oddBadge, _) = parsedOdd else {
            return XCTFail("Expected sticky to survive odd badges")
        }
        XCTAssertEqual(oddHtml, "<p>Buy AAPL.</p>")
        XCTAssertNil(oddBadge)

        let nullHtml = SSEEvent(name: "sticky", data: #"{"bottomLineHtml":null}"#)
        let parsedNull = ReportStreamEvent(sseEvent: nullHtml)
        guard case let .sticky(nullBottom, _, _) = parsedNull else {
            return XCTFail("Expected sticky with null bottomLineHtml")
        }
        XCTAssertEqual(nullBottom, "")
    }

    func testReportStreamEventBodyToleratesMissingHtml() {
        let event = SSEEvent(name: "body", data: #"{"streaming":true}"#)
        let parsed = ReportStreamEvent(sseEvent: event)
        guard case let .body(html) = parsed else {
            return XCTFail("Expected body with missing html")
        }
        XCTAssertEqual(html, "")
    }

    func testReportStreamEventDoneCapturesReportId() {
        let event = SSEEvent(
            name: "done",
            data: #"{"badges":{"recommendation":"HOLD"},"reportId":"report:separate:growth:h12:AAPL"}"#
        )
        let parsed = ReportStreamEvent(sseEvent: event)
        guard case let .done(badges, reportId) = parsed else {
            return XCTFail("Expected done")
        }
        XCTAssertEqual(badges?.recommendation, "HOLD")
        XCTAssertEqual(reportId, "report:separate:growth:h12:AAPL")
    }

    func testReportStreamEventCompaniesFallback() {
        let event = SSEEvent(
            name: "companies",
            data: #"{"companies":[{"symbol":"AAPL","bottomLineHtml":"<p>Buy</p>","bodyHtml":"<h2>FUNDAMENTALS</h2>","scorecardHtml":"","badges":{"recommendation":"Buy"}}],"mode":"separate"}"#
        )
        let parsed = ReportStreamEvent(sseEvent: event)
        guard case let .companies(bottom, body, _, badges) = parsed else {
            return XCTFail("Expected companies fallback, got \(String(describing: parsed))")
        }
        XCTAssertEqual(bottom, "<p>Buy</p>")
        XCTAssertTrue(body.contains("FUNDAMENTALS"))
        XCTAssertEqual(badges?.recommendation, "Buy")
    }

    func testReportCacheKeyMatchesWorker() {
        XCTAssertEqual(
            ReportCacheKey.make(
                mode: .separate,
                symbols: ["AAPL"],
                directive: "growth",
                profitHorizonYears: 12
            ),
            "report:separate:growth:h12:AAPL"
        )
        XCTAssertEqual(
            ReportCacheKey.make(
                mode: .comparative,
                symbols: ["MSFT", "aapl"],
                directive: "growth",
                profitHorizonYears: 12
            ),
            "report:comparative:growth:h12:AAPL,MSFT"
        )
    }

    func testSSEEventParserSplitsOnlyOnCRLFAndKeepsLongJSON() {
        let html = "<p>Line\u{2028}separator and a lot of body " + String(repeating: "x", count: 8_000) + "</p>"
        let payload = #"{"html":"\#(html)"}"#
        let wire = "event: body\ndata: \(payload)\n\nevent: done\ndata: {\"reportId\":\"report:separate:growth:h12:AAPL\"}\n\n"

        var parser = SSEEventParser()
        let events = parser.feed(Data(wire.utf8)) + parser.finish()
        XCTAssertEqual(events.map(\.name), ["body", "done"])
        XCTAssertTrue(events[0].data.contains("\u{2028}"), "U+2028 must stay inside JSON, not split the event")
        XCTAssertGreaterThan(events[0].data.count, 8_000)

        let parsed = ReportStreamEvent(sseEvent: events[0])
        guard case let .body(parsedHtml) = parsed else {
            return XCTFail("Expected body from long SSE line")
        }
        XCTAssertTrue(parsedHtml.contains("\u{2028}"))
        XCTAssertGreaterThan(parsedHtml.count, 8_000)
    }

    func testSSEEventParserHandlesCRLFCommentsAndPartialChunks() {
        var parser = SSEEventParser()
        var events: [SSEEvent] = []
        events += parser.feed(Data("event: meta\r\n".utf8))
        events += parser.feed(Data("data: {\"cached\":true}\r\n\r\n".utf8))
        events += parser.feed(Data(": ka\n\n".utf8))
        events += parser.feed(Data("event: sticky\ndata: {\"bottomLineHtml\":\"<p>Hi</p>\"}\n\n".utf8))
        events += parser.finish()

        XCTAssertEqual(events.map(\.name), ["meta", "sticky"])
        let meta = ReportStreamEvent(sseEvent: events[0])
        guard case let .meta(cached, _, _) = meta else {
            return XCTFail("Expected meta")
        }
        XCTAssertTrue(cached)
        let sticky = ReportStreamEvent(sseEvent: events[1])
        guard case let .sticky(html, _, _) = sticky else {
            return XCTFail("Expected sticky")
        }
        XCTAssertEqual(html, "<p>Hi</p>")
    }

    func testEmptyFinishedReportMessageIncludesSSETrace() {
        let text = ReportStreamPolicy.emptyFinishedReportMessage(trace: ["meta", "done"])
        XCTAssertTrue(text.contains(ReportStreamPolicy.emptyFinishedReportMessage))
        XCTAssertTrue(text.contains("sse meta done"))
        XCTAssertTrue(ReportStreamPolicy.shouldRetryEmptyStream(retryCount: 0))
        XCTAssertFalse(ReportStreamPolicy.shouldRetryEmptyStream(retryCount: 1))
    }

    func testShouldStartNewStreamAfterEmptyFinish() {
        let request = ReportRequest(
            symbols: ["AAPL"],
            mode: .separate,
            directive: "growth",
            profitHorizonYears: 12
        )
        XCTAssertTrue(
            ReportStreamPolicy.shouldStartNewStream(
                incoming: request,
                active: request,
                isStreaming: false,
                didFinishSuccessfully: false
            ),
            "Empty finish must not pin didFinishSuccessfully so Generate again restarts"
        )
    }
}
