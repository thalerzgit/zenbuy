import SwiftUI

struct TVReportView: View {
    let symbols: [String]
    let mode: ReportMode
    let directive: String
    let profitHorizonYears: Int
    @Bindable var viewModel: ReportViewModel
    var onRunSimilar: ([String], ReportMode) -> Void = { _, _ in }

    private var title: String { symbols.joined(separator: ", ") }
    private var hasScorecard: Bool { !viewModel.scorecardHTML.isEmpty }

    private var hasVisibleReportContent: Bool {
        ReportHTML.hasVisibleContent(
            bottomLineHTML: viewModel.bottomLineHTML,
            bodyHTML: viewModel.bodyHTML,
            scorecardHTML: viewModel.scorecardHTML
        )
    }

    private var shouldShowProcessingPanel: Bool {
        ReportStreamPolicy.shouldShowProcessingPanel(
            hasError: viewModel.errorMessage != nil,
            hasVisibleReportContent: hasVisibleReportContent,
            isStreaming: viewModel.isStreaming,
            didFinishSuccessfully: viewModel.didFinishSuccessfully,
            processingIsVisible: viewModel.processing.isVisible
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TVTheme.stackSpacing) {
                Text(title)
                    .font(TVTheme.titleFont)
                    .foregroundStyle(ZenBuyTheme.ink)

                if shouldShowProcessingPanel {
                    TVProcessingPanel(progress: viewModel.processing)
                }

                if let badges = viewModel.badges {
                    TVBadgeRow(badges: badges)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(TVTheme.bodyFont)
                        .foregroundStyle(ZenBuyTheme.bear)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let warningMessage = viewModel.warningMessage {
                    Text(warningMessage)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if hasScorecard {
                    TVReportFragment(
                        html: viewModel.scorecardHTML,
                        hasScorecard: true,
                        fallbackTitle: "Scorecard"
                    )
                }

                if !viewModel.bottomLineHTML.isEmpty {
                    TVReportFragment(
                        html: viewModel.bottomLineHTML,
                        hasScorecard: hasScorecard,
                        fallbackTitle: "Bottom line",
                        showWritingIndicator: viewModel.isStreaming && viewModel.bodyHTML.isEmpty
                    )
                }

                if !viewModel.bodyHTML.isEmpty {
                    TVReportFragment(
                        html: viewModel.bodyHTML,
                        hasScorecard: hasScorecard,
                        showWritingIndicator: viewModel.isStreaming
                    )
                }

                if viewModel.allowSimilar, !viewModel.similarSymbols.isEmpty, !viewModel.isStreaming {
                    Button("Show more like this") {
                        onRunSimilar(viewModel.similarSymbols, mode)
                    }
                    .buttonStyle(.tvSecondary)
                    .padding(.top, 8)
                }
            }
            .padding(TVTheme.pagePadding)
            .frame(maxWidth: TVTheme.readingMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(ZenBuyTheme.background.ignoresSafeArea())
        .onAppear {
            viewModel.ensureStarted(
                symbols: symbols,
                mode: mode,
                directive: directive,
                profitHorizonYears: profitHorizonYears
            )
        }
    }
}

/// TV-scale rendering of a Worker HTML fragment. The shared `ReportHTMLView` is
/// tuned for iPhone metrics — a 72pt scorecard label column and `.caption` text
/// wrapped "Balance" and "Catalysts" onto two lines at 10 feet.
private struct TVReportFragment: View {
    let html: String
    var hasScorecard: Bool = false
    var fallbackTitle: String? = nil
    var showWritingIndicator: Bool = false

    var body: some View {
        let parsed = ReportHTML.parseProgressive(html, hasScorecard: hasScorecard)
        let sections = ReportHTML.sections(from: parsed.nodes, hasScorecard: hasScorecard)

        VStack(alignment: .leading, spacing: 20) {
            if sections.isEmpty {
                TVFocusableCard {
                    Text(placeholderText)
                        .font(TVTheme.bodyFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                ForEach(Array(sections.enumerated()), id: \.offset) { index, section in
                    TVFocusableCard {
                        sectionContent(section, index: index)
                    }
                }
            }

            if showWritingIndicator {
                TVWritingIndicator()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var placeholderText: String {
        let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "Receiving report…"
        }
        return ReportHTML.fallbackPlainText(html)
    }

    /// The Worker usually emits its own `<h2>` per section; `fallbackTitle`
    /// labels the lead card when it does not, instead of the duplicate
    /// "Bottom line" heading above a "BOTTOM LINE" card.
    private func sectionTitle(_ section: ReportSection, index: Int) -> String? {
        if let title = section.title, !title.isEmpty {
            return title
        }
        return index == 0 ? fallbackTitle : nil
    }

    private func sectionContent(_ section: ReportSection, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if let title = sectionTitle(section, index: index) {
                Text(title.uppercased())
                    .font(TVTheme.sectionTitleFont)
                    .foregroundStyle(ZenBuyTheme.greenDark)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(Array(section.nodes.enumerated()), id: \.offset) { _, node in
                nodeView(node)
            }
            if !section.sources.isEmpty {
                TVSourceRow(sources: section.sources)
            }
        }
    }

    @ViewBuilder
    private func nodeView(_ node: ReportHTMLNode) -> some View {
        switch node {
        case let .heading(level, text):
            Text(text)
                .font(level <= 2 ? TVTheme.sectionTitleFont : TVTheme.cardTitleFont)
                .foregroundStyle(ZenBuyTheme.greenDark)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        case let .paragraph(inlines):
            styledText(inlines)
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        case let .list(items):
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 14) {
                        Text("•")
                            .font(TVTheme.bodyFont)
                            .foregroundStyle(ZenBuyTheme.green)
                        styledText(item)
                            .font(TVTheme.bodyFont)
                            .foregroundStyle(ZenBuyTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        case let .table(headers, rows):
            VStack(alignment: .leading, spacing: 0) {
                if !headers.isEmpty {
                    tableRow(headers, isHeader: true)
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    tableRow(row, isHeader: false)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(ZenBuyTheme.border, lineWidth: 2)
            )
        case let .scorecard(rows):
            TVScorecard(rows: rows)
        case .spacer:
            Color.clear.frame(height: 8)
        }
    }

    private func tableRow(_ cells: [String], isHeader: Bool) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                Text(cell)
                    .font(isHeader ? TVTheme.captionFont.weight(.semibold) : TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(isHeader ? ZenBuyTheme.greenLight : ZenBuyTheme.card)
    }

    /// Concatenated `Text` — no AttributedString attributes (they trip Swift 6
    /// Sendable checks) and no `Link`, which cannot open on tvOS.
    private func styledText(_ inlines: [ReportInline]) -> Text {
        inlines.reduce(Text("")) { partial, inline in
            switch inline {
            case let .text(string):
                return partial + Text(string)
            case let .strong(string):
                return partial + Text(string).bold()
            case let .link(label, _):
                return partial + Text(label).underline()
            }
        }
    }
}

private struct TVScorecard: View {
    let rows: [ReportHTMLNode.ScoreRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 24) {
                    Text(row.label)
                        .font(TVTheme.scoreFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(width: 240, alignment: .leading)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(ZenBuyTheme.surface)
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [ZenBuyTheme.greenDark, ZenBuyTheme.green],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: max(10, geo.size.width * row.fraction))
                        }
                    }
                    .frame(height: 18)
                    Text(row.value)
                        .font(TVTheme.scoreFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(width: 150, alignment: .trailing)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TVBadgeRow: View {
    let badges: ReportBadges

    var body: some View {
        HStack(spacing: 20) {
            if let recommendation = badges.recommendation, !recommendation.isEmpty {
                badge(recommendation, tone: recommendation)
            }
            if let conviction = badges.conviction, !conviction.isEmpty {
                badge(conviction, tone: "hold")
            }
            if let sentiment = badges.sentiment, !sentiment.isEmpty {
                badge(sentiment, tone: sentiment)
            }
        }
    }

    /// Solid fills with white labels — the iPhone pastel pills washed out at
    /// couch distance on a bright TV panel.
    private func badge(_ text: String, tone: String) -> some View {
        let lower = tone.lowercased()
        let fill: Color = {
            if lower.contains("buy") { return ZenBuyTheme.greenPositive }
            if lower.contains("sell") { return ZenBuyTheme.bear }
            return ZenBuyTheme.neutral
        }()
        return Text(text.uppercased())
            .font(TVTheme.badgeFont)
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 30)
            .padding(.vertical, 14)
            .background(fill)
            .clipShape(Capsule())
    }
}

private struct TVProcessingPanel: View {
    let progress: ProcessingProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 20) {
                ProgressView()
                    .tint(ZenBuyTheme.green)
                VStack(alignment: .leading, spacing: 6) {
                    Text(progress.phase.copy)
                        .font(TVTheme.cardTitleFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(progress.eta)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .monospacedDigit()
                }
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(ZenBuyTheme.card)
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [ZenBuyTheme.greenDark, ZenBuyTheme.green],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(10, geo.size.width * min(1, progress.percent / 100)))
                }
            }
            .frame(height: 16)
            .animation(.linear(duration: 0.35), value: progress.percent)

            if let quote = progress.quote {
                VStack(alignment: .leading, spacing: 8) {
                    Text("“\(quote.text)”")
                        .font(TVTheme.captionFont.italic())
                        .foregroundStyle(ZenBuyTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("— \(quote.author)")
                        .font(TVTheme.eyebrowFont)
                        .foregroundStyle(ZenBuyTheme.greenDark)
                }
                .id(quote.text)
                .transition(.opacity)
            }
        }
        .padding(TVTheme.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZenBuyTheme.greenLight)
        .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous)
                .strokeBorder(ZenBuyTheme.green.opacity(0.4), lineWidth: 2)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(progress.phase.copy), \(Int(progress.percent.rounded())) percent, \(progress.eta)"
        )
    }
}

private struct TVWritingIndicator: View {
    var body: some View {
        HStack(spacing: 16) {
            ProgressView()
                .tint(ZenBuyTheme.green)
            Text("Writing…")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)
        }
        .padding(.horizontal, TVTheme.cardPadding)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZenBuyTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
    }
}

private struct TVSourceRow: View {
    let sources: [ReportSource]

    var body: some View {
        FlowLayout(spacing: 12) {
            ForEach(sources) { source in
                Text(source.label)
                    .font(TVTheme.chipFont)
                    .foregroundStyle(ZenBuyTheme.greenDark)
                    .lineLimit(1)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(ZenBuyTheme.greenLight)
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
