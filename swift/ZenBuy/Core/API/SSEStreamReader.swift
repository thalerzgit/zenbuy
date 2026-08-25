import Foundation

struct SSEEvent: Sendable {
    let name: String
    let data: String
}

/// Minimal Server-Sent Events reader for `/api/research` streaming.
struct SSEStreamReader: Sendable {
    private let bytes: URLSession.AsyncBytes

    init(bytes: URLSession.AsyncBytes) {
        self.bytes = bytes
    }

    func events() -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var buffer = ""
                do {
                    for try await byte in bytes {
                        buffer.append(Character(UnicodeScalar(byte)))
                        while let range = buffer.range(of: "\n\n") {
                            let block = String(buffer[..<range.lowerBound])
                            buffer.removeSubrange(..<range.upperBound)
                            if let event = parseBlock(block) {
                                continuation.yield(event)
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func parseBlock(_ block: String) -> SSEEvent? {
        var eventName = "message"
        var dataLines: [String] = []

        for line in block.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("event:") {
                eventName = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                dataLines.append(String(line.dropFirst(5).trimmingCharacters(in: .whitespaces)))
            }
        }

        guard !dataLines.isEmpty else { return nil }
        return SSEEvent(name: eventName, data: dataLines.joined(separator: "\n"))
    }
}
