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
            VStack(alignment: .leading, spacing: 24) {
                Text(title)
                    .font(TVTheme.titleFont)
                    .foregroundStyle(ZenBuyTheme.ink)

                if shouldShowProcessingPanel {
                    ProcessingPanelView(progress: viewModel.processing)
                }

                if let badges = viewModel.badges {
                    TVBadgeRow(badges: badges)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(TVTheme.bodyFont)
                        .foregroundStyle(ZenBuyTheme.bear)
                }

                if let warningMessage = viewModel.warningMessage {
                    Text(warningMessage)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                }

                if hasScorecard {
                    ReportHTMLView(html: viewModel.scorecardHTML, hasScorecard: true)
                }

                if !viewModel.bottomLineHTML.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Bottom line")
                            .font(TVTheme.headlineFont)
                            .foregroundStyle(ZenBuyTheme.sageDark)
                        ReportHTMLView(
                            html: viewModel.bottomLineHTML,
                            hasScorecard: hasScorecard,
                            showWritingIndicator: viewModel.isStreaming && viewModel.bodyHTML.isEmpty
                        )
                    }
                }

                if !viewModel.bodyHTML.isEmpty {
                    ReportHTMLView(
                        html: viewModel.bodyHTML,
                        hasScorecard: hasScorecard,
                        showWritingIndicator: viewModel.isStreaming
                    )
                }

                if viewModel.allowSimilar, !viewModel.similarSymbols.isEmpty, !viewModel.isStreaming {
                    Button("Show more like this") {
                        onRunSimilar(viewModel.similarSymbols, mode)
                    }
                    .buttonStyle(.bordered)
                    .tint(ZenBuyTheme.sage)
                    .font(TVTheme.headlineFont)
                }
            }
            .padding(TVTheme.pagePadding)
            .frame(maxWidth: 1400, alignment: .leading)
        }
        .background(ZenBuyTheme.background)
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

private struct TVBadgeRow: View {
    let badges: ReportBadges

    var body: some View {
        HStack(spacing: 16) {
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

    private func badge(_ text: String, tone: String) -> some View {
        let lower = tone.lowercased()
        let background: Color = {
            if lower.contains("buy") { return ZenBuyTheme.badgeBuy }
            if lower.contains("sell") { return ZenBuyTheme.badgeSell }
            return ZenBuyTheme.badgeHold
        }()
        return Text(text.uppercased())
            .font(TVTheme.captionFont.weight(.bold))
            .foregroundStyle(ZenBuyTheme.ink)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(background)
            .clipShape(Capsule())
    }
}
