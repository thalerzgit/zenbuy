import SwiftUI

@main
struct ZenBuyApp: App {
    private let apiClient: ZenBuyAPIClient
    @State private var searchViewModel: SearchViewModel

    init() {
        let api = ZenBuyAPIClient()
        apiClient = api
        _searchViewModel = State(initialValue: SearchViewModel(api: api))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(viewModel: searchViewModel)
                .environment(apiClient)
                .tint(ZenBuyTheme.sage)
        }
    }
}
