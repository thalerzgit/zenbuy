import SwiftUI
import WebKit

struct ReportStreamView: View {
    let symbols: [String]
    let mode: ReportMode
    let directive: String

    @Environment(ZenBuyAPIClient.self) private var api
    @State private var viewModel: ReportViewModel?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let viewModel {
                reportContent(viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(symbols.joined(separator: ", "))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if viewModel == nil {
                let vm = ReportViewModel(api: api)
                viewModel = vm
                vm.start(symbols: symbols, mode: mode, directive: directive)
            }
        }
        .onDisappear {
            viewModel?.cancel()
        }
    }

    @ViewBuilder
    private func reportContent(_ viewModel: ReportViewModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if viewModel.isStreaming {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text(viewModel.statusMessage)
                            .font(.footnote)
                            .foregroundStyle(ZenBuyTheme.muted)
                    }
                }

                if let badges = viewModel.badges {
                    BadgeRow(badges: badges)
                }

                if !viewModel.scorecardHTML.isEmpty {
                    HTMLFragmentView(html: viewModel.scorecardHTML)
                        .frame(minHeight: 80)
                }

                if !viewModel.bottomLineHTML.isEmpty {
                    HTMLFragmentView(html: viewModel.bottomLineHTML)
                        .frame(minHeight: 60)
                }

                if !viewModel.bodyHTML.isEmpty {
                    HTMLFragmentView(html: viewModel.bodyHTML)
                        .frame(minHeight: 200)
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

/// Renders server-provided HTML fragments (scorecard, markdown body) with ZenBuy styling.
struct HTMLFragmentView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let wrapped = """
        <!doctype html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; margin: 0; padding: 0; font-size: 16px; line-height: 1.5; }
            h1,h2,h3 { color: #4a6b50; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #e8e8e4; padding: 8px; text-align: left; }
          </style>
        </head>
        <body>\(html)</body>
        </html>
        """
        webView.loadHTMLString(wrapped, baseURL: nil)
    }
}

#Preview {
    NavigationStack {
        ReportStreamView(symbols: ["AAPL"], mode: .separate)
            .environment(ZenBuyAPIClient())
    }
}
