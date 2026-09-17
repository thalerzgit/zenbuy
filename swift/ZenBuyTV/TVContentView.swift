import SwiftUI

struct TVContentView: View {
    @Bindable var viewModel: SearchViewModel
    @AppStorage("zenbuy.tv.onboarding.v1") private var didOnboard = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $viewModel.path) {
            Group {
                if didOnboard {
                    TVBrowseView(viewModel: viewModel)
                } else {
                    TVOnboardingView {
                        didOnboard = true
                    }
                }
            }
            .navigationDestination(for: SearchRoute.self) { route in
                switch route {
                case .reportMode:
                    TVReportModeView(picks: viewModel.picks) { mode in
                        viewModel.confirmMode(mode)
                    }
                case .report:
                    TVReportView(
                        symbols: viewModel.picks.map(\.symbol),
                        mode: viewModel.selectedMode,
                        directive: viewModel.selectedDirectiveId,
                        profitHorizonYears: viewModel.profitHorizonYears,
                        viewModel: viewModel.report,
                        onRunSimilar: { symbols, mode in
                            viewModel.startSimilarReport(symbols: symbols, mode: mode)
                        }
                    )
                case let .directiveDetail(id):
                    if let directive = viewModel.directive(for: id) {
                        TVDirectiveDetailView(directive: directive)
                    } else {
                        Text("Strategy unavailable.")
                            .font(TVTheme.bodyFont)
                            .foregroundStyle(ZenBuyTheme.muted)
                    }
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            viewModel.handleScenePhase(phase)
        }
    }
}

#Preview {
    let api = ZenBuyAPIClient()
    TVContentView(viewModel: SearchViewModel(api: api))
        .environment(api)
}
