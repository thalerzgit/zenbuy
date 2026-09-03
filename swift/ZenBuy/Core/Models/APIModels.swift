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
        let name = sseEvent.name

        switch name {
        case "meta":
            guard let payload: MetaPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                return nil
            }
            self = .meta(cached: payload.cached, asOf: payload.asOf, showAsOf: payload.showAsOf)
        case "sticky":
            guard let payload: StickyPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                return nil
            }
            self = .sticky(
                bottomLineHtml: payload.bottomLineHtml,
                badges: payload.badges,
                scorecardHtml: payload.scorecardHtml
            )
        case "body":
            guard let payload: BodyPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                return nil
            }
            self = .body(html: payload.html)
        case "badges":
            guard let payload: ReportBadges = Self.decodeKnown(name, from: data, decoder: decoder) else {
                return nil
            }
            self = .badges(payload)
        case "done":
            let payload = try? decoder.decode(DonePayload.self, from: data)
            self = .done(badges: payload?.badges)
        case "error":
            guard let payload: ErrorPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                return nil
            }
            let text = payload.message ?? payload.error ?? "Research failed."
            self = .error(message: text)
        default:
            return nil
        }
    }

    private static func decodeKnown<T: Decodable>(
        _ eventName: String,
        from data: Data,
        decoder: JSONDecoder
    ) -> T? {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            ReportVerboseLog.log(
                "sse decode failed event=\(eventName) error=\(error.localizedDescription)"
            )
            return nil
        }
    }
}

private struct MetaPayload: Decodable {
    let cached: Bool
    let asOf: String?
    let showAsOf: Bool

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        cached = try container.decodeIfPresent(Bool.self, forKey: .cached) ?? false
        asOf = try container.decodeIfPresent(String.self, forKey: .asOf)
        showAsOf = try container.decodeIfPresent(Bool.self, forKey: .showAsOf) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case cached, asOf, showAsOf
    }
}

private struct StickyPayload: Decodable {
    let bottomLineHtml: String
    let badges: ReportBadges?
    let scorecardHtml: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let html = try? container.decodeIfPresent(String.self, forKey: .bottomLineHtml) {
            bottomLineHtml = html
        } else {
            bottomLineHtml = ""
        }
        scorecardHtml = try? container.decodeIfPresent(String.self, forKey: .scorecardHtml)
        if container.contains(.badges) {
            badges = try? container.decodeIfPresent(ReportBadges.self, forKey: .badges)
        } else {
            badges = nil
        }
    }

    private enum CodingKeys: String, CodingKey {
        case bottomLineHtml, badges, scorecardHtml
    }
}

private struct BodyPayload: Decodable {
    let html: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        html = (try? container.decodeIfPresent(String.self, forKey: .html)) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case html
    }
}

private struct DonePayload: Codable {
    let badges: ReportBadges?
}

private struct ErrorPayload: Codable {
    let message: String?
    let error: String?
}
