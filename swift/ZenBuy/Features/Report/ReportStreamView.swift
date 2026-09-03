import SwiftUI

struct ReportStreamView: View {
    let symbols: [String]
    let mode: ReportMode
    let directive: String
    @Bindable var viewModel: ReportViewModel

    private var title: String { symbols.joined(separator: ", ") }
    private var hasScorecard: Bool { !viewModel.scorecardHTML.isEmpty }
    private var canShare: Bool {
        !viewModel.bottomLineHTML.isEmpty || !viewModel.bodyHTML.isEmpty || hasScorecard
    }

    /// Non-empty parsed sections / scorecard rows — not merely non-empty HTML strings.
    private var hasVisibleReportContent: Bool {
        ReportHTML.hasVisibleContent(
            bottomLineHTML: viewModel.bottomLineHTML,
            bodyHTML: viewModel.bodyHTML,
            scorecardHTML: viewModel.scorecardHTML
        )
    }

    /// Mid-stream: keep the panel until content or error. After finish, follow
    /// `processing.isVisible` so "Report ready" cannot pin forever on empty HTML.
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
        reportContent(viewModel)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // Generate PDF only when streaming is done — never from body
                    // on every sticky/body HTML tick (layout thrash on TestFlight).
                    if canShare, !viewModel.isStreaming, let url = viewModel.sharePDFURL(title: title) {
                        ShareLink(item: url) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    } else {
                        Image(systemName: "square.and.arrow.up")
                            .foregroundStyle(ZenBuyTheme.muted.opacity(0.45))
                            .accessibilityLabel(
                                viewModel.isStreaming ? "Share available when report finishes" : "Share unavailable"
                            )
                    }
                }
            }
            .onAppear {
                ReportVerboseLog.log(
                    "ReportStreamView.onAppear symbols=\(symbols.joined(separator: ",")) mode=\(mode.rawValue)"
                )
                viewModel.ensureStarted(
                    symbols: symbols,
                    mode: mode,
                    directive: directive,
                    profitHorizonYears: InvestmentDirectiveInfo.defaultProfitHorizonYears(for: directive)
                )
            }
    }

    @ViewBuilder
    private func reportContent(_ viewModel: ReportViewModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if shouldShowProcessingPanel {
                    ProcessingPanelView(progress: viewModel.processing)
                }

                if let badges = viewModel.badges {
                    BadgeRow(badges: badges)
                }

                if hasScorecard {
                    scorecardBlock
                }

                if !viewModel.bottomLineHTML.isEmpty {
                    ReportHTMLView(
                        html: viewModel.bottomLineHTML,
                        hasScorecard: hasScorecard,
                        showWritingIndicator: viewModel.isStreaming && viewModel.bodyHTML.isEmpty
                    )
                }

                if !viewModel.bodyHTML.isEmpty {
                    ReportHTMLView(
                        html: viewModel.bodyHTML,
                        hasScorecard: hasScorecard,
                        showWritingIndicator: viewModel.isStreaming
                    )
                }

                if let warningMessage = viewModel.warningMessage, viewModel.errorMessage == nil {
                    Text(warningMessage)
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.bear)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                // Guarantee non-zero content height while waiting (nav chrome alone = white void).
                if !shouldShowProcessingPanel,
                   !hasVisibleReportContent,
                   viewModel.errorMessage == nil,
                   viewModel.bottomLineHTML.isEmpty,
                   viewModel.bodyHTML.isEmpty,
                   !hasScorecard {
                    Text("Receiving report…")
                        .font(.body)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ZenBuyTheme.background)
        .onChange(of: viewModel.processing.isVisible) { _, visible in
            ReportVerboseLog.log(
                "processing visible=\(visible) phase=\(viewModel.processing.phase.rawValue) percent=\(Int(viewModel.processing.percent)) hasContent=\(hasVisibleReportContent)"
            )
        }
    }

    @ViewBuilder
    private var scorecardBlock: some View {
        let scoreNodes = ReportHTML.parse(viewModel.scorecardHTML)
        if scoreNodes.isEmpty {
            Text("Receiving scorecard…")
                .font(.footnote)
                .foregroundStyle(ZenBuyTheme.muted)
        } else {
            ForEach(Array(scoreNodes.enumerated()), id: \.offset) { _, node in
                if case let .scorecard(rows) = node {
                    ScorecardView(rows: rows)
                }
            }
        }
    }
}

private struct BadgeRow: View {
    let badges: ReportBadges

    var body: some View {
        HStack(spacing: 8) {
            if let recommendation = badges.recommendation {
                BadgePill(text: recommendation, color: ZenBuyTheme.sageDark)
            }
            if let sentiment = badges.sentiment {
                BadgePill(text: sentiment, color: ZenBuyTheme.muted)
            }
            if let conviction = badges.conviction {
                BadgePill(text: conviction, color: ZenBuyTheme.bull)
            }
        }
    }
}

private struct BadgePill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

#Preview {
    NavigationStack {
        ReportStreamView(
            symbols: ["AAPL"],
            mode: .separate,
            directive: "growth",
            viewModel: ReportViewModel(api: ZenBuyAPIClient())
        )
    }
}
