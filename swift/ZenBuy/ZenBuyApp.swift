import SwiftUI

@main
struct ZenBuyApp: App {
    @State private var apiClient = ZenBuyAPIClient()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(apiClient)
                .tint(ZenBuyTheme.sage)
        }
    }
}
