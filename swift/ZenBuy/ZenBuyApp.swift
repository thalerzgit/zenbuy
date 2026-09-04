import SwiftUI

@main
struct ZenBuyApp: App {
    private let apiClient: ZenBuyAPIClient
    private let store: ZenBuyStore
    private let unlock: WebUnlockService
    @State private var searchViewModel: SearchViewModel

    init() {
        let unlock = WebUnlockService()
        // A linked purchase earns the unlocked daily allowance in the app too,
        // so every API call carries the session token once there is one.
        let api = ZenBuyAPIClient(sessionToken: { unlock.sessionToken })
        self.unlock = unlock
        apiClient = api
        store = ZenBuyStore()
        _searchViewModel = State(initialValue: SearchViewModel(api: api))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(viewModel: searchViewModel)
                .environment(apiClient)
                .environment(store)
                .environment(unlock)
                .tint(ZenBuyTheme.sage)
        }
    }
}
