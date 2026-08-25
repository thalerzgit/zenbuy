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
            return error.localizedDescription
        }
    }
}

@Observable
final class ZenBuyAPIClient {
    private static let clientHeader = "X-ZenBuy-Client"
    private static let clientValue = "ios"

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
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

    func streamResearch(
        symbols: [String],
        mode: ReportMode
    ) -> AsyncThrowingStream<ReportStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let url = ZenBuyEnvironment.apiBaseURL.appending(path: "api/research")
                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    applyClientHeaders(to: &request)

                    let body = ResearchRequest(symbols: symbols, mode: mode)
                    request.httpBody = try encoder.encode(body)

                    let (bytes, response) = try await session.bytes(for: request)
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
                } catch {
                    continuation.finish(throwing: error)
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
