import SwiftUI

/// High-contrast Enter / Find control. Stock `.pickerStyle(.segmented)` washes out
/// on a white background (both sides look selected). Selected = sage fill + white
/// label; unselected = light gray + muted ink — matches the web pill pair.
struct InputModeTabs: View {
    @Binding var selection: SearchInputMode
    var onSelect: (SearchInputMode) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 8) {
            ForEach(SearchInputMode.allCases) { mode in
                let selected = selection == mode
                Button {
                    selection = mode
                    onSelect(mode)
                } label: {
                    Text(mode.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(selected ? Color.white : ZenBuyTheme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selected ? ZenBuyTheme.sage : ZenBuyTheme.surface)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(selected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Ticker source")
    }
}
