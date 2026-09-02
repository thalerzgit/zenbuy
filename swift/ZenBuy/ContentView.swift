import SwiftUI

struct ContentView: View {
    @Bindable var viewModel: SearchViewModel
    @Environment(ZenBuyAPIClient.self) private var api

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
                            api: api
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
    }
}

#Preview {
    let api = ZenBuyAPIClient()
    ContentView(viewModel: SearchViewModel(api: api))
        .environment(api)
}
