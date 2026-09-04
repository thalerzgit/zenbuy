import Foundation

enum ZenBuyAPIError: LocalizedError {
    case invalidURL
    case http(status: Int, message: String?)
    case decoding(Error)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL."
        case let .http(status, message):
            if let message, !message.isEmpty { return message }
            return "Request failed (HTTP \(status))."
        case let .decoding(error):
            return "Unexpected response: \(error.localizedDescription)"
        case let .transport(error):
            if let urlError = error as? URLError, urlError.code == .timedOut {
                return "Research took too long to finish. The verdict usually appears first; the full report can take about 90 seconds. Check your connection and try again."
            }
            return error.localizedDescription
        }
    }
}

@Observable
@MainActor
final class ZenBuyAPIClient {
    private static let clientHeader = "X-ZenBuy-Client"
    private static let clientValue = "ios"

    private let session: URLSession
    private let researchSession: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    /// Web-unlock session token, when the purchase has been linked.
    private let sessionToken: @MainActor () -> String?

    /// Search / config stay snappy. Research SSE uses a long-lived session because
    /// a single-ticker full report is ~85s; BOTTOM LINE sticky is streamed as soon
    /// as it is parseable (well before FUNDAMENTALS / done).
    init(
        session: URLSession? = nil,
        sessionToken: @escaping @MainActor () -> String? = { nil }
    ) {
        self.sessionToken = sessionToken
        if let session {
            self.session = session
            self.researchSession = session
        } else {
            self.session = Self.makeSession(requestTimeout: 30, resourceTimeout: 60)
            self.researchSession = Self.makeSession(
                requestTimeout: 300,
                resourceTimeout: 600,
                ephemeral: false
            )
        }
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    private static func makeSession(
        requestTimeout: TimeInterval,
        resourceTimeout: TimeInterval,
        ephemeral: Bool = true
    ) -> URLSession {
        let config = ephemeral
            ? URLSessionConfiguration.ephemeral
            : URLSessionConfiguration.default
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = resourceTimeout
        config.waitsForConnectivity = true
        config.isDiscretionary = false
        return URLSession(configuration: config)
    }

    private func applyClientHeaders(to request: inout URLRequest) {
        request.setValue(Self.clientValue, forHTTPHeaderField: Self.clientHeader)
        if let token = sessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    func search(query: String) async throws -> [SymbolResult] {
        var components = URLComponents(
            url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/search"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components?.url else { throw ZenBuyAPIError.invalidURL }

        let payload: SearchResponse = try await get(url)
        return payload.results
    }

    func prefetch(symbol: String) async {
        var components = URLComponents(
            url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/prefetch"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "symbol", value: symbol)]
        guard let url = components?.url else { return }
        var request = URLRequest(url: url)
        applyClientHeaders(to: &request)
        _ = try? await session.data(for: request)
    }

    func fetchConfig() async throws -> ClientConfigResponse {
        let url = ZenBuyEnvironment.apiBaseURL.appending(path: "api/config")
        return try await get(url)
    }

    /// JSON snapshot of a cached report (`GET /api/report`). Used when SSE
    /// finishes without sticky/body — KV is written before `done`.
    func fetchReport(id: String) async throws -> CachedReportPayload {
        var components = URLComponents(
            url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/report"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "id", value: id)]
        guard let url = components?.url else { throw ZenBuyAPIError.invalidURL }
        return try await get(url)
    }

    func fetchReportIfAvailable(id: String) async -> CachedReportPayload? {
        do {
            let payload = try await fetchReport(id: id)
            let empty =
                (payload.bottomLineHtml ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && (payload.bodyHtml ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && (payload.scorecardHtml ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return empty ? nil : payload
        } catch {
            ReportVerboseLog.log("report GET failed idLen=\(id.count) \(error.localizedDescription)")
            return nil
        }
    }

    func discover(directive: String, limit: Int = 4) async throws -> [DiscoverPick] {
        var components = URLComponents(
            url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/discover"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "directive", value: directive),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        guard let url = components?.url else { throw ZenBuyAPIError.invalidURL }
        let payload: DiscoverResponse = try await get(url)
        return payload.picks
    }

    /// Peers ranked against this report's score profile. `scores` may be empty —
    /// the Worker then ranks against a neutral profile.
    func similar(
        symbol: String,
        scores: [String: Int],
        exclude: [String],
        limit: Int = 3
    ) async throws -> [String] {
        var components = URLComponents(
            url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/similar"),
            resolvingAgainstBaseURL: false
        )
        var items = [URLQueryItem(name: "symbol", value: symbol)]
        if !scores.isEmpty,
           let json = try? encoder.encode(scores),
           let text = String(data: json, encoding: .utf8) {
            items.append(URLQueryItem(name: "scores", value: text))
        }
        if !exclude.isEmpty {
            items.append(URLQueryItem(name: "exclude", value: exclude.joined(separator: ",")))
        }
        components?.queryItems = items
        guard let url = components?.url else { throw ZenBuyAPIError.invalidURL }
        let payload: SimilarResponse = try await get(url)
        return Array(payload.symbols.prefix(limit))
    }

    func streamResearch(
        symbols: [String],
        mode: ReportMode,
        directive: String = "growth",
        profitHorizonYears: Int? = nil
    ) -> AsyncThrowingStream<ReportStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let url = ZenBuyEnvironment.apiBaseURL.appending(path: "api/research")
                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.timeoutInterval = 300
                    applyClientHeaders(to: &request)

                    let body = ResearchRequest(
                        symbols: symbols,
                        mode: mode,
                        directive: directive,
                        profitHorizonYears: profitHorizonYears
                    )
                    request.httpBody = try encoder.encode(body)

                    let (bytes, response) = try await researchSession.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else {
                        throw ZenBuyAPIError.transport(URLError(.badServerResponse))
                    }

                    if http.statusCode != 200 {
                        var data = Data()
                        for try await chunk in bytes {
                            data.append(chunk)
                        }
                        let message = (try? decoder.decode(APIErrorResponse.self, from: data))?.error
                        throw ZenBuyAPIError.http(status: http.statusCode, message: message)
                    }

                    let reader = SSEStreamReader(bytes: bytes)
                    for try await event in reader.events() {
                        let parsed = ReportStreamEvent(sseEvent: event)
                        // Yield first. Finish only after `done` — never drop
                        // already-yielded sticky/body because companies is long.
                        continuation.yield(parsed)
                        if ReportSSEClientPolicy.shouldFinish(afterYielding: parsed) {
                            continuation.finish()
                            return
                        }
                    }
                    continuation.finish()
                } catch let error as ZenBuyAPIError {
                    continuation.finish(throwing: error)
                } catch {
                    continuation.finish(throwing: ZenBuyAPIError.transport(error))
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        var request = URLRequest(url: url)
        applyClientHeaders(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw ZenBuyAPIError.transport(URLError(.badServerResponse))
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                let message = (try? decoder.decode(APIErrorResponse.self, from: data))?.error
                throw ZenBuyAPIError.http(status: http.statusCode, message: message)
            }
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw ZenBuyAPIError.decoding(error)
            }
        } catch let error as ZenBuyAPIError {
            throw error
        } catch {
            throw ZenBuyAPIError.transport(error)
        }
    }
}
