import Foundation

/// Lightweight HTML subset produced by the Worker `renderMarkdown` / `scorecardHtml`.
enum ReportHTMLNode: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(inlines: [ReportInline])
    case list(items: [[ReportInline]])
    case table(headers: [String], rows: [[String]])
    case scorecard(rows: [ScoreRow])
    case spacer

    struct ScoreRow: Equatable, Sendable {
        let label: String
        let value: String
        let fraction: Double
    }
}

enum ReportInline: Equatable, Sendable {
    case text(String)
    case strong(String)
    case link(label: String, url: String)
}

enum ReportHTML {
    static func parse(_ html: String) -> [ReportHTMLNode] {
        let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        if trimmed.contains("class=\"scorecard\"") || trimmed.contains("class='scorecard'") {
            return parseScorecard(trimmed)
        }

        var nodes: [ReportHTMLNode] = []
        var remaining = trimmed
        while !remaining.isEmpty {
            remaining = remaining.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !remaining.isEmpty else { break }

            if let match = consumeTag(&remaining, name: "h2") {
                nodes.append(.heading(level: 2, text: plainText(match)))
            } else if let match = consumeTag(&remaining, name: "h3") {
                nodes.append(.heading(level: 3, text: plainText(match)))
            } else if remaining.hasPrefix("<div") {
                if let inner = consumeTag(&remaining, name: "div") {
                    if inner.contains("<table") {
                        nodes.append(contentsOf: parse(inner))
                    } else {
                        nodes.append(contentsOf: parse(inner))
                    }
                } else {
                    remaining.removeFirst()
                }
            } else if remaining.hasPrefix("<table") {
                if let table = consumeTag(&remaining, name: "table") {
                    nodes.append(parseTable(table))
                } else {
                    remaining.removeFirst()
                }
            } else if remaining.hasPrefix("<ul") {
                if let list = consumeTag(&remaining, name: "ul") {
                    nodes.append(.list(items: parseListItems(list)))
                } else {
                    remaining.removeFirst()
                }
            } else if remaining.hasPrefix("<p") {
                if let para = consumeTag(&remaining, name: "p") {
                    let inlines = parseInlines(para.replacingOccurrences(of: "<br/>", with: "\n")
                        .replacingOccurrences(of: "<br>", with: "\n"))
                    if !inlines.isEmpty {
                        nodes.append(.paragraph(inlines: inlines))
                    }
                } else {
                    remaining.removeFirst()
                }
            } else if remaining.hasPrefix("<") {
                if let end = remaining.firstIndex(of: ">") {
                    remaining = String(remaining[remaining.index(after: end)...])
                } else {
                    break
                }
            } else if let nextTag = remaining.firstIndex(of: "<") {
                let text = String(remaining[..<nextTag])
                let inlines = parseInlines(text)
                if !inlines.isEmpty {
                    nodes.append(.paragraph(inlines: inlines))
                }
                remaining = String(remaining[nextTag...])
            } else {
                let inlines = parseInlines(remaining)
                if !inlines.isEmpty {
                    nodes.append(.paragraph(inlines: inlines))
                }
                break
            }
        }
        return nodes
    }

    static func plainText(_ html: String) -> String {
        unescape(stripTags(html)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func parseInlines(_ html: String) -> [ReportInline] {
        var result: [ReportInline] = []
        var remaining = html
        while !remaining.isEmpty {
            if remaining.hasPrefix("<strong") {
                if let inner = consumeTag(&remaining, name: "strong") {
                    let text = plainText(inner)
                    if !text.isEmpty { result.append(.strong(text)) }
                } else {
                    remaining.removeFirst()
                }
            } else if remaining.hasPrefix("<a") {
                let href = attribute(remaining, name: "href") ?? ""
                if let inner = consumeTag(&remaining, name: "a") {
                    let label = plainText(inner)
                    if !label.isEmpty {
                        result.append(.link(label: label, url: href))
                    }
                } else {
                    remaining.removeFirst()
                }
            } else if remaining.hasPrefix("<") {
                if let end = remaining.firstIndex(of: ">") {
                    remaining = String(remaining[remaining.index(after: end)...])
                } else {
                    break
                }
            } else if let next = remaining.firstIndex(of: "<") {
                let text = unescape(String(remaining[..<next]))
                if !text.isEmpty { result.append(.text(text)) }
                remaining = String(remaining[next...])
            } else {
                let text = unescape(remaining)
                if !text.isEmpty { result.append(.text(text)) }
                break
            }
        }
        return result
    }

    // MARK: - Internals

    private static func parseScorecard(_ html: String) -> [ReportHTMLNode] {
        var rows: [ReportHTMLNode.ScoreRow] = []
        var search = html
        while let start = search.range(of: "class=\"score-row\"") ?? search.range(of: "class='score-row'") {
            let slice = String(search[start.lowerBound...])
            let block: String
            if let next = slice.range(of: "class=\"score-row\"", range: slice.index(after: slice.startIndex)..<slice.endIndex)
                ?? slice.range(of: "class='score-row'", range: slice.index(after: slice.startIndex)..<slice.endIndex) {
                block = String(slice[..<next.lowerBound])
                search = String(slice[next.lowerBound...])
            } else {
                block = slice
                search = ""
            }
            let label = capture(block, start: "score-label\">", end: "</span>") ?? ""
            let value = capture(block, start: "score-num\">", end: "</span>") ?? ""
            var fraction = 0.0
            if let width = capture(block, start: "width:", end: "%") {
                fraction = (Double(width.trimmingCharacters(in: .whitespaces)) ?? 0) / 100
            }
            if !label.isEmpty {
                rows.append(.init(label: unescape(label), value: unescape(value), fraction: min(max(fraction, 0), 1)))
            }
        }
        return rows.isEmpty ? [] : [.scorecard(rows: rows)]
    }

    private static func parseTable(_ html: String) -> ReportHTMLNode {
        var headers: [String] = []
        var rows: [[String]] = []

        if let thead = extractTag(html, name: "thead") {
            headers = extractTags(thead, name: "th").map { plainText($0) }
        }
        let body = extractTag(html, name: "tbody") ?? html
        for tr in extractTags(body, name: "tr") {
            let cells = extractTags(tr, name: "td").map { plainText($0) }
            if cells.isEmpty {
                let ths = extractTags(tr, name: "th").map { plainText($0) }
                if headers.isEmpty {
                    headers = ths
                }
            } else {
                rows.append(cells)
            }
        }
        return .table(headers: headers, rows: rows)
    }

    private static func parseListItems(_ html: String) -> [[ReportInline]] {
        extractTags(html, name: "li").map { parseInlines($0) }.filter { !$0.isEmpty }
    }

    private static func consumeTag(_ html: inout String, name: String) -> String? {
        let open = "<\(name)"
        guard html.hasPrefix(open) else { return nil }
        guard let openEnd = html.firstIndex(of: ">") else { return nil }
        let afterOpen = html.index(after: openEnd)
        if html[html.index(before: openEnd)] == "/" {
            html = String(html[afterOpen...])
            return ""
        }
        let close = "</\(name)>"
        var depth = 1
        var search = afterOpen
        while search < html.endIndex {
            if html[search...].hasPrefix(close) {
                depth -= 1
                if depth == 0 {
                    let inner = String(html[afterOpen..<search])
                    html = String(html[html.index(search, offsetBy: close.count)...])
                    return inner
                }
                search = html.index(search, offsetBy: close.count)
            } else if html[search...].hasPrefix(open) {
                depth += 1
                search = html.index(search, offsetBy: open.count)
            } else {
                search = html.index(after: search)
            }
        }
        return nil
    }

    private static func extractTag(_ html: String, name: String) -> String? {
        var copy = html
        while !copy.isEmpty {
            if let inner = consumeTag(&copy, name: name) {
                return inner
            }
            if copy.first == "<", let end = copy.firstIndex(of: ">") {
                copy = String(copy[copy.index(after: end)...])
            } else if copy.first != nil {
                copy.removeFirst()
            } else {
                break
            }
        }
        return nil
    }

    private static func extractTags(_ html: String, name: String) -> [String] {
        var copy = html
        var found: [String] = []
        while !copy.isEmpty {
            copy = copy.trimmingCharacters(in: .whitespacesAndNewlines)
            if let inner = consumeTag(&copy, name: name) {
                found.append(inner)
            } else if copy.first == "<", let end = copy.firstIndex(of: ">") {
                copy = String(copy[copy.index(after: end)...])
            } else if !copy.isEmpty {
                copy.removeFirst()
            }
        }
        return found
    }

    private static func attribute(_ openTagAndRest: String, name: String) -> String? {
        guard let start = openTagAndRest.range(of: "\(name)=\"") ?? openTagAndRest.range(of: "\(name)='") else {
            return nil
        }
        let quote = openTagAndRest[start.upperBound]
        let after = openTagAndRest[start.upperBound...]
        guard let end = after.dropFirst().firstIndex(of: quote) else { return nil }
        return String(after.dropFirst().prefix(upTo: end))
    }

    private static func capture(_ text: String, start: String, end: String) -> String? {
        guard let s = text.range(of: start) else { return nil }
        let rest = text[s.upperBound...]
        guard let e = rest.range(of: end) else { return String(rest) }
        return String(rest[..<e.lowerBound])
    }

    private static func stripTags(_ html: String) -> String {
        var out = ""
        var inTag = false
        for ch in html {
            if ch == "<" { inTag = true; continue }
            if ch == ">" { inTag = false; continue }
            if !inTag { out.append(ch) }
        }
        return out
    }

    static func unescape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }
}
