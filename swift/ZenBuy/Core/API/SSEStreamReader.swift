import Foundation

struct SSEEvent: Sendable {
    let name: String
    let data: String
}

/// Minimal Server-Sent Events reader for `/api/research` streaming.
///
/// Decodes the byte stream as UTF-8 (via `AsyncBytes.lines`). Never map each
/// raw byte to a `UnicodeScalar` — that Latin-1-style decode turns UTF-8
/// middots/arrows into mojibake (`Â·`, `â†’`, `Ã—`).
struct SSEStreamReader: Sendable {
    private let bytes: URLSession.AsyncBytes

    init(bytes: URLSession.AsyncBytes) {
        self.bytes = bytes
    }

    func events() -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var eventName = "message"
                var dataLines: [String] = []
                do {
                    for try await line in bytes.lines {
                        if line.isEmpty {
                            if let event = finishEvent(name: eventName, dataLines: dataLines) {
                                continuation.yield(event)
                            }
                            eventName = "message"
                            dataLines = []
                            continue
                        }
                        if line.hasPrefix("event:") {
                            eventName = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            dataLines.append(String(line.dropFirst(5).trimmingCharacters(in: .whitespaces)))
                        }
                    }
                    if let event = finishEvent(name: eventName, dataLines: dataLines) {
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func finishEvent(name: String, dataLines: [String]) -> SSEEvent? {
        guard !dataLines.isEmpty else { return nil }
        return SSEEvent(name: name, data: dataLines.joined(separator: "\n"))
    }
}
