import SwiftUI

@main
struct ZenBuyTVApp: App {
    private let apiClient: ZenBuyAPIClient
    private let store: ZenBuyStore
    private let unlock: WebUnlockService
    @State private var searchViewModel: SearchViewModel

    init() {
        let unlock = WebUnlockService()
        let store = ZenBuyStore()
        // Same wiring as the iPhone app: once a purchase has been redeemed the
        // TV's own requests carry the session token, which is what moves it off
        // the free weekly allowance. TestFlight also sends the sandbox
        // AppTransaction JWS so every tester is complimentary, not one Apple ID.
        let api = ZenBuyAPIClient(
            sessionToken: { unlock.sessionToken },
            appTransactionJWS: { store.testFlightTransactionJWS }
        )
        self.unlock = unlock
        apiClient = api
        self.store = store
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
