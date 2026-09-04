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

struct ReportSource: Equatable, Hashable, Sendable, Identifiable {
    var id: String { "\(label)|\(url)" }
    let label: String
    let url: String
}

struct ReportSection: Equatable, Sendable, Identifiable {
    var id: String { title ?? "_untitled_\(nodes.count)" }
    let title: String?
    let nodes: [ReportHTMLNode]
    let sources: [ReportSource]
}

struct ReportParseResult: Equatable, Sendable {
    let nodes: [ReportHTMLNode]
    /// Trailing HTML that is not yet a complete block-level node (open tags).
    let incompleteTail: String

    var isIncomplete: Bool {
        !incompleteTail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum ReportHTML {
    static func parse(_ html: String) -> [ReportHTMLNode] {
        parseProgressive(html).nodes
    }

    /// Progressive parse: only commit complete block-level nodes. Incomplete
    /// trailing HTML is returned separately so the UI can show a “Writing…”
    /// indicator instead of empty bullets / orphan link chips.
    static func parseProgressive(_ html: String, hasScorecard: Bool = false) -> ReportParseResult {
        let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ReportParseResult(nodes: [], incompleteTail: "")
        }

        if trimmed.contains("class=\"scorecard\"") || trimmed.contains("class='scorecard'") {
            return ReportParseResult(nodes: parseScorecard(trimmed), incompleteTail: "")
        }

        var nodes: [ReportHTMLNode] = []
        var remaining = trimmed
        while !remaining.isEmpty {
            remaining = remaining.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !remaining.isEmpty else { break }

            if let match = consumeTag(&remaining, name: "h2") {
                let text = plainText(match)
                if !text.isEmpty {
                    nodes.append(.heading(level: 2, text: text))
                }
            } else if remaining.hasPrefix("<h2") {
                return ReportParseResult(nodes: nodes, incompleteTail: remaining)
            } else if let match = consumeTag(&remaining, name: "h3") {
                let text = plainText(match)
                if !text.isEmpty {
                    nodes.append(.heading(level: 3, text: text))
                }
            } else if remaining.hasPrefix("<h3") {
                return ReportParseResult(nodes: nodes, incompleteTail: remaining)
            } else if remaining.hasPrefix("<div") {
                if let inner = consumeTag(&remaining, name: "div") {
                    let nested = parseProgressive(inner, hasScorecard: hasScorecard)
                    nodes.append(contentsOf: nested.nodes)
                    if nested.isIncomplete {
                        return ReportParseResult(
                            nodes: nodes,
                            incompleteTail: nested.incompleteTail
                        )
                    }
                } else {
                    return ReportParseResult(nodes: nodes, incompleteTail: remaining)
                }
            } else if remaining.hasPrefix("<table") {
                if let table = consumeTag(&remaining, name: "table") {
                    nodes.append(parseTable(table))
                } else {
                    return ReportParseResult(nodes: nodes, incompleteTail: remaining)
                }
            } else if remaining.hasPrefix("<ul") {
                if let list = consumeTag(&remaining, name: "ul") {
                    let items = parseListItems(list, hasScorecard: hasScorecard)
                    if !items.isEmpty {
                        nodes.append(.list(items: items))
                    }
                } else {
                    // Prefer complete `<li>` items inside an open `<ul>`; hold the rest.
                    let partial = parsePartialList(remaining, hasScorecard: hasScorecard)
                    if !partial.items.isEmpty {
                        nodes.append(.list(items: partial.items))
                    }
                    return ReportParseResult(nodes: nodes, incompleteTail: partial.tail)
                }
            } else if remaining.hasPrefix("<p") {
                if let para = consumeTag(&remaining, name: "p") {
                    if let node = makeParagraph(
                        para.replacingOccurrences(of: "<br/>", with: "\n")
                            .replacingOccurrences(of: "<br>", with: "\n"),
                        hasScorecard: hasScorecard
                    ) {
                        nodes.append(node)
                    }
                } else {
                    return ReportParseResult(nodes: nodes, incompleteTail: remaining)
                }
            } else if remaining.hasPrefix("<") {
                // Unknown / incomplete open tag — do not skip bytes (orphans content).
                if remaining.firstIndex(of: ">") == nil {
                    return ReportParseResult(nodes: nodes, incompleteTail: remaining)
                }
                if let end = remaining.firstIndex(of: ">") {
                    remaining = String(remaining[remaining.index(after: end)...])
                }
            } else if let nextTag = remaining.firstIndex(of: "<") {
                let text = String(remaining[..<nextTag])
                if let node = makeParagraph(text, hasScorecard: hasScorecard) {
                    nodes.append(node)
                }
                remaining = String(remaining[nextTag...])
            } else {
                if let node = makeParagraph(remaining, hasScorecard: hasScorecard) {
                    nodes.append(node)
                }
                remaining = ""
            }
        }
        return ReportParseResult(nodes: nodes, incompleteTail: "")
    }

    /// Group nodes into H2 sections and lift citation links into `sources`.
    static func sections(from nodes: [ReportHTMLNode], hasScorecard: Bool = false) -> [ReportSection] {
        var result: [ReportSection] = []
        var currentTitle: String?
        var currentNodes: [ReportHTMLNode] = []
        var currentSources: [ReportSource] = []

        func flush() {
            let cleaned = currentNodes.compactMap { node -> ReportHTMLNode? in
                stripInlineSources(node, into: &currentSources, hasScorecard: hasScorecard)
            }
            // Never emit header-only / empty cards (streaming often opens an H2 early).
            if !cleaned.isEmpty || !currentSources.isEmpty {
                result.append(
                    ReportSection(
                        title: currentTitle,
                        nodes: cleaned,
                        sources: uniqueSources(currentSources)
                    )
                )
            }
            currentTitle = nil
            currentNodes = []
            currentSources = []
        }

        for node in nodes {
            if case let .heading(level, text) = node, level <= 2 {
                flush()
                currentTitle = text
            } else {
                currentNodes.append(node)
            }
        }
        flush()
        return result
    }

    static func plainText(_ html: String) -> String {
        unescape(stripTags(html)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Worker `scorecardHtml` labels mapped back onto the `Scorecard` keys that
    /// `/api/similar` ranks peers against.
    private static let scoreKeysByLabel = [
        "growth": "growth",
        "moat": "moat",
        "mgmt": "management",
        "value": "valuation",
        "balance": "balanceSheet",
        "catalysts": "catalysts",
        "overall": "overall",
    ]

    static func scoreProfile(from scorecardHTML: String) -> [String: Int] {
        var profile: [String: Int] = [:]
        for node in parse(scorecardHTML) {
            guard case let .scorecard(rows) = node else { continue }
            for row in rows {
                guard let key = scoreKeysByLabel[row.label.lowercased()] else { continue }
                let digits = row.value.prefix { $0.isNumber }
                if let value = Int(digits) {
                    profile[key] = value
                }
            }
        }
        return profile
    }

    /// True when sticky/body/scorecard HTML yields something a user can see.
    static func hasVisibleContent(
        bottomLineHTML: String,
        bodyHTML: String,
        scorecardHTML: String
    ) -> Bool {
        let hasScorecard = !scorecardHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !parse(scorecardHTML).isEmpty
        if hasScorecard { return true }
        if !sections(
            from: parseProgressive(bottomLineHTML, hasScorecard: hasScorecard).nodes,
            hasScorecard: hasScorecard
        ).isEmpty {
            return true
        }
        if !sections(
            from: parseProgressive(bodyHTML, hasScorecard: hasScorecard).nodes,
            hasScorecard: hasScorecard
        ).isEmpty {
            return true
        }
        // Unsectioned / unparsed HTML still counts if the user would see text.
        if !plainText(bottomLineHTML).isEmpty { return true }
        if !plainText(bodyHTML).isEmpty { return true }
        return false
    }

    /// Safe fallback copy when HTML is present but progressive parse yields no sections.
    static func fallbackPlainText(_ html: String) -> String {
        let text = plainText(html)
        return text.isEmpty ? "Receiving report…" : text
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
                    // Incomplete strong — surface any leading text already parsed; stop.
                    break
                }
            } else if remaining.hasPrefix("<a") {
                let href = attribute(remaining, name: "href") ?? ""
                if let inner = consumeTag(&remaining, name: "a") {
                    let label = plainText(inner)
                    if !label.isEmpty {
                        result.append(.link(label: label, url: href))
                    }
                } else {
                    break
                }
            } else if remaining.hasPrefix("<") {
                if remaining.firstIndex(of: ">") == nil { break }
                if let end = remaining.firstIndex(of: ">") {
                    remaining = String(remaining[remaining.index(after: end)...])
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

    /// Full named + numeric entity decode, then mojibake repair.
    static func unescape(_ text: String) -> String {
        var s = decodeEntities(text)
        s = repairMojibake(s)
        return s
    }

    /// Reinterpret Latin-1 / Windows-1252 mojibake as UTF-8 when possible.
    static func repairMojibake(_ text: String) -> String {
        guard text.unicodeScalars.contains(where: { scalar in
            let v = scalar.value
            return v == 0xC2 || v == 0xC3 || v == 0xE2 || (0x80 ... 0x9F).contains(v)
        }) else {
            return text
        }

        let bytes = text.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) }
        if let repaired = String(bytes: bytes, encoding: .utf8),
           repaired != text,
           repaired.utf8.count < text.unicodeScalars.count || !containsMojibakeMarkers(repaired) {
            return repaired
        }

        var s = text
        let pairs: [(String, String)] = [
            ("Â·", "·"),
            ("Ã—", "×"),
            ("â€”", "—"),
            ("â€“", "–"),
            ("â€™", "\u{2019}"),
            ("â€˜", "\u{2018}"),
            ("â€œ", "\u{201C}"),
            ("â€\u{9D}", "\u{201D}"),
            ("â€¦", "…"),
            ("â†’", "→"),
            ("â†", "←"),
            ("Â ", "\u{00A0}"),
        ]
        for (bad, good) in pairs {
            s = s.replacingOccurrences(of: bad, with: good)
        }
        return s
    }

    // MARK: - Internals

    private static func containsMojibakeMarkers(_ text: String) -> Bool {
        text.contains("Â") || text.contains("Ã") || text.contains("â€") || text.contains("â†")
    }

    private static func decodeEntities(_ text: String) -> String {
        var s = text
        let named: [(String, String)] = [
            ("&nbsp;", " "),
            ("&middot;", "·"),
            ("&bull;", "•"),
            ("&ndash;", "–"),
            ("&mdash;", "—"),
            ("&times;", "×"),
            ("&rarr;", "→"),
            ("&larr;", "←"),
            ("&hellip;", "…"),
            ("&apos;", "'"),
            ("&#39;", "'"),
            ("&quot;", "\""),
            ("&lt;", "<"),
            ("&gt;", ">"),
            ("&amp;", "&"),
        ]
        for (entity, value) in named {
            s = s.replacingOccurrences(of: entity, with: value)
        }

        // Numeric: &#123; and &#x1F; / &#X1f;
        let pattern = #"&#(x[0-9a-fA-F]+|\d+);"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return s }
        let ns = s as NSString
        let matches = regex.matches(in: s, range: NSRange(location: 0, length: ns.length))
        var rebuilt = s
        for match in matches.reversed() {
            guard let fullRange = Range(match.range, in: rebuilt),
                  let valueRange = Range(match.range(at: 1), in: rebuilt) else { continue }
            let raw = String(rebuilt[valueRange])
            let scalar: UnicodeScalar?
            if raw.lowercased().hasPrefix("x") {
                let hex = String(raw.dropFirst())
                scalar = UInt32(hex, radix: 16).flatMap(UnicodeScalar.init)
            } else {
                scalar = UInt32(raw).flatMap(UnicodeScalar.init)
            }
            if let scalar {
                rebuilt.replaceSubrange(fullRange, with: String(scalar))
            }
        }
        return rebuilt
    }

    private static func makeParagraph(_ html: String, hasScorecard: Bool) -> ReportHTMLNode? {
        let inlines = parseInlines(html)
        guard !inlines.isEmpty else { return nil }
        if hasScorecard, isScoreDump(inlines) { return nil }
        if isLinkOnly(inlines) { return nil }
        return .paragraph(inlines: inlines)
    }

    private static func parseListItems(_ html: String, hasScorecard: Bool) -> [[ReportInline]] {
        extractTags(html, name: "li").compactMap { itemHTML -> [ReportInline]? in
            let inlines = parseInlines(itemHTML)
            guard !inlines.isEmpty else { return nil }
            if hasScorecard, isScoreDump(inlines) { return nil }
            if isLinkOnly(inlines) { return nil }
            return inlines
        }
    }

    private static func parsePartialList(
        _ html: String,
        hasScorecard: Bool
    ) -> (items: [[ReportInline]], tail: String) {
        var copy = html
        // Drop the incomplete open <ul ...>
        if copy.hasPrefix("<ul"), let end = copy.firstIndex(of: ">") {
            copy = String(copy[copy.index(after: end)...])
        }
        var items: [[ReportInline]] = []
        while !copy.isEmpty {
            copy = copy.trimmingCharacters(in: .whitespacesAndNewlines)
            guard copy.hasPrefix("<li") else { break }
            if let inner = consumeTag(&copy, name: "li") {
                let inlines = parseInlines(inner)
                if !inlines.isEmpty,
                   !(hasScorecard && isScoreDump(inlines)),
                   !isLinkOnly(inlines) {
                    items.append(inlines)
                }
            } else {
                return (items, copy)
            }
        }
        let tail = copy.trimmingCharacters(in: .whitespacesAndNewlines)
        return (items, tail.isEmpty ? html : tail)
    }

    private static func isLinkOnly(_ inlines: [ReportInline]) -> Bool {
        let meaningful = inlines.filter { inline in
            switch inline {
            case let .text(s):
                return !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            case .strong, .link:
                return true
            }
        }
        guard !meaningful.isEmpty else { return true }
        return meaningful.allSatisfy {
            if case .link = $0 { return true }
            return false
        }
    }

    private static func isScoreDump(_ inlines: [ReportInline]) -> Bool {
        let text = inlines.map { inline -> String in
            switch inline {
            case let .text(s), let .strong(s): return s
            case let .link(label, _): return label
            }
        }.joined()
        let lower = text.lowercased()
        guard lower.contains("/10") else { return false }
        let keys = ["growth", "moat", "management", "valuation", "balance", "catalysts", "overall"]
        let hits = keys.filter { lower.contains($0) }.count
        return hits >= 3
    }

    private static func stripInlineSources(
        _ node: ReportHTMLNode,
        into sources: inout [ReportSource],
        hasScorecard: Bool
    ) -> ReportHTMLNode? {
        switch node {
        case let .paragraph(inlines):
            if hasScorecard, isScoreDump(inlines) { return nil }
            let (kept, found) = extractSources(from: inlines)
            sources.append(contentsOf: found)
            if kept.isEmpty { return nil }
            if isLinkOnly(kept) {
                sources.append(contentsOf: kept.compactMap(source(from:)))
                return nil
            }
            return .paragraph(inlines: kept)
        case let .list(items):
            var keptItems: [[ReportInline]] = []
            for item in items {
                if hasScorecard, isScoreDump(item) { continue }
                let (kept, found) = extractSources(from: item)
                sources.append(contentsOf: found)
                if kept.isEmpty || isLinkOnly(kept) {
                    sources.append(contentsOf: kept.compactMap(source(from:)))
                    continue
                }
                keptItems.append(kept)
            }
            return keptItems.isEmpty ? nil : .list(items: keptItems)
        default:
            return node
        }
    }

    private static func extractSources(from inlines: [ReportInline]) -> ([ReportInline], [ReportSource]) {
        var kept: [ReportInline] = []
        var found: [ReportSource] = []
        for inline in inlines {
            if case let .link(label, url) = inline, looksLikeCitation(label: label, url: url) {
                found.append(ReportSource(label: label, url: url))
                // Keep the label in prose so “Fact · Yahoo · date” still reads;
                // the chip row carries the tappable URL.
                if !label.isEmpty {
                    kept.append(.text(label))
                }
            } else {
                kept.append(inline)
            }
        }
        return (kept, found)
    }

    private static func source(from inline: ReportInline) -> ReportSource? {
        if case let .link(label, url) = inline {
            return ReportSource(label: label, url: url)
        }
        return nil
    }

    private static func looksLikeCitation(label: String, url: String) -> Bool {
        let known = ["yahoo", "sec", "earnings", "finnhub", "fred", "factset", "bloomberg", "reuters"]
        let lower = label.lowercased()
        if known.contains(where: { lower.contains($0) }) { return true }
        if let host = URL(string: url)?.host?.lowercased() {
            return known.contains(where: { host.contains($0) }) || host.contains("sec.gov")
        }
        return false
    }

    private static func uniqueSources(_ sources: [ReportSource]) -> [ReportSource] {
        var seen = Set<String>()
        var out: [ReportSource] = []
        for source in sources {
            let key = source.label.lowercased()
            if seen.insert(key).inserted {
                out.append(source)
            }
        }
        return out
    }

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
}
