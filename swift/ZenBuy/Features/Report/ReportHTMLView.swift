import SwiftUI

/// Native rendering of Worker HTML fragments — no WKWebView.
struct ReportHTMLView: View {
    /// Parsed off the main thread by `ReportViewModel` (see `ReportRenderModel`);
    /// `body` only draws it.
    let model: ReportFragmentModel
    var showWritingIndicator: Bool = false

    init(model: ReportFragmentModel, showWritingIndicator: Bool = false) {
        self.model = model
        self.showWritingIndicator = showWritingIndicator
    }

    /// Convenience for previews / one-off fragments: parses synchronously.
    init(html: String, hasScorecard: Bool = false, showWritingIndicator: Bool = false) {
        self.init(
            model: ReportFragmentModel.build(html: html, hasScorecard: hasScorecard).model,
            showWritingIndicator: showWritingIndicator
        )
    }

    var body: some View {
        renderedContent
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var renderedContent: some View {
        switch model {
        case let .sections(sections, isIncomplete):
            VStack(alignment: .leading, spacing: 14) {
                ForEach(sections) { keyed in
                    sectionCard(keyed.section)
                }
                if showWritingIndicator && isIncomplete {
                    WritingIndicator()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case let .fallback(text, _):
            VStack(alignment: .leading, spacing: 10) {
                Text(text)
                    .font(.body)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // After the stream finishes, showWritingIndicator is false so
                // fallback copy is not stuck under a permanent “Writing…”.
                if showWritingIndicator {
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
            ForEach(section.nodes.indices, id: \.self) { index in
                nodeView(section.nodes[index])
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
                ForEach(items.indices, id: \.self) { index in
                    let item = items[index]
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
                            ForEach(headers.indices, id: \.self) { index in
                                let header = headers[index]
                                Text(header)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(ZenBuyTheme.ink)
                                    .padding(8)
                                    .frame(minWidth: 72, alignment: .leading)
                                    .background(ZenBuyTheme.sageLight)
                            }
                        }
                    }
                    ForEach(rows.indices, id: \.self) { rowIndex in
                        let row = rows[rowIndex]
                        HStack(spacing: 0) {
                            ForEach(row.indices, id: \.self) { cellIndex in
                                let cell = row[cellIndex]
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
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
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
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(width: 56, alignment: .trailing)
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
