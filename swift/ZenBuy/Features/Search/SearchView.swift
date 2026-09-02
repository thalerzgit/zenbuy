import SwiftUI

struct SearchView: View {
    @Bindable var viewModel: SearchViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ZenBuyBrandHeader(onDark: true)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 20)
                    .background(ZenBuyTheme.greenDark)

                VStack(alignment: .leading, spacing: 20) {
                    InputModeTabs(selection: Binding(
                        get: { viewModel.inputMode },
                        set: { viewModel.setInputMode($0) }
                    ))

                    InvestmentGoalPicker(
                        selectedId: $viewModel.selectedDirectiveId,
                        directives: viewModel.directives,
                        onInfo: { viewModel.showDirectiveDetail($0.id) }
                    )

                    if viewModel.inputMode == .enter {
                        enterTickersBlock
                    } else {
                        findTickersBlock
                    }

                    if !viewModel.picks.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(viewModel.picks) { pick in
                                HStack(spacing: 6) {
                                    Text(pick.symbol)
                                        .font(.subheadline.weight(.semibold))
                                    Button {
                                        viewModel.removePick(pick)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.caption)
                                            .foregroundStyle(ZenBuyTheme.muted)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(ZenBuyTheme.sageLight)
                                .clipShape(Capsule())
                            }
                        }
                    }

                    Button("Generate report") {
                        viewModel.beginGenerate()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(ZenBuyTheme.sage)
                    .disabled(!viewModel.canGenerate)

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(ZenBuyTheme.bear)
                    }

                    Text(viewModel.inputMode == .enter
                         ? "Select 1–4 tickers. Reports stream from the ZenBuy API."
                         : "We'll suggest up to 4 names that match your goal.")
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.muted)
                }
                .padding(20)
            }
        }
        .background(ZenBuyTheme.background)
    }

    @ViewBuilder
    private var enterTickersBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ticker or company name")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(ZenBuyTheme.muted)

            TextField(
                "AAPL, Apple, Palo Alto…",
                text: $viewModel.query,
                prompt: Text("AAPL, Apple, Palo Alto…")
                    .foregroundStyle(ZenBuyTheme.muted)
            )
                .foregroundStyle(ZenBuyTheme.ink)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(14)
                .background(ZenBuyTheme.surface)
                .clipShape(Capsule())
                .onChange(of: viewModel.query) { _, _ in
                    viewModel.onQueryChanged()
                }

            if viewModel.isSearching {
                ProgressView()
                    .padding(.top, 4)
            }

            if !viewModel.suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(viewModel.suggestions) { result in
                        Button {
                            viewModel.addPick(result)
                        } label: {
                            HStack {
                                Text(result.symbol)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(ZenBuyTheme.ink)
                                Text(result.name)
                                    .font(.subheadline)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .lineLimit(1)
                                Spacer()
                            }
                            .padding(.vertical, 12)
                            .padding(.horizontal, 14)
                        }
                        if result.id != viewModel.suggestions.last?.id {
                            Divider()
                        }
                    }
                }
                .background(ZenBuyTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ZenBuyTheme.border, lineWidth: 1)
                )
            }
        }
    }

    @ViewBuilder
    private var findTickersBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("We'll suggest up to 4 names that match your goal.")
                .font(.subheadline)
                .foregroundStyle(ZenBuyTheme.muted)

            Button {
                viewModel.runDiscover()
            } label: {
                HStack {
                    if viewModel.isDiscovering {
                        ProgressView()
                    }
                    Text(viewModel.isDiscovering ? "Finding matches…" : "Find stocks for my goal")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(ZenBuyTheme.sage)
            .disabled(viewModel.isDiscovering)

            if !viewModel.discoverResults.isEmpty {
                Text("Select up to 4 — then Generate report.")
                    .font(.footnote)
                    .foregroundStyle(ZenBuyTheme.muted)

                VStack(spacing: 8) {
                    ForEach(viewModel.discoverResults) { pick in
                        let selected = viewModel.picks.contains { $0.symbol == pick.symbol }
                        Button {
                            viewModel.toggleDiscoverPick(pick)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(pick.symbol)
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(ZenBuyTheme.ink)
                                    Text(pick.name)
                                        .font(.subheadline)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(pick.fitScore)% fit")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(ZenBuyTheme.sageDark)
                                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selected ? ZenBuyTheme.sage : ZenBuyTheme.muted)
                                }
                                Text(pick.reason)
                                    .font(.footnote)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .multilineTextAlignment(.leading)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(selected ? ZenBuyTheme.sageLight : ZenBuyTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(selected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: selected ? 2 : 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        SearchView(viewModel: SearchViewModel(api: ZenBuyAPIClient()))
    }
}
