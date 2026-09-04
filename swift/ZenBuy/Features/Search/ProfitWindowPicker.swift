import SwiftUI

/// Optional profit window overlaid on the investment goal — the native twin of
/// the web "Profit window" pills.
struct ProfitWindowPicker: View {
    let selectedYears: Int
    let options: [ProfitHorizonOption]
    var onSelect: (Int) -> Void

    private var selectedId: String? {
        ProfitHorizonOption.closest(to: selectedYears, in: options)?.id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 4) {
                Text("Profit window")
                    .font(.subheadline.weight(.semibold))
                Text("(optional)")
                    .font(.subheadline)
                    .opacity(0.85)
            }
            .foregroundStyle(ZenBuyTheme.muted)

            FlowLayout(spacing: 8) {
                ForEach(options) { option in
                    pill(for: option)
                }
            }
        }
    }

    @ViewBuilder
    private func pill(for option: ProfitHorizonOption) -> some View {
        let selected = selectedId == option.id
        Button {
            onSelect(option.years)
        } label: {
            Text(option.label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(selected ? ZenBuyTheme.sageDark : ZenBuyTheme.muted)
                // Matches the goal chip height, which the info circle sets.
                .frame(minHeight: 18)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(selected ? ZenBuyTheme.sageLight : ZenBuyTheme.background)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(selected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: selected ? 2 : 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Profit window \(option.label)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : [.isButton])
    }
}

#Preview {
    ProfitWindowPicker(
        selectedYears: 12,
        options: ProfitHorizonOption.bundled,
        onSelect: { _ in }
    )
    .padding(20)
    .background(ZenBuyTheme.background)
}
