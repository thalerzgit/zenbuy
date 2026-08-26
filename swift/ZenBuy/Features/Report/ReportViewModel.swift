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

    init(api: ZenBuyAPIClient) {
        self.api = api
    }

    func start(symbols: [String], mode: ReportMode, directive: String) {
        streamTask?.cancel()
        bottomLineHTML = ""
        bodyHTML = ""
        scorecardHTML = ""
        badges = nil
        errorMessage = nil
        isStreaming = true
        statusMessage = "Connecting…"

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
                        bodyHTML += html
                    case let .badges(badges):
                        self.badges = badges
                    case let .done(badges):
                        self.badges = badges ?? self.badges
                        statusMessage = "Done"
                        isStreaming = false
                    case let .error(message):
                        errorMessage = message
                        isStreaming = false
                    }
                }
                isStreaming = false
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
}
