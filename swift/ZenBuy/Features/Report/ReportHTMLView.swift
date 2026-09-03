import SwiftUI

/// Native rendering of Worker HTML fragments — no WKWebView.
struct ReportHTMLView: View {
    let html: String
    var hasScorecard: Bool = false
    var showWritingIndicator: Bool = false

    var body: some View {
        renderedContent
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var renderedContent: some View {
        let model = Self.buildModel(html: html, hasScorecard: hasScorecard)
        switch model {
        case let .sections(sections, isIncomplete):
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                    sectionCard(section)
                }
                if showWritingIndicator && isIncomplete {
                    WritingIndicator()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case let .fallback(text, isIncomplete):
            VStack(alignment: .leading, spacing: 10) {
                Text(text)
                    .font(.body)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if showWritingIndicator || isIncomplete {
                    WritingIndicator()
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ZenBuyTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(ZenBuyTheme.border, lineWidth: 1)
            )
        }
    }

    private enum RenderModel {
        case sections([ReportSection], isIncomplete: Bool)
        case fallback(String, isIncomplete: Bool)
    }

    private static func buildModel(html: String, hasScorecard: Bool) -> RenderModel {
        // Isolate parse work so empty/mid-stream fragments cannot blank report chrome.
        let parsed = ReportHTML.parseProgressive(html, hasScorecard: hasScorecard)
        let sections = ReportHTML.sections(from: parsed.nodes, hasScorecard: hasScorecard)
        ReportVerboseLog.log(
            "parse html=\(ReportVerboseLog.htmlPreview(html)) sections=\(sections.count) incomplete=\(parsed.isIncomplete)"
        )
        if sections.isEmpty {
            let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                return .fallback("Receiving report…", isIncomplete: true)
            }
            return .fallback(
                ReportHTML.fallbackPlainText(html),
                isIncomplete: true
            )
        }
        return .sections(sections, isIncomplete: parsed.isIncomplete)
    }

    @ViewBuilder
    private func sectionCard(_ section: ReportSection) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title = section.title {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(ZenBuyTheme.sageDark)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textCase(.uppercase)
            }
            ForEach(Array(section.nodes.enumerated()), id: \.offset) { _, node in
                nodeView(node)
            }
            if !section.sources.isEmpty {
                SourceChipRow(sources: section.sources)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZenBuyTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ZenBuyTheme.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    func nodeView(_ node: ReportHTMLNode) -> some View {
        switch node {
        case let .heading(level, text):
            Text(text)
                .font(level <= 2 ? .title3.weight(.semibold) : .headline)
                .foregroundStyle(ZenBuyTheme.sageDark)
                .frame(maxWidth: .infinity, alignment: .leading)
        case let .paragraph(inlines):
            styledText(inlines)
                .font(.body)
                .foregroundStyle(ZenBuyTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .tint(ZenBuyTheme.sageDark)
        case let .list(items):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•")
                            .foregroundStyle(ZenBuyTheme.sage)
                        styledText(item)
                            .font(.body)
                            .foregroundStyle(ZenBuyTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .tint(ZenBuyTheme.sageDark)
                    }
                }
            }
        case let .table(headers, rows):
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    if !headers.isEmpty {
                        HStack(spacing: 0) {
                            ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                                Text(header)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(ZenBuyTheme.ink)
                                    .padding(8)
                                    .frame(minWidth: 72, alignment: .leading)
                                    .background(ZenBuyTheme.sageLight)
                            }
                        }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        HStack(spacing: 0) {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(cell)
                                    .font(.caption)
                                    .foregroundStyle(ZenBuyTheme.ink)
                                    .padding(8)
                                    .frame(minWidth: 72, alignment: .leading)
                            }
                        }
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(ZenBuyTheme.border, lineWidth: 1)
                )
            }
        case let .scorecard(rows):
            ScorecardView(rows: rows)
        case .spacer:
            // Non-expanding — Spacer() inside ScrollView can steal flex and collapse siblings.
            Color.clear.frame(height: 4)
        }
    }

    /// Concatenate SwiftUI `Text` pieces. Do not assign AttributedString
    /// `.font` / `.link` / `.underlineStyle` / `.foregroundColor` — those form
    /// non-Sendable AttributeScopes key paths and fail Swift 6 / Xcode 26
    /// (Actions run 33675875514).
    private func styledText(_ inlines: [ReportInline]) -> Text {
        inlines.reduce(Text("")) { partial, inline in
            switch inline {
            case let .text(string):
                return partial + Text(string)
            case let .strong(string):
                return partial + Text(string).bold()
            case let .link(label, url):
                return partial + linkText(label: label, url: url)
            }
        }
    }

    private func linkText(label: String, url: String) -> Text {
        let escaped = label
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
        if let parsed = try? AttributedString(
            markdown: "[\(escaped)](\(url))",
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return Text(parsed)
        }
        return Text(label).underline().foregroundStyle(ZenBuyTheme.sageDark)
    }
}

struct ScorecardView: View {
    let rows: [ReportHTMLNode.ScoreRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 10) {
                    Text(row.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ZenBuyTheme.muted)
                        .frame(width: 72, alignment: .leading)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(ZenBuyTheme.surface)
                            Capsule()
                                .fill(ZenBuyTheme.sage)
                                .frame(width: max(4, geo.size.width * row.fraction))
                        }
                    }
                    .frame(height: 8)
                    Text(row.value)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ZenBuyTheme.ink)
                        .frame(width: 40, alignment: .trailing)
                }
            }
        }
        .padding(12)
        .background(ZenBuyTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(ZenBuyTheme.border, lineWidth: 1)
        )
    }
}

struct SourceChipRow: View {
    let sources: [ReportSource]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(sources) { source in
                if let url = URL(string: source.url) {
                    Link(destination: url) {
                        Text(source.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(ZenBuyTheme.sageLight)
                            .foregroundStyle(ZenBuyTheme.sageDark)
                            .clipShape(Capsule())
                    }
                } else {
                    Text(source.label)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(ZenBuyTheme.sageLight)
                        .foregroundStyle(ZenBuyTheme.sageDark)
                        .clipShape(Capsule())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WritingIndicator: View {
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(ZenBuyTheme.sage)
                .frame(width: 6, height: 6)
                .opacity(pulse ? 1 : 0.35)
            Text("Writing…")
                .font(.footnote.weight(.medium))
                .foregroundStyle(ZenBuyTheme.muted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZenBuyTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
