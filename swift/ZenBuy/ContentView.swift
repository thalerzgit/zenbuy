import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationStack {
            SearchView()
                .navigationBarHidden(true)
        }
    }
}

#Preview {
    ContentView()
        .environment(ZenBuyAPIClient())
}
