import SwiftUI

struct ContentView: View {
    @Bindable var viewModel: SearchViewModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $viewModel.path) {
            SearchView(viewModel: viewModel)
                .navigationBarHidden(true)
                .navigationDestination(for: SearchRoute.self) { route in
                    switch route {
                    case .reportMode:
                        ReportModeView(picks: viewModel.picks) { mode in
                            viewModel.confirmMode(mode)
                        }
                    case .report:
                        ReportStreamView(
                            symbols: viewModel.picks.map(\.symbol),
                            mode: viewModel.selectedMode,
                            directive: viewModel.selectedDirectiveId,
                            viewModel: viewModel.report,
                            onRunSimilar: { symbols, mode in
                                viewModel.startSimilarReport(symbols: symbols, mode: mode)
                            }
                        )
                    case let .directiveDetail(id):
                        if let directive = viewModel.directive(for: id) {
                            DirectiveDetailView(directive: directive)
                        } else {
                            Text("Strategy unavailable.")
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
    ContentView(viewModel: SearchViewModel(api: api))
        .environment(api)
        .environment(ZenBuyStore())
        .environment(WebUnlockService())
}
