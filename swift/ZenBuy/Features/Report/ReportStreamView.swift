import SwiftUI

struct ReportStreamView: View {
    let symbols: [String]
    let mode: ReportMode
    let directive: String
    @Bindable var viewModel: ReportViewModel

    var body: some View {
        reportContent(viewModel)
            .navigationTitle(symbols.joined(separator: ", "))
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
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
                if viewModel.processing.isVisible {
                    ProcessingPanelView(progress: viewModel.processing)
                }

                if let badges = viewModel.badges {
                    BadgeRow(badges: badges)
                }

                if !viewModel.scorecardHTML.isEmpty {
                    ReportHTMLView(html: viewModel.scorecardHTML)
                }

                if !viewModel.bottomLineHTML.isEmpty {
                    ReportHTMLView(html: viewModel.bottomLineHTML)
                }

                if !viewModel.bodyHTML.isEmpty {
                    ReportHTMLView(html: viewModel.bodyHTML)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.bear)
                }
            }
            .padding(20)
        }
        .background(ZenBuyTheme.background)
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
