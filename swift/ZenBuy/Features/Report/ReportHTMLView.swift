import SwiftUI

/// Native rendering of Worker HTML fragments — no WKWebView.
struct ReportHTMLView: View {
    let html: String

    var body: some View {
        let nodes = ReportHTML.parse(html)
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(nodes.enumerated()), id: \.offset) { _, node in
                nodeView(node)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func nodeView(_ node: ReportHTMLNode) -> some View {
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
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•")
                            .foregroundStyle(ZenBuyTheme.sage)
                        styledText(item)
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
        case .spacer:
            Spacer().frame(height: 4)
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
