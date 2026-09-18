import SwiftUI

@main
struct ZenBuyTVApp: App {
    private let apiClient: ZenBuyAPIClient
    private let store: ZenBuyStore
    private let unlock: WebUnlockService
    @State private var searchViewModel: SearchViewModel

    init() {
        let unlock = WebUnlockService()
        // Same wiring as the iPhone app: once a purchase has been redeemed the
        // TV's own requests carry the session token, which is what moves it off
        // the free weekly allowance.
        let api = ZenBuyAPIClient(sessionToken: { unlock.sessionToken })
        self.unlock = unlock
        apiClient = api
        store = ZenBuyStore()
        _searchViewModel = State(initialValue: SearchViewModel(api: api))
    }

    var body: some Scene {
        WindowGroup {
            TVContentView(viewModel: searchViewModel, store: store, unlock: unlock)
                .environment(apiClient)
                .environment(store)
                .environment(unlock)
                .tint(ZenBuyTheme.sage)
        }
    }
}
