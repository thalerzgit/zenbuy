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

struct SimilarResponse: Codable, Sendable {
    let symbols: [String]
    let source: String?
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
    case done(badges: ReportBadges?, reportId: String?, warning: String?)
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
            if let payload: MetaPayload = Self.decodeKnown(name, from: data, decoder: decoder) {
                self = .meta(cached: payload.cached, asOf: payload.asOf, showAsOf: payload.showAsOf)
            } else if let obj = Self.jsonObject(data) {
                self = .meta(
                    cached: obj["cached"] as? Bool ?? false,
                    asOf: obj["asOf"] as? String,
                    showAsOf: obj["showAsOf"] as? Bool ?? false
                )
            } else {
                self = .skipped(name: name, dataLength: dataLength)
            }
        case "sticky":
            if let payload: StickyPayload = Self.decodeKnown(name, from: data, decoder: decoder) {
                self = .sticky(
                    bottomLineHtml: payload.bottomLineHtml,
                    badges: payload.badges,
                    scorecardHtml: payload.scorecardHtml
                )
            } else if let extracted = Self.extractSticky(from: data) {
                ReportVerboseLog.log(
                    "sse sticky JSONSerialization fallback htmlLen=\(extracted.bottomLineHtml.count)"
                )
                self = .sticky(
                    bottomLineHtml: extracted.bottomLineHtml,
                    badges: extracted.badges,
                    scorecardHtml: extracted.scorecardHtml
                )
            } else {
                self = .skipped(name: name, dataLength: dataLength)
            }
        case "body":
            if let payload: BodyPayload = Self.decodeKnown(name, from: data, decoder: decoder) {
                self = .body(html: payload.html)
            } else if let html = Self.extractString(from: data, key: "html") {
                ReportVerboseLog.log("sse body JSONSerialization fallback htmlLen=\(html.count)")
                self = .body(html: html)
            } else {
                self = .skipped(name: name, dataLength: dataLength)
            }
        case "badges":
            if let payload: ReportBadges = Self.decodeKnown(name, from: data, decoder: decoder) {
                self = .badges(payload)
            } else if let badges = Self.extractBadges(Self.jsonObject(data)) {
                self = .badges(badges)
            } else {
                self = .skipped(name: name, dataLength: dataLength)
            }
        case "companies":
            if let payload: CompaniesPayload = Self.decodeKnown(name, from: data, decoder: decoder),
               let first = payload.companies?.first(where: {
                   !($0.bottomLineHtml ?? "").isEmpty || !($0.bodyHtml ?? "").isEmpty
               }) ?? payload.companies?.first {
                self = .companies(
                    bottomLineHtml: first.bottomLineHtml ?? "",
                    bodyHtml: first.bodyHtml ?? "",
                    scorecardHtml: first.scorecardHtml,
                    badges: first.badges
                )
            } else if let extracted = Self.extractCompanies(from: data) {
                ReportVerboseLog.log(
                    "sse companies JSONSerialization fallback htmlLen=\(extracted.bottomLineHtml.count)/\(extracted.bodyHtml.count)"
                )
                self = .companies(
                    bottomLineHtml: extracted.bottomLineHtml,
                    bodyHtml: extracted.bodyHtml,
                    scorecardHtml: extracted.scorecardHtml,
                    badges: extracted.badges
                )
            } else {
                self = .skipped(name: name, dataLength: dataLength)
            }
        case "done":
            let payload = try? decoder.decode(DonePayload.self, from: data)
            let obj = Self.jsonObject(data)
            let warning =
                payload?.warning
                ?? (obj?["warning"] as? String)
            self = .done(
                badges: payload?.badges ?? Self.extractBadges(obj?["badges"]),
                reportId: payload?.reportId ?? (obj?["reportId"] as? String),
                warning: warning?.isEmpty == false ? warning : nil
            )
        case "error":
            if let payload: ErrorPayload = Self.decodeKnown(name, from: data, decoder: decoder) {
                let text = payload.message ?? payload.error ?? "Research failed."
                self = .error(message: text)
            } else if let obj = Self.jsonObject(data) {
                let text = (obj["message"] as? String) ?? (obj["error"] as? String) ?? "Research failed."
                self = .error(message: text)
            } else {
                self = .skipped(name: name, dataLength: dataLength)
            }
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

    /// Worker payloads are JSON objects. `JSONSerialization` still yields the
    /// HTML strings when Codable chokes on odd `badges` / `scorecardHtml`.
    private static func jsonObject(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func extractString(from data: Data, key: String) -> String? {
        jsonObject(data)?[key] as? String
    }

    private static func extractSticky(from data: Data) -> (
        bottomLineHtml: String,
        badges: ReportBadges?,
        scorecardHtml: String?
    )? {
        guard let obj = jsonObject(data) else { return nil }
        guard obj["bottomLineHtml"] != nil || obj["scorecardHtml"] != nil else { return nil }
        return (
            (obj["bottomLineHtml"] as? String) ?? "",
            extractBadges(obj["badges"]),
            obj["scorecardHtml"] as? String
        )
    }

    private static func extractCompanies(from data: Data) -> (
        bottomLineHtml: String,
        bodyHtml: String,
        scorecardHtml: String?,
        badges: ReportBadges?
    )? {
        guard let obj = jsonObject(data),
              let companies = obj["companies"] as? [[String: Any]]
        else { return nil }
        for company in companies {
            let bottom = (company["bottomLineHtml"] as? String) ?? ""
            let body = (company["bodyHtml"] as? String) ?? ""
            if bottom.isEmpty, body.isEmpty { continue }
            return (
                bottom,
                body,
                company["scorecardHtml"] as? String,
                extractBadges(company["badges"])
            )
        }
        return nil
    }

    private static func extractBadges(_ raw: Any?) -> ReportBadges? {
        guard let obj = raw as? [String: Any] else { return nil }
        let recommendation = obj["recommendation"] as? String
        let sentiment = obj["sentiment"] as? String
        let conviction = obj["conviction"] as? String
        if recommendation == nil, sentiment == nil, conviction == nil { return nil }
        return ReportBadges(
            recommendation: recommendation,
            sentiment: sentiment,
            conviction: conviction
        )
    }
}

/// Yields parsed SSE events in order. The research client may finish the
/// `AsyncThrowingStream` only after `done` has already been yielded — never
/// before prior sticky/body/companies events.
enum ReportSSEClientPolicy {
    static func shouldFinish(afterYielding event: ReportStreamEvent) -> Bool {
        if case .done = event { return true }
        return false
    }

    /// Parse a recorded wire dump. Used to lock probe ordering: sticky/body
    /// must appear before `done`, and `done` is the finish signal.
    static func fold(_ events: [SSEEvent]) -> (parsed: [ReportStreamEvent], finishedAfterDone: Bool) {
        var parsed: [ReportStreamEvent] = []
        var finishedAfterDone = false
        for event in events {
            let next = ReportStreamEvent(sseEvent: event)
            parsed.append(next)
            if shouldFinish(afterYielding: next) {
                finishedAfterDone = true
                break
            }
        }
        return (parsed, finishedAfterDone)
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
    let warning: String?
    let partial: Bool?
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
    let warning: String?
    let partial: Bool?
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
