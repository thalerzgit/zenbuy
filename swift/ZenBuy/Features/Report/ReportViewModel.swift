import SwiftUI

@Observable
@MainActor
final class ReportViewModel {
    var bottomLineHTML = ""
    var bodyHTML = ""
    var scorecardHTML = ""
    var badges: ReportBadges?
    var isStreaming = false
    var errorMessage: String?
    let processing = ProcessingProgress()

    private let api: ZenBuyAPIClient
    private var streamTask: Task<Void, Never>?
    private var pendingBody = ""
    private var lastFlush = Date.distantPast
    private let flushInterval: TimeInterval = 0.12

    init(api: ZenBuyAPIClient) {
        self.api = api
    }

    func start(
        symbols: [String],
        mode: ReportMode,
        directive: String,
        profitHorizonYears: Int? = nil
    ) {
        streamTask?.cancel()
        bottomLineHTML = ""
        bodyHTML = ""
        scorecardHTML = ""
        pendingBody = ""
        badges = nil
        errorMessage = nil
        isStreaming = true
        lastFlush = .distantPast
        processing.start(symbolCount: symbols.count, mode: mode)

        streamTask = Task {
            do {
                let stream = api.streamResearch(
                    symbols: symbols,
                    mode: mode,
                    directive: directive,
                    profitHorizonYears: profitHorizonYears
                )

                for try await event in stream {
                    guard !Task.isCancelled else { return }
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
                    case let .error(message):
                        errorMessage = message
                        flushBodyIfNeeded(force: true)
                        processing.fail()
                        isStreaming = false
                    }
                }
                flushBodyIfNeeded(force: true)
                if isStreaming {
                    processing.onDone()
                }
                isStreaming = false
            } catch is CancellationError {
                processing.hide()
                return
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                processing.fail()
                isStreaming = false
            }
        }
    }

    func cancel() {
        streamTask?.cancel()
        processing.hide()
        isStreaming = false
    }

    private func flushBodyIfNeeded(force: Bool) {
        let now = Date()
        guard force || now.timeIntervalSince(lastFlush) >= flushInterval else { return }
        bodyHTML = pendingBody
        lastFlush = now
    }
}
