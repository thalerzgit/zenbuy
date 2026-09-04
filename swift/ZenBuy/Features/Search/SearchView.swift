import SwiftUI

private enum SearchScrollID: Hashable {
    case tickerField
    case suggestions
    case picks
}

struct SearchView: View {
    @Bindable var viewModel: SearchViewModel
    @Environment(ZenBuyStore.self) private var store
    @Environment(WebUnlockService.self) private var unlock
    @FocusState private var tickerFieldFocused: Bool
    @State private var showUnlock = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ZenBuyBrandHeader(onDark: true)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .padding(.horizontal, 20)
                        .background(ZenBuyTheme.greenDark)
                        .overlay(alignment: .topTrailing) { unlockButton }

                    VStack(alignment: .leading, spacing: 20) {
                        InputModeTabs(selection: Binding(
                            get: { viewModel.inputMode },
                            set: { viewModel.setInputMode($0) }
                        ))

                        InvestmentGoalPicker(
                            selectedId: Binding(
                                get: { viewModel.selectedDirectiveId },
                                set: { viewModel.selectDirective($0) }
                            ),
                            directives: viewModel.directives,
                            onInfo: { viewModel.showDirectiveDetail($0.id) }
                        )

                        ProfitWindowPicker(
                            selectedYears: viewModel.profitHorizonYears,
                            options: viewModel.profitHorizonOptions,
                            onSelect: { viewModel.setProfitHorizonYears($0) }
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
                                            .foregroundStyle(ZenBuyTheme.ink)
                                        Button {
                                            viewModel.removePick(pick)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .font(.caption)
                                                .foregroundStyle(ZenBuyTheme.ink)
                                        }
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(ZenBuyTheme.sageLight)
                                    .clipShape(Capsule())
                                }
                            }
                            .id(SearchScrollID.picks)
                        }

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
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: tickerFieldFocused) { _, focused in
                guard focused else { return }
                scrollTickerIntoView(proxy)
            }
            .onChange(of: viewModel.suggestions.count) { _, count in
                guard tickerFieldFocused, count > 0 else { return }
                scrollTickerIntoView(proxy)
            }
        }
        .background(ZenBuyTheme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomChrome
        }
        .sheet(isPresented: $showUnlock) {
            UnlockWebView(store: store, unlock: unlock)
        }
    }

    /// The globe: buy, restore, and link the purchase so zenbuy.info unlocks.
    /// The website's guide names this button by its icon, so it stays a globe.
    private var unlockButton: some View {
        Button {
            showUnlock = true
        } label: {
            Image(systemName: "globe")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(
                    unlock.status == .unlocked ? ZenBuyTheme.insightGold : .white
                )
                .padding(12)
        }
        .accessibilityLabel(
            unlock.status == .unlocked ? "Web unlocked" : "Unlock the website"
        )
    }

    @ViewBuilder
    private var bottomChrome: some View {
        if tickerFieldFocused && !viewModel.suggestions.isEmpty {
            tickerSuggestions
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(ZenBuyTheme.background)
        } else if viewModel.canGenerate {
            generateBar
        }
    }

    private var generateBar: some View {
        Button("Generate report") {
            tickerFieldFocused = false
            viewModel.beginGenerate()
        }
        .buttonStyle(.borderedProminent)
        .tint(ZenBuyTheme.sage)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 12)
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
                .submitLabel(.done)
                .focused($tickerFieldFocused)
                .padding(14)
                .background(ZenBuyTheme.surface)
                .clipShape(Capsule())
                .id(SearchScrollID.tickerField)
                .onChange(of: viewModel.query) { _, _ in
                    viewModel.onQueryChanged()
                }
                .onSubmit {
                    tickerFieldFocused = false
                }

            if viewModel.isSearching {
                ProgressView()
                    .padding(.top, 4)
            }

            if !viewModel.suggestions.isEmpty && !tickerFieldFocused {
                tickerSuggestions
                    .id(SearchScrollID.suggestions)
            }
        }
    }

    private var tickerSuggestions: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(viewModel.suggestions) { result in
                    Button {
                        viewModel.addPick(result)
                        tickerFieldFocused = false
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
        }
        .frame(maxHeight: 260)
        .background(ZenBuyTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ZenBuyTheme.border, lineWidth: 1)
        )
        .id(SearchScrollID.suggestions)
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

    private func scrollTickerIntoView(_ proxy: ScrollViewProxy) {
        Task { @MainActor in
            withAnimation(.easeInOut(duration: 0.2)) {
                proxy.scrollTo(SearchScrollID.tickerField, anchor: .top)
            }
        }
    }
}

#Preview {
    NavigationStack {
        SearchView(viewModel: SearchViewModel(api: ZenBuyAPIClient()))
            .environment(ZenBuyStore())
            .environment(WebUnlockService())
    }
}
