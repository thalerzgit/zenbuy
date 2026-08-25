import SwiftUI

@Observable
@MainActor
final class SearchViewModel {
    var query = ""
    var suggestions: [SymbolResult] = []
    var picks: [SymbolResult] = []
    var isSearching = false
    var errorMessage: String?
    var showModeSheet = false
    var showReport = false
    var selectedMode: ReportMode = .separate

    private let api: ZenBuyAPIClient
    private var searchTask: Task<Void, Never>?

    init(api: ZenBuyAPIClient) {
        self.api = api
    }

    var canGenerate: Bool {
        !picks.isEmpty && picks.count <= 4
    }

    func onQueryChanged() {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 1 else {
            suggestions = []
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

    func beginGenerate() {
        guard canGenerate else { return }
        if picks.count > 1 {
            showModeSheet = true
        } else {
            selectedMode = .separate
            showReport = true
        }
    }

    func confirmMode(_ mode: ReportMode) {
        selectedMode = mode
        showModeSheet = false
        showReport = true
    }
}
