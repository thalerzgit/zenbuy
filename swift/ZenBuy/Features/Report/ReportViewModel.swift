import SwiftUI

@Observable
@MainActor
final class ReportViewModel {
    var bottomLineHTML = ""
    var bodyHTML = ""
    var scorecardHTML = ""
    var badges: ReportBadges?
    var statusMessage = "Starting research…"
    var isStreaming = false
    var errorMessage: String?

    private let api: ZenBuyAPIClient
    private var streamTask: Task<Void, Never>?
    private var pendingBody = ""
    private var lastFlush = Date.distantPast
    private let flushInterval: TimeInterval = 0.12

    init(api: ZenBuyAPIClient) {
        self.api = api
    }

    func start(symbols: [String], mode: ReportMode, directive: String) {
        streamTask?.cancel()
        bottomLineHTML = ""
        bodyHTML = ""
        scorecardHTML = ""
        pendingBody = ""
        badges = nil
        errorMessage = nil
        isStreaming = true
        statusMessage = "Connecting…"
        lastFlush = .distantPast

        streamTask = Task {
            do {
                let stream = api.streamResearch(
                    symbols: symbols,
                    mode: mode,
                    directive: directive
                )

                for try await event in stream {
                    guard !Task.isCancelled else { return }
                    switch event {
                    case let .meta(cached, asOf, showAsOf):
                        if cached {
                            statusMessage = "Loaded cached report"
                        } else if showAsOf, let asOf {
                            statusMessage = "Data as of \(asOf)"
                        }
                    case let .sticky(bottomLineHtml, badges, scorecardHtml):
                        bottomLineHTML = bottomLineHtml
                        self.badges = badges
                        scorecardHTML = scorecardHtml ?? ""
                        statusMessage = "Streaming report…"
                    case let .body(html):
                        pendingBody += html
                        flushBodyIfNeeded(force: false)
                    case let .badges(badges):
                        self.badges = badges
                    case let .done(badges):
                        self.badges = badges ?? self.badges
                        flushBodyIfNeeded(force: true)
                        statusMessage = "Done"
                        isStreaming = false
                    case let .error(message):
                        errorMessage = message
                        flushBodyIfNeeded(force: true)
                        isStreaming = false
                    }
                }
                flushBodyIfNeeded(force: true)
                isStreaming = false
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
                isStreaming = false
            }
        }
    }

    func cancel() {
        streamTask?.cancel()
        isStreaming = false
    }

    private func flushBodyIfNeeded(force: Bool) {
        let now = Date()
        guard force || now.timeIntervalSince(lastFlush) >= flushInterval else { return }
        bodyHTML = pendingBody
        lastFlush = now
    }
}
