import Foundation

struct SymbolResult: Codable, Identifiable, Hashable, Sendable {
    var id: String { symbol }
    let symbol: String
    let name: String
}

enum ReportMode: String, Codable, CaseIterable, Sendable {
    case separate
    case comparative
}

struct SearchResponse: Codable, Sendable {
    let results: [SymbolResult]
    let throttled: Bool?
}

struct DiscoverPick: Codable, Identifiable, Hashable, Sendable {
    var id: String { symbol }
    let symbol: String
    let name: String
    let fitScore: Int
    let reason: String
}

struct DiscoverResponse: Codable, Sendable {
    let picks: [DiscoverPick]
}

struct APIErrorResponse: Codable, Sendable {
    let error: String?
    let code: String?
    let retry: Bool?
}

struct ResearchRequest: Codable, Sendable {
    let symbols: [String]
    let mode: ReportMode
    let directive: String?
    let profitHorizonYears: Int?
}

struct ReportBadges: Codable, Hashable, Sendable {
    let recommendation: String?
    let sentiment: String?
    let conviction: String?
}

enum ReportStreamEvent: Sendable {
    case meta(cached: Bool, asOf: String?, showAsOf: Bool)
    case sticky(bottomLineHtml: String, badges: ReportBadges?, scorecardHtml: String?)
    case body(html: String)
    case badges(ReportBadges)
    case done(badges: ReportBadges?)
    case error(message: String)

    init?(sseEvent: SSEEvent) {
        guard let data = sseEvent.data.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()

        switch sseEvent.name {
        case "meta":
            guard let payload = try? decoder.decode(MetaPayload.self, from: data) else { return nil }
            self = .meta(cached: payload.cached, asOf: payload.asOf, showAsOf: payload.showAsOf)
        case "sticky":
            guard let payload = try? decoder.decode(StickyPayload.self, from: data) else { return nil }
            self = .sticky(
                bottomLineHtml: payload.bottomLineHtml,
                badges: payload.badges,
                scorecardHtml: payload.scorecardHtml
            )
        case "body":
            guard let payload = try? decoder.decode(BodyPayload.self, from: data) else { return nil }
            self = .body(html: payload.html)
        case "badges":
            guard let payload = try? decoder.decode(ReportBadges.self, from: data) else { return nil }
            self = .badges(payload)
        case "done":
            let payload = try? decoder.decode(DonePayload.self, from: data)
            self = .done(badges: payload?.badges)
        case "error":
            guard let payload = try? decoder.decode(ErrorPayload.self, from: data) else { return nil }
            let text = payload.message ?? payload.error ?? "Research failed."
            self = .error(message: text)
        default:
            return nil
        }
    }
}

private struct MetaPayload: Codable {
    let cached: Bool
    let asOf: String?
    let showAsOf: Bool
}

private struct StickyPayload: Codable {
    let bottomLineHtml: String
    let badges: ReportBadges?
    let scorecardHtml: String?
}

private struct BodyPayload: Codable {
    let html: String
}

private struct DonePayload: Codable {
    let badges: ReportBadges?
}

private struct ErrorPayload: Codable {
    let message: String?
    let error: String?
}
