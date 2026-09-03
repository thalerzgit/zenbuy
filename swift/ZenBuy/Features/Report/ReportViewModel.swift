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

enum ReportStreamPolicy {
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
    var didFinishSuccessfully = false
    private(set) var activeRequest: ReportRequest?
    let processing = ProcessingProgress()

    private let api: ZenBuyAPIClient
    private var streamTask: Task<Void, Never>?
    private var pendingBody = ""
    private var lastFlush = Date.distantPast
    private let flushInterval: TimeInterval = 0.12
    private var streamGeneration = 0
    private var resumeAttempts = 0
    private let maxResumeAttempts = 2
    private var abandoned = false
    private var cachedShareKey = ""
    private var cachedShareURL: URL?
    #if canImport(UIKit)
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
        badges = nil
        errorMessage = nil
        didFinishSuccessfully = false
        isStreaming = true
        lastFlush = .distantPast
        cachedShareKey = ""
        cachedShareURL = nil
        processing.start(symbolCount: request.symbols.count, mode: request.mode)
        beginResearchBackgroundTask()

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
                    processing.onMeta()
                case let .sticky(bottomLineHtml, badges, scorecardHtml):
                    processing.onSticky()
                    bottomLineHTML = bottomLineHtml
                    self.badges = badges
                    scorecardHTML = scorecardHtml ?? ""
                case let .body(html):
                    processing.onBody()
                    // Worker re-sends the full rendered body each SSE event (web replaces).
                    pendingBody = html
                    flushBodyIfNeeded(force: false)
                case let .badges(badges):
                    self.badges = badges
                case let .done(badges):
                    self.badges = badges ?? self.badges
                    flushBodyIfNeeded(force: true)
                    processing.onDone()
                    isStreaming = false
                    didFinishSuccessfully = true
                    endResearchBackgroundTask()
                case let .error(message):
                    errorMessage = message
                    flushBodyIfNeeded(force: true)
                    processing.fail()
                    isStreaming = false
                    endResearchBackgroundTask()
                }
            }
            guard generation == streamGeneration, !abandoned else { return }
            flushBodyIfNeeded(force: true)
            if isStreaming {
                processing.onDone()
                didFinishSuccessfully = true
            }
            isStreaming = false
            endResearchBackgroundTask()
        } catch is CancellationError {
            guard generation == streamGeneration, !abandoned else { return }
            if resumeAttempts < maxResumeAttempts {
                resume(request)
                return
            }
            processing.hide()
            isStreaming = false
            endResearchBackgroundTask()
        } catch {
            guard generation == streamGeneration, !abandoned else { return }
            if ReportStreamPolicy.shouldRetryTransport(error), resumeAttempts < maxResumeAttempts {
                resume(request)
                return
            }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            processing.fail()
            isStreaming = false
            endResearchBackgroundTask()
        }
    }

    private func flushBodyIfNeeded(force: Bool) {
        let now = Date()
        guard force || now.timeIntervalSince(lastFlush) >= flushInterval else { return }
        bodyHTML = pendingBody
        lastFlush = now
    }

    /// Local PDF for the system share sheet (Files / Messages / Mail / AirDrop).
    func sharePDFURL(title: String) -> URL? {
        #if canImport(UIKit)
        let key = [
            title,
            scorecardHTML,
            bottomLineHTML,
            bodyHTML,
            badges?.recommendation ?? "",
            badges?.sentiment ?? "",
            badges?.conviction ?? "",
        ].joined(separator: "\u{1e}")
        if key == cachedShareKey, let cachedShareURL {
            return cachedShareURL
        }
        guard let url = ReportPDFExporter.makePDF(
            title: title,
            badges: badges,
            scorecardHTML: scorecardHTML,
            bottomLineHTML: bottomLineHTML,
            bodyHTML: bodyHTML
        ) else {
            return nil
        }
        cachedShareKey = key
        cachedShareURL = url
        return url
        #else
        return nil
        #endif
    }

    private func beginResearchBackgroundTask() {
        #if canImport(UIKit)
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
        #if canImport(UIKit)
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
        #endif
    }
}
