import SwiftUI

enum SearchInputMode: String, CaseIterable, Identifiable, Sendable {
    case enter
    case find

    var id: String { rawValue }

    var title: String {
        switch self {
        case .enter: return "Enter Tickers"
        case .find: return "Find Tickers"
        }
    }
}

enum SearchRoute: Hashable {
    case reportMode
    case report
    case directiveDetail(String)
}

@Observable
@MainActor
final class SearchViewModel {
    var query = ""
    var suggestions: [SymbolResult] = []
    var picks: [SymbolResult] = []
    var isSearching = false
    var errorMessage: String?
    var path: [SearchRoute] = []
    var selectedMode: ReportMode = .separate
    var selectedDirectiveId: String = InvestmentDirectiveInfo.defaultDirectiveId
    var directives: [InvestmentDirectiveInfo] = InvestmentDirectiveInfo.bundled
    var profitHorizonYears: Int = ProfitHorizonOption.loadStoredYears(
        for: InvestmentDirectiveInfo.defaultDirectiveId
    )
    var profitHorizonOptions: [ProfitHorizonOption] = ProfitHorizonOption.bundled
    var inputMode: SearchInputMode = .enter
    var discoverResults: [DiscoverPick] = []
    var isDiscovering = false
    let report: ReportViewModel

    private let api: ZenBuyAPIClient
    private var searchTask: Task<Void, Never>?
    private var discoverTask: Task<Void, Never>?

    init(api: ZenBuyAPIClient) {
        self.api = api
        self.report = ReportViewModel(api: api)
        Task { await loadConfig() }
    }

    private func loadConfig() async {
        guard let config = try? await api.fetchConfig() else { return }
        if let list = config.investmentDirectives, !list.isEmpty {
            directives = list
            if let defaultId = config.defaultDirectiveId {
                selectedDirectiveId = defaultId
                // A stored pick still wins; this only re-derives the default.
                profitHorizonYears = ProfitHorizonOption.loadStoredYears(for: defaultId)
            }
        }
        if let windows = config.profitHorizonOptions, !windows.isEmpty {
            profitHorizonOptions = windows
        }
    }

    var canGenerate: Bool {
        !picks.isEmpty && picks.count <= 4
    }

    func onQueryChanged() {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 1 else {
            suggestions = []
            isSearching = false
            return
        }

        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            isSearching = true
            defer { isSearching = false }

            do {
                let results = try await api.search(query: trimmed)
                guard !Task.isCancelled else { return }
                suggestions = results
                errorMessage = nil
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                suggestions = []
                errorMessage = error.localizedDescription
            }
        }
    }

    func addPick(_ result: SymbolResult) {
        guard picks.count < 4 else { return }
        guard !picks.contains(result) else { return }
        picks.append(result)
        query = ""
        suggestions = []
        Task { await api.prefetch(symbol: result.symbol) }
    }

    func removePick(_ result: SymbolResult) {
        picks.removeAll { $0 == result }
    }

    /// Web parity: choosing a goal resets the profit window to that goal's
    /// default, and either change invalidates the current discover matches.
    func selectDirective(_ id: String) {
        guard selectedDirectiveId != id else { return }
        selectedDirectiveId = id
        setProfitHorizonYears(InvestmentDirectiveInfo.defaultProfitHorizonYears(for: id))
    }

    func setProfitHorizonYears(_ years: Int) {
        profitHorizonYears = years
        ProfitHorizonOption.saveStoredYears(years)
        clearDiscoverResults()
    }

    private func clearDiscoverResults() {
        discoverTask?.cancel()
        isDiscovering = false
        discoverResults = []
    }

    func setInputMode(_ mode: SearchInputMode) {
        guard inputMode != mode else { return }
        inputMode = mode
        errorMessage = nil
        if mode == .enter {
            clearDiscoverResults()
        } else {
            query = ""
            suggestions = []
            searchTask?.cancel()
            isSearching = false
        }
    }

    func runDiscover() {
        discoverTask?.cancel()
        isDiscovering = true
        errorMessage = nil
        discoverTask = Task {
            do {
                let results = try await api.discover(
                    directive: selectedDirectiveId,
                    profitHorizonYears: profitHorizonYears
                )
                guard !Task.isCancelled else { return }
                discoverResults = results
                picks = results.map { SymbolResult(symbol: $0.symbol, name: $0.name) }
                for pick in results.prefix(4) {
                    Task { await api.prefetch(symbol: pick.symbol) }
                }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                discoverResults = []
                errorMessage = error.localizedDescription
            }
            isDiscovering = false
        }
    }

    func toggleDiscoverPick(_ pick: DiscoverPick) {
        let result = SymbolResult(symbol: pick.symbol, name: pick.name)
        if picks.contains(result) {
            removePick(result)
        } else {
            addPick(result)
        }
    }

    func showDirectiveDetail(_ id: String) {
        path.append(.directiveDetail(id))
    }

    func beginGenerate() {
        guard canGenerate else { return }
        if picks.count > 1 {
            if path.last != .reportMode {
                path.append(.reportMode)
            }
        } else {
            selectedMode = .separate
            startReportIfNeeded()
            if path.last != .report {
                path.append(.report)
            }
        }
    }

    func confirmMode(_ mode: ReportMode) {
        selectedMode = mode
        startReportIfNeeded()
        if path.last != .report {
            path.append(.report)
        }
    }

    /// Swap the ticker selection for the peers and re-run in the same report
    /// view, keeping the current goal and profit window.
    func startSimilarReport(symbols: [String], mode: ReportMode) {
        guard !symbols.isEmpty else { return }
        picks = symbols.prefix(4).map { SymbolResult(symbol: $0, name: $0) }
        selectedMode = picks.count > 1 ? mode : .separate
        report.startSimilar(
            symbols: picks.map(\.symbol),
            mode: selectedMode,
            directive: selectedDirectiveId,
            profitHorizonYears: profitHorizonYears
        )
    }

    func handleScenePhase(_ phase: ScenePhase) {
        report.handleScenePhase(phase)
    }

    func startReportIfNeeded() {
        report.ensureStarted(
            symbols: picks.map(\.symbol),
            mode: selectedMode,
            directive: selectedDirectiveId,
            profitHorizonYears: profitHorizonYears
        )
    }

    func directive(for id: String) -> InvestmentDirectiveInfo? {
        directives.first { $0.id == id }
    }
}
