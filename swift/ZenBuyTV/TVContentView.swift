import SwiftUI

struct TVContentView: View {
    @Bindable var viewModel: SearchViewModel
    let store: ZenBuyStore
    let unlock: WebUnlockService
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
                        store: store,
                        unlock: unlock,
                        onRunSimilar: { symbols, mode in
                            viewModel.startSimilarReport(symbols: symbols, mode: mode)
                        },
                        onRestart: { restartFlow() }
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
        .task {
            await unlock.activate(store: store)
        }
    }

    /// Restart from a finished report: drop the in-flow selection and land back
    /// on the mode picker. The reset lives here rather than on `SearchViewModel`
    /// because that type is shared with the iPhone app, which keeps its own
    /// navigation.
    private func restartFlow() {
        viewModel.path.removeAll()
        viewModel.picks = []
        viewModel.discoverResults = []
        viewModel.suggestions = []
        viewModel.query = ""
        viewModel.errorMessage = nil
        viewModel.resetWizardForNewSession()
    }
}

extension SearchViewModel {
    /// Apple TV cold launch and Restart: always land on "What do you want to
    /// do?" even if a previous session persisted `wizard-complete`. Style and
    /// horizon stay stored — they are the defaults on the later steps.
    func resetWizardForNewSession() {
        pathIntentChosen = false
        reopenWizard()
    }
}

#Preview {
    let api = ZenBuyAPIClient()
    let viewModel = SearchViewModel(api: api)
    viewModel.resetWizardForNewSession()
    return TVContentView(
        viewModel: viewModel,
        store: ZenBuyStore(),
        unlock: WebUnlockService()
    )
    .environment(api)
}
