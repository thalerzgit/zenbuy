import SwiftUI

struct ReportModeSheet: View {
    let picks: [SymbolResult]
    let onSelect: (ReportMode) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var mode: ReportMode = .separate

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("How should we analyze these?")
                    .font(.title2.weight(.semibold))

                Text("You selected \(picks.map(\.symbol).joined(separator: ", ")).")
                    .font(.subheadline)
                    .foregroundStyle(ZenBuyTheme.muted)

                Picker("Report style", selection: $mode) {
                    Text("Separate reports").tag(ReportMode.separate)
                    Text("Comparative report").tag(ReportMode.comparative)
                }
                .pickerStyle(.inline)

                Text(mode == .separate
                    ? "One full report per company."
                    : "Rank names and pick the best fit.")
                    .font(.footnote)
                    .foregroundStyle(ZenBuyTheme.muted)

                Spacer()

                Button("Continue") {
                    onSelect(mode)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(ZenBuyTheme.sage)
            }
            .padding(24)
            .navigationTitle("Report style")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview {
    ReportModeSheet(picks: [
        SymbolResult(symbol: "AAPL", name: "Apple Inc"),
        SymbolResult(symbol: "MSFT", name: "Microsoft Corp"),
    ]) { _ in }
}
