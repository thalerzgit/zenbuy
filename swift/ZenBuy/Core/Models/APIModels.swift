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
    case companies(bottomLineHtml: String, bodyHtml: String, scorecardHtml: String?, badges: ReportBadges?)
    case done(badges: ReportBadges?, reportId: String?)
    case error(message: String)
    case skipped(name: String, dataLength: Int)

    init(sseEvent: SSEEvent) {
        let name = sseEvent.name
        let dataLength = sseEvent.data.utf8.count
        guard let data = sseEvent.data.data(using: .utf8) else {
            self = .skipped(name: name, dataLength: dataLength)
            return
        }
        let decoder = JSONDecoder()

        switch name {
        case "meta":
            guard let payload: MetaPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                self = .skipped(name: name, dataLength: dataLength)
                return
            }
            self = .meta(cached: payload.cached, asOf: payload.asOf, showAsOf: payload.showAsOf)
        case "sticky":
            guard let payload: StickyPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                self = .skipped(name: name, dataLength: dataLength)
                return
            }
            self = .sticky(
                bottomLineHtml: payload.bottomLineHtml,
                badges: payload.badges,
                scorecardHtml: payload.scorecardHtml
            )
        case "body":
            guard let payload: BodyPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                self = .skipped(name: name, dataLength: dataLength)
                return
            }
            self = .body(html: payload.html)
        case "badges":
            guard let payload: ReportBadges = Self.decodeKnown(name, from: data, decoder: decoder) else {
                self = .skipped(name: name, dataLength: dataLength)
                return
            }
            self = .badges(payload)
        case "companies":
            guard let payload: CompaniesPayload = Self.decodeKnown(name, from: data, decoder: decoder),
                  let first = payload.companies?.first(where: {
                      !($0.bottomLineHtml ?? "").isEmpty || !($0.bodyHtml ?? "").isEmpty
                  }) ?? payload.companies?.first
            else {
                self = .skipped(name: name, dataLength: dataLength)
                return
            }
            self = .companies(
                bottomLineHtml: first.bottomLineHtml ?? "",
                bodyHtml: first.bodyHtml ?? "",
                scorecardHtml: first.scorecardHtml,
                badges: first.badges
            )
        case "done":
            let payload = try? decoder.decode(DonePayload.self, from: data)
            self = .done(badges: payload?.badges, reportId: payload?.reportId)
        case "error":
            guard let payload: ErrorPayload = Self.decodeKnown(name, from: data, decoder: decoder) else {
                self = .skipped(name: name, dataLength: dataLength)
                return
            }
            let text = payload.message ?? payload.error ?? "Research failed."
            self = .error(message: text)
        default:
            self = .skipped(name: name, dataLength: dataLength)
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
    let reportId: String?
}

private struct CompaniesPayload: Decodable {
    let companies: [CompanyHTMLPayload]?
}

private struct CompanyHTMLPayload: Decodable {
    let bottomLineHtml: String?
    let bodyHtml: String?
    let scorecardHtml: String?
    let badges: ReportBadges?
}

struct CachedReportPayload: Codable, Sendable {
    let bottomLineHtml: String?
    let bodyHtml: String?
    let scorecardHtml: String?
    let badges: ReportBadges?
    let reportId: String?
}

/// Matches worker `reportCacheKey` in `src/worker/cache.ts`.
enum ReportCacheKey {
    static func make(
        mode: ReportMode,
        symbols: [String],
        directive: String,
        profitHorizonYears: Int?
    ) -> String {
        let sorted = symbols.map { $0.uppercased() }.sorted().joined(separator: ",")
        let horizon: String
        if let profitHorizonYears, profitHorizonYears > 0 {
            horizon = ":h\(profitHorizonYears)"
        } else {
            horizon = ""
        }
        return "report:\(mode.rawValue):\(directive)\(horizon):\(sorted)"
    }
}

private struct ErrorPayload: Codable {
    let message: String?
    let error: String?
}
