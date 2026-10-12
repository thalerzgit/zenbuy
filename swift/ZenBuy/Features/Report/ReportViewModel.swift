import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct ReportRequest: Equatable, Sendable {
    let symbols: [String]
    let mode: ReportMode
    let directive: String
    let profitHorizonYears: Int?
}

/// Why the allowance gate refused a report. The distinction matters because
/// only the free allowance is lifted by unlocking — the unlocked daily cap
/// applies to buyers too, and offering them a purchase would be a dead end of
/// its own.
enum ReportQuotaBlock: Equatable, Sendable {
    case freeWeekly
    case unlockedDaily

    init?(error: Error) {
        guard let api = error as? ZenBuyAPIError, case let .quota(code, _) = api else {
            return nil
        }
        self = code == "pro_limit" ? .unlockedDaily : .freeWeekly
    }

    var unlockLifts: Bool { self == .freeWeekly }
}

enum ReportStreamPolicy {
    static let emptyFinishedReportMessage =
        "The report finished, but the content didn't arrive or failed to render. Try Generate again."

    static func shouldStartNewStream(
        incoming: ReportRequest,
        active: ReportRequest?,
        isStreaming: Bool,
        didFinishSuccessfully: Bool
    ) -> Bool {
        guard let active else { return true }
        if active != incoming { return true }
        if isStreaming || didFinishSuccessfully { return false }
        return true
    }

    static func shouldRetryTransport(_ error: Error) -> Bool {
        let underlying: Error
        if let api = error as? ZenBuyAPIError, case let .transport(inner) = api {
            underlying = inner
        } else {
            underlying = error
        }
        guard let urlError = underlying as? URLError else { return false }
        switch urlError.code {
        case .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed, .timedOut, .dataNotAllowed,
             .internationalRoamingOff:
            return true
        default:
            return false
        }
    }

    /// Mid-stream: keep the panel until visible content or error (no empty chrome).
    /// After the stream finishes, never pin the panel open solely because HTML
    /// didn't parse — `processing.isVisible` hides after onDone (~700ms).
    static func shouldShowProcessingPanel(
        hasError: Bool,
        hasVisibleReportContent: Bool,
        isStreaming: Bool,
        didFinishSuccessfully: Bool,
        processingIsVisible: Bool
    ) -> Bool {
        if hasError { return false }
        if didFinishSuccessfully || !isStreaming {
            return processingIsVisible
        }
        if !hasVisibleReportContent { return true }
        return processingIsVisible
    }

    static func emptyFinishedReportMessageIfNeeded(
        bottomLineHTML: String,
        bodyHTML: String,
        scorecardHTML: String
    ) -> String? {
        isEmptyReport(
            bottomLineHTML: bottomLineHTML,
            bodyHTML: bodyHTML,
            scorecardHTML: scorecardHTML
        ) ? emptyFinishedReportMessage : nil
    }

    static func isEmptyReport(
        bottomLineHTML: String,
        bodyHTML: String,
        scorecardHTML: String
    ) -> Bool {
        bottomLineHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && bodyHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && scorecardHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static let partialReportWarning =
        "Report may be incomplete — tap Generate to refresh."

    static func warningFromDone(warning: String?) -> String? {
        guard let warning, !warning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return warning
    }

    /// SSE `error` after a painted report is a soft warning — do not block Share.
    static func shouldTreatErrorAsWarning(hasVisibleContent: Bool) -> Bool {
        hasVisibleContent
    }

    static func shouldRetryEmptyStream(retryCount: Int, maxRetries: Int = 1) -> Bool {
        retryCount < maxRetries
    }

    static func emptyFinishedReportMessage(trace: [String]) -> String {
        guard !trace.isEmpty else { return emptyFinishedReportMessage }
        let tail = trace.suffix(8).joined(separator: " ")
        return "\(emptyFinishedReportMessage)\nsse \(tail)"
    }
}

@Observable
@MainActor
final class ReportViewModel {
    var bottomLineHTML = ""
    var bodyHTML = ""
    var scorecardHTML = ""
    var badges: ReportBadges?
    var isStreaming = false
    var errorMessage: String?
    var warningMessage: String?
    var didFinishSuccessfully = false
    /// Set when the allowance gate refused this report, so a client can offer
    /// the way past it instead of only printing the refusal.
    private(set) var quotaBlock: ReportQuotaBlock?
    /// Successor reports hide "Show more like this" to avoid rabbit holes.
    private(set) var allowSimilar = true
    private(set) var similarSymbols: [String] = []
    /// True after sector gate was skipped (Widen) or Worker fell back.
    private(set) var similarWidened = false
    private(set) var isFindingSimilar = false
    private(set) var similarError: String?
    private(set) var activeRequest: ReportRequest?
    let processing = ProcessingProgress()
    /// Parsed snapshot of the three HTML fragments, rebuilt off the main thread
    /// (latest-wins) whenever they change. Views draw this, never the parser.
    private(set) var render = ReportRenderModel.empty

    private let api: ZenBuyAPIClient
    private var streamTask: Task<Void, Never>?
    private var pendingBody = ""
    private var lastFlush = Date.distantPast
    private let flushInterval: TimeInterval = 0.12
    private var streamGeneration = 0
    private var resumeAttempts = 0
    private let maxResumeAttempts = 2
    private var abandoned = false
    @ObservationIgnored private var cachedShare: (key: ShareCacheKey, url: URL, data: Data)?
    /// Bumped whenever `render` is replaced; keys the Share PDF cache instead of
    /// concatenating every HTML fragment.
    @ObservationIgnored private var renderVersion = 0
    private var lastReportId: String?
    private var sseTrace: [String] = []
    private var emptyContentRetries = 0
    @ObservationIgnored private var queuedRender: ReportRenderInputs?
    @ObservationIgnored private var renderTask: Task<Void, Never>?
    @ObservationIgnored private var renderEpoch = 0
    private let maxEmptyContentRetries = 1
    #if os(iOS)
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    #endif

    init(api: ZenBuyAPIClient) {
        self.api = api
    }

    func ensureStarted(
        symbols: [String],
        mode: ReportMode,
        directive: String,
        profitHorizonYears: Int? = nil
    ) {
        let request = ReportRequest(
            symbols: symbols,
            mode: mode,
            directive: directive,
            profitHorizonYears: profitHorizonYears
        )
        guard ReportStreamPolicy.shouldStartNewStream(
            incoming: request,
            active: activeRequest,
            isStreaming: isStreaming,
            didFinishSuccessfully: didFinishSuccessfully
        ) else { return }
        start(request)
    }

    func start(
        symbols: [String],
        mode: ReportMode,
        directive: String,
        profitHorizonYears: Int? = nil
    ) {
        start(
            ReportRequest(
                symbols: symbols,
                mode: mode,
                directive: directive,
                profitHorizonYears: profitHorizonYears
            )
        )
    }

    /// "Run Report on these?" — one hop only, so the successor offers no peers.
    func startSimilar(
        symbols: [String],
        mode: ReportMode,
        directive: String,
        profitHorizonYears: Int? = nil
    ) {
        start(
            symbols: symbols,
            mode: mode,
            directive: directive,
            profitHorizonYears: profitHorizonYears
        )
        allowSimilar = false
    }

    var canOfferSimilar: Bool {
        allowSimilar
            && didFinishSuccessfully
            && !isStreaming
            && activeRequest?.mode == .separate
    }

    func findSimilar(sector: Bool = true) {
        guard let request = activeRequest, let symbol = request.symbols.first else { return }
        guard !isFindingSimilar else { return }
        // First find only when empty; Widen may replace an existing chip set.
        if sector, !similarSymbols.isEmpty { return }
        isFindingSimilar = true
        similarError = nil

        Task {
            do {
                let payload = try await api.similar(
                    symbol: symbol,
                    scores: ReportHTML.scoreProfile(from: scorecardHTML),
                    exclude: request.symbols,
                    sector: sector
                )
                similarSymbols = payload.symbols
                similarWidened = payload.widened ?? !sector
                if payload.symbols.isEmpty {
                    similarError = "No similar names found right now. Try again later."
                }
            } catch {
                similarError = (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
            }
            isFindingSimilar = false
        }
    }

    /// Re-fetch peers without the sector gate (escape hatch after chips appear).
    func widenSimilar() {
        guard !similarWidened else { return }
        findSimilar(sector: false)
    }

    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            guard !abandoned, !isStreaming, !didFinishSuccessfully, let request = activeRequest else { return }
            resume(request)
        case .background, .inactive:
            break
        @unknown default:
            break
        }
    }

    /// Explicit abandon only. Leaving the report screen or backgrounding must not call this.
    func cancel() {
        ReportVerboseLog.log("stream cancel generation=\(streamGeneration)")
        abandoned = true
        streamGeneration += 1
        streamTask?.cancel()
        streamTask = nil
        processing.hide()
        isStreaming = false
        endResearchBackgroundTask()
    }

    private func start(_ request: ReportRequest) {
        streamGeneration += 1
        let generation = streamGeneration
        streamTask?.cancel()
        abandoned = false
        resumeAttempts = 0
        activeRequest = request
        bottomLineHTML = ""
        bodyHTML = ""
        scorecardHTML = ""
        pendingBody = ""
        resetRender()
        badges = nil
        errorMessage = nil
        warningMessage = nil
        quotaBlock = nil
        didFinishSuccessfully = false
        isStreaming = true
        lastFlush = .distantPast
        cachedShare = nil
        lastReportId = nil
        sseTrace = []
        emptyContentRetries = 0
        allowSimilar = true
        similarSymbols = []
        similarWidened = false
        isFindingSimilar = false
        similarError = nil
        processing.start(symbolCount: request.symbols.count, mode: request.mode)
        beginResearchBackgroundTask()
        ReportVerboseLog.log(
            "stream start gen=\(generation) symbols=\(request.symbols.joined(separator: ",")) mode=\(request.mode.rawValue) directive=\(request.directive) verbose=\(ReportVerboseLog.enabled)"
        )

        streamTask = Task { [weak self] in
            await self?.consume(request, generation: generation)
        }
    }

    private func resume(_ request: ReportRequest) {
        guard resumeAttempts < maxResumeAttempts else { return }
        streamGeneration += 1
        let generation = streamGeneration
        streamTask?.cancel()
        resumeAttempts += 1
        abandoned = false
        errorMessage = nil
        isStreaming = true
        processing.markReconnecting()
        beginResearchBackgroundTask()
        ReportVerboseLog.log("stream resume gen=\(generation) attempt=\(resumeAttempts)")

        streamTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.consume(request, generation: generation)
        }
    }

    private func consume(_ request: ReportRequest, generation: Int) async {
        do {
            let stream = api.streamResearch(
                symbols: request.symbols,
                mode: request.mode,
                directive: request.directive,
                profitHorizonYears: request.profitHorizonYears
            )

            for try await event in stream {
                guard generation == streamGeneration, !abandoned else { return }
                switch event {
                case .meta:
                    recordTrace("meta")
                    ReportVerboseLog.log("sse meta phase=\(processing.phase.rawValue)")
                    processing.onMeta()
                case let .sticky(bottomLineHtml, badges, scorecardHtml):
                    recordTrace("sticky:\(bottomLineHtml.count)")
                    processing.onSticky()
                    bottomLineHTML = bottomLineHtml
                    self.badges = badges
                    scorecardHTML = scorecardHtml ?? ""
                    scheduleRender()
                    PerfSignpost.event("report.firstSticky")
                    // Parse only when verbose logging is on (autoclosure) — never per event on main.
                    ReportVerboseLog.log(
                        "sse sticky \(ReportVerboseLog.htmlPreview(bottomLineHtml)) scorecardLen=\(self.scorecardHTML.count) visible=\(ReportHTML.hasVisibleContent(bottomLineHTML: self.bottomLineHTML, bodyHTML: self.bodyHTML, scorecardHTML: self.scorecardHTML)) processingVisible=\(self.processing.isVisible)"
                    )
                case let .body(html):
                    recordTrace("body:\(html.count)")
                    processing.onBody()
                    // Worker re-sends the full rendered body each SSE event (web replaces).
                    pendingBody = html
                    flushBodyIfNeeded(force: false)
                    ReportVerboseLog.log(
                        "sse body \(ReportVerboseLog.htmlPreview(html)) phase=\(processing.phase.rawValue) percent=\(Int(processing.percent))"
                    )
                case let .badges(badges):
                    recordTrace("badges")
                    self.badges = badges
                    ReportVerboseLog.log("sse badges")
                case let .companies(bottom, body, score, badges):
                    recordTrace("companies:\(bottom.count)/\(body.count)")
                    applyCompaniesFallback(
                        bottomLineHtml: bottom,
                        bodyHtml: body,
                        scorecardHtml: score,
                        badges: badges
                    )
                case let .done(badges, reportId, warning):
                    recordTrace("done")
                    // Do not clear already-applied HTML. A later long
                    // `companies` drop must not wipe sticky/body.
                    self.badges = badges ?? self.badges
                    if let reportId, !reportId.isEmpty {
                        lastReportId = reportId
                    }
                    warningMessage = ReportStreamPolicy.warningFromDone(warning: warning)
                    await recoverOrFinish(request, generation: generation, reason: "sse done")
                    return
                case let .error(message):
                    recordTrace("error")
                    ReportVerboseLog.log("sse error msgLen=\(message.count)")
                    flushBodyIfNeeded(force: true)
                    if ReportStreamPolicy.shouldTreatErrorAsWarning(
                        hasVisibleContent: !isEmptyHTML()
                    ) {
                        warningMessage = ReportStreamPolicy.partialReportWarning
                        errorMessage = nil
                        await recoverOrFinish(request, generation: generation, reason: "sse error with content")
                        return
                    }
                    errorMessage = message
                    processing.fail()
                    isStreaming = false
                    endResearchBackgroundTask()
                case let .skipped(name, dataLength):
                    recordTrace("skip:\(name):\(dataLength)")
                    ReportVerboseLog.log("sse skipped event=\(name) dataLen=\(dataLength)")
                }
            }
            guard generation == streamGeneration, !abandoned else { return }
            if isStreaming {
                await recoverOrFinish(
                    request,
                    generation: generation,
                    reason: "stream ended without done event"
                )
            } else {
                isStreaming = false
                endResearchBackgroundTask()
            }
        } catch is CancellationError {
            guard generation == streamGeneration, !abandoned else { return }
            ReportVerboseLog.log("stream cancelled gen=\(generation) resumeAttempts=\(resumeAttempts)")
            if resumeAttempts < maxResumeAttempts {
                resume(request)
                return
            }
            processing.hide()
            isStreaming = false
            endResearchBackgroundTask()
        } catch {
            guard generation == streamGeneration, !abandoned else { return }
            ReportVerboseLog.log("stream transport error: \(error.localizedDescription)")
            if ReportStreamPolicy.shouldRetryTransport(error), resumeAttempts < maxResumeAttempts {
                resume(request)
                return
            }
            quotaBlock = ReportQuotaBlock(error: error)
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            processing.fail()
            isStreaming = false
            endResearchBackgroundTask()
        }
    }

    /// Re-run the report the allowance gate refused. The request is unchanged —
    /// only the allowance moved, so this is the whole of "continue where you
    /// left off" after an unlock.
    func retryBlockedRequest() {
        guard let request = activeRequest else { return }
        start(request)
    }

    private func recoverOrFinish(
        _ request: ReportRequest,
        generation: Int,
        reason: String
    ) async {
        flushBodyIfNeeded(force: true)
        guard generation == streamGeneration, !abandoned else { return }
        if !isEmptyHTML() {
            finishSuccessfully(reason: reason)
            return
        }

        let key = lastReportId ?? ReportCacheKey.make(
            mode: request.mode,
            symbols: request.symbols,
            directive: request.directive,
            profitHorizonYears: request.profitHorizonYears
        )
        if let payload = await api.fetchReportIfAvailable(id: key) {
            applyFetchedReport(payload)
            if !isEmptyHTML() {
                ReportVerboseLog.log("rest fallback filled report key=\(key)")
                finishSuccessfully(reason: "rest fallback")
                return
            }
        }

        guard generation == streamGeneration, !abandoned else { return }
        if ReportStreamPolicy.shouldRetryEmptyStream(
            retryCount: emptyContentRetries,
            maxRetries: maxEmptyContentRetries
        ) {
            retryEmptyContent(request)
            return
        }

        finishSuccessfully(reason: reason)
    }

    private func retryEmptyContent(_ request: ReportRequest) {
        emptyContentRetries += 1
        streamGeneration += 1
        let generation = streamGeneration
        isStreaming = true
        didFinishSuccessfully = false
        errorMessage = nil
        processing.markReconnecting()
        beginResearchBackgroundTask()
        ReportVerboseLog.log("empty-content retry gen=\(generation) attempt=\(emptyContentRetries)")
        streamTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.consume(request, generation: generation)
        }
    }

    private func applyFetchedReport(_ payload: CachedReportPayload) {
        if let reportId = payload.reportId, !reportId.isEmpty {
            lastReportId = reportId
        }
        if let html = payload.bottomLineHtml, !html.isEmpty {
            bottomLineHTML = html
        }
        if let html = payload.bodyHtml, !html.isEmpty {
            pendingBody = html
            bodyHTML = html
        }
        if let html = payload.scorecardHtml, !html.isEmpty {
            scorecardHTML = html
        }
        scheduleRender()
        if let badges = payload.badges {
            self.badges = badges
        }
        if let warning = payload.warning, !warning.isEmpty {
            warningMessage = warning
        } else if payload.partial == true {
            warningMessage = ReportStreamPolicy.partialReportWarning
        }
        if !bottomLineHTML.isEmpty {
            processing.onSticky()
        }
        if !bodyHTML.isEmpty {
            processing.onBody()
        }
    }

    private func applyCompaniesFallback(
        bottomLineHtml: String,
        bodyHtml: String,
        scorecardHtml: String?,
        badges: ReportBadges?
    ) {
        if bottomLineHTML.isEmpty, !bottomLineHtml.isEmpty {
            bottomLineHTML = bottomLineHtml
            processing.onSticky()
        }
        if bodyHTML.isEmpty, pendingBody.isEmpty, !bodyHtml.isEmpty {
            pendingBody = bodyHtml
            flushBodyIfNeeded(force: true)
            processing.onBody()
        }
        if scorecardHTML.isEmpty, let scorecardHtml, !scorecardHtml.isEmpty {
            scorecardHTML = scorecardHtml
        }
        scheduleRender()
        if self.badges == nil {
            self.badges = badges
        }
    }

    private func recordTrace(_ token: String) {
        sseTrace.append(token)
        if sseTrace.count > 24 {
            sseTrace.removeFirst(sseTrace.count - 24)
        }
    }

    private func isEmptyHTML() -> Bool {
        ReportStreamPolicy.isEmptyReport(
            bottomLineHTML: bottomLineHTML,
            bodyHTML: bodyHTML,
            scorecardHTML: scorecardHTML
        )
    }

    private func finishSuccessfully(reason: String) {
        flushBodyIfNeeded(force: true)
        ReportVerboseLog.log(
            "\(reason) visible=\(ReportHTML.hasVisibleContent(bottomLineHTML: self.bottomLineHTML, bodyHTML: self.bodyHTML, scorecardHTML: self.scorecardHTML)) bottomLen=\(bottomLineHTML.count) bodyLen=\(bodyHTML.count) scorecardLen=\(scorecardHTML.count) trace=\(sseTrace.joined(separator: ","))"
        )
        if ReportStreamPolicy.isEmptyReport(
            bottomLineHTML: bottomLineHTML,
            bodyHTML: bodyHTML,
            scorecardHTML: scorecardHTML
        ) {
            errorMessage = ReportStreamPolicy.emptyFinishedReportMessage(trace: sseTrace)
            // Not a successful render — allow Generate / onAppear to start again.
            didFinishSuccessfully = false
        } else {
            didFinishSuccessfully = true
        }
        processing.onDone()
        isStreaming = false
        endResearchBackgroundTask()
    }

    private func flushBodyIfNeeded(force: Bool) {
        let now = Date()
        guard force || now.timeIntervalSince(lastFlush) >= flushInterval else { return }
        bodyHTML = pendingBody
        lastFlush = now
        scheduleRender()
    }

    // MARK: - Off-main parse (latest-wins)

    private var liveRenderInputs: ReportRenderInputs {
        ReportRenderInputs(
            bottomLineHTML: bottomLineHTML,
            bodyHTML: bodyHTML,
            scorecardHTML: scorecardHTML
        )
    }

    private func resetRender() {
        renderEpoch += 1
        renderVersion += 1
        queuedRender = nil
        render = .empty
    }

    /// Queue a parse of the current fragments. Only the newest queued inputs are
    /// parsed; intermediate bodies that arrive mid-parse are dropped.
    private func scheduleRender() {
        let inputs = liveRenderInputs
        if inputs.isEmpty {
            resetRender()
            return
        }
        if queuedRender == nil, inputs == render.inputs { return }
        queuedRender = inputs
        guard renderTask == nil else { return }
        renderTask = Task { [weak self] in
            await self?.drainRenderQueue()
        }
    }

    private func drainRenderQueue() async {
        while let inputs = queuedRender {
            queuedRender = nil
            let epoch = renderEpoch
            let model = await Task.detached(priority: .userInitiated) {
                ReportRenderModel.build(inputs)
            }.value
            // A new report (start/reset) since this parse began: drop it.
            if epoch == renderEpoch {
                render = model
                renderVersion += 1
            }
        }
        renderTask = nil
    }

    /// Test hook: wait until the queued parse (if any) has been applied.
    func waitForRender() async {
        while let task = renderTask {
            await task.value
        }
    }

    /// Local PDF for the system share sheet (Files / Messages / Mail / AirDrop).
    /// Returns `nil` when the renderer produced empty/invalid bytes — never a
    /// 0-byte `ZenBuy-*-report.pdf` for Print or Save to Files.
    func sharePDFURL(title: String) async -> URL? {
        await prepareSharePDF(title: title)?.url
    }

    /// Builds the Share PDF off the main thread from the already-parsed render
    /// model (no re-parse), in one render pass, and keeps the bytes in memory
    /// (written to the temp file once, never read back).
    func prepareSharePDF(title: String) async -> (url: URL, data: Data)? {
        #if os(iOS)
        ReportVerboseLog.log("sharePDF attempt titleLen=\(title.count)")
        await waitForRender()
        let live = liveRenderInputs
        let snapshot: ReportRenderModel?
        if render.inputs == live {
            snapshot = render
        } else {
            // Fragments set without a scheduled parse (tests / REST fill): parse now, off main.
            snapshot = nil
        }
        let key = ShareCacheKey(title: title, renderVersion: snapshot == nil ? -1 : renderVersion, badges: badges)

        if let cached = cachedShare, snapshot != nil, cached.key == key {
            // Empty-PDF guard without reading the file back: the temp file must
            // still hold exactly our validated bytes, else rewrite it.
            let size = (try? FileManager.default.attributesOfItem(atPath: cached.url.path)[.size] as? NSNumber)?.intValue
            if size == cached.data.count {
                ReportVerboseLog.log("sharePDF cache hit bytes=\(cached.data.count)")
                return (cached.url, cached.data)
            }
            ReportVerboseLog.log("sharePDF cache file empty or missing — rewriting")
            if let url = ReportPDFExporter.write(cached.data, title: title) {
                cachedShare = (key, url, cached.data)
                return (url, cached.data)
            }
            cachedShare = nil
        }

        let badges = self.badges
        let built = await Task.detached(priority: .userInitiated) { () -> (URL, Data)? in
            let model = snapshot ?? ReportRenderModel.build(live)
            guard let data = ReportPDFExporter.makePDFData(title: title, badges: badges, render: model),
                  ReportPDFValidation.isValidPDF(data),
                  let url = ReportPDFExporter.write(data, title: title) else {
                return nil
            }
            return (url, data)
        }.value
        guard let built else {
            ReportVerboseLog.log("sharePDF failed — exporter returned nil or empty PDF")
            cachedShare = nil
            return nil
        }
        let (url, data) = built
        cachedShare = snapshot == nil ? nil : (key, url, data)
        ReportVerboseLog.log("sharePDF ok bytes=\(data.count)")
        return (url, data)
        #else
        return nil
        #endif
    }

    private func beginResearchBackgroundTask() {
        #if os(iOS)
        endResearchBackgroundTask()
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "zenbuy.research") { [weak self] in
            Task { @MainActor in
                // Time expired — do not cancel the stream; iOS will suspend.
                self?.endResearchBackgroundTask()
            }
        }
        #endif
    }

    private func endResearchBackgroundTask() {
        #if os(iOS)
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
        #endif
    }
}

struct ShareCacheKey: Equatable {
    let title: String
    let renderVersion: Int
    let badges: ReportBadges?
}
