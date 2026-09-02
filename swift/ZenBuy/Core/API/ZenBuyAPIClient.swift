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
                return "Research took too long to finish. A single ticker usually takes about 90 seconds — check your connection and try again."
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

    /// Search / config stay snappy. Research SSE uses a long-lived session because
    /// a single-ticker report is ~85s on the worker before the first sticky/body.
    init(session: URLSession? = nil) {
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
                        if let parsed = ReportStreamEvent(sseEvent: event) {
                            continuation.yield(parsed)
                            if case .done = parsed {
                                continuation.finish()
                                return
                            }
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
