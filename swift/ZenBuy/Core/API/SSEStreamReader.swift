import Foundation

struct SSEEvent: Sendable {
    let name: String
    let data: String
}

/// Incremental SSE parser that splits **only** on CR/LF (WHATWG / SSE spec).
///
/// Do not use `URLSession.AsyncBytes.lines` for research streams: that sequence
/// is character-based and treats U+2028 / U+2029 / U+0085 as line breaks, which
/// can slice a single JSON `data:` payload in half so sticky/body never decode
/// while a later small `done` event still parses.
struct SSEEventParser: Sendable {
    private var eventName = "message"
    private var dataLines: [String] = []
    private var lineBuffer = Data()

    mutating func feed(_ data: Data) -> [SSEEvent] {
        var events: [SSEEvent] = []
        events.reserveCapacity(2)
        for byte in data {
            if byte == 0x0A {
                if let event = consumeLineBuffer() {
                    events.append(event)
                }
            } else {
                lineBuffer.append(byte)
            }
        }
        return events
    }

    mutating func finish() -> [SSEEvent] {
        var events: [SSEEvent] = []
        if !lineBuffer.isEmpty, let event = consumeLineBuffer() {
            events.append(event)
        }
        if let event = emit() {
            events.append(event)
        }
        return events
    }

    private mutating func consumeLineBuffer() -> SSEEvent? {
        var line = lineBuffer
        lineBuffer.removeAll(keepingCapacity: true)
        if line.last == 0x0D {
            line.removeLast()
        }
        return consumeLine(String(decoding: line, as: UTF8.self))
    }

    private mutating func consumeLine(_ line: String) -> SSEEvent? {
        if line.isEmpty {
            return emit()
        }
        if line.hasPrefix(":") {
            return nil
        }
        if line.hasPrefix("event:") {
            eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            return nil
        }
        if line.hasPrefix("data:") {
            var value = String(line.dropFirst(5))
            if value.first == " " {
                value.removeFirst()
            }
            dataLines.append(value)
            return nil
        }
        return nil
    }

    private mutating func emit() -> SSEEvent? {
        guard !dataLines.isEmpty else {
            eventName = "message"
            return nil
        }
        let event = SSEEvent(name: eventName, data: dataLines.joined(separator: "\n"))
        eventName = "message"
        dataLines = []
        return event
    }
}

/// Minimal Server-Sent Events reader for `/api/research` streaming.
///
/// Decodes the byte stream as UTF-8. Never map each raw byte to a
/// `UnicodeScalar` — that Latin-1-style decode turns UTF-8 middots/arrows
/// into mojibake (`Â·`, `â†’`, `Ã—`).
struct SSEStreamReader: Sendable {
    private let bytes: URLSession.AsyncBytes

    init(bytes: URLSession.AsyncBytes) {
        self.bytes = bytes
    }

    func events() -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var parser = SSEEventParser()
                var stash = Data()
                stash.reserveCapacity(16_384)
                do {
                    for try await byte in bytes {
                        stash.append(byte)
                        if byte == 0x0A || stash.count >= 4096 {
                            for event in parser.feed(stash) {
                                continuation.yield(event)
                            }
                            stash.removeAll(keepingCapacity: true)
                        }
                    }
                    if !stash.isEmpty {
                        for event in parser.feed(stash) {
                            continuation.yield(event)
                        }
                    }
                    for event in parser.finish() {
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
}
