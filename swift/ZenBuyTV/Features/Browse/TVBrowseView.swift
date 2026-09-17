import SwiftUI

struct TVBrowseView: View {
    @Bindable var viewModel: SearchViewModel
    @FocusState private var tickerFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: TVTheme.stackSpacing) {
                    if viewModel.wizardStep != .unlocked {
                        wizardChrome
                    } else {
                        summaryBar
                    }

                    switch viewModel.wizardStep {
                    case .pathIntent:
                        pathIntent
                    case .investmentGoal:
                        goalPicker
                    case .profitWindow:
                        windowPicker
                    case .unlocked:
                        unlockedPath
                    }

                    if viewModel.wizardStep != .unlocked {
                        wizardNav
                    }

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(TVTheme.captionFont)
                            .foregroundStyle(ZenBuyTheme.bear)
                    }
                }
                .padding(.horizontal, TVTheme.pagePadding)
                .padding(.vertical, 28)
            }
        }
        .background(ZenBuyTheme.background)
        .onAppear {
            viewModel.onUnlockedPathAppeared()
        }
    }

    private var header: some View {
        HStack {
            ZenBuyBrandHeader(onDark: true, compact: true)
            Spacer()
            Text("Apple TV")
                .font(TVTheme.captionFont.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.insightGold)
        }
        .padding(.horizontal, TVTheme.pagePadding)
        .padding(.vertical, 22)
        .background(ZenBuyTheme.forestHeader)
    }

    private var wizardChrome: some View {
        HStack {
            Text(viewModel.wizardStep.progressLabel ?? "Get set")
                .font(TVTheme.captionFont.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.muted)
            Spacer()
        }
    }

    private var summaryBar: some View {
        HStack(spacing: 24) {
            Text(viewModel.wizardSummary)
                .font(TVTheme.headlineFont)
                .foregroundStyle(ZenBuyTheme.sageDark)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 16)
            Button("Change setup") {
                viewModel.reopenWizard()
            }
            .buttonStyle(.bordered)
            .tint(ZenBuyTheme.sage)
        }
        .padding(TVTheme.cardPadding)
        .background(ZenBuyTheme.sageLight)
        .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
    }

    private var wizardNav: some View {
        HStack(spacing: 24) {
            if viewModel.wizardStep != .pathIntent {
                Button("Back") {
                    viewModel.goBackWizard()
                }
                .buttonStyle(.bordered)
                .tint(ZenBuyTheme.sage)
            }
            Button("Continue") {
                viewModel.continueWizard()
            }
            .buttonStyle(.borderedProminent)
            .tint(ZenBuyTheme.sage)
            .disabled(!viewModel.canContinueWizard)
        }
    }

    private var pathIntent: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What do you want to do?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            HStack(alignment: .top, spacing: TVTheme.columnGap) {
                intentCard(
                    mode: .find,
                    title: "Find stocks",
                    subtitle: "We’ll suggest names that match your style and time window."
                )
                intentCard(
                    mode: .enter,
                    title: "Analyze tickers you know",
                    subtitle: "Search by symbol or company name, then generate a report."
                )
            }
        }
    }

    private func intentCard(mode: SearchInputMode, title: String, subtitle: String) -> some View {
        let selected = viewModel.pathIntentChosen && viewModel.inputMode == mode
        return Button {
            viewModel.choosePathIntent(mode)
        } label: {
            TVFocusCard(selected: selected) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(title)
                        .font(TVTheme.headlineFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                    Text(subtitle)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .buttonStyle(.card)
    }

    private var goalPicker: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What’s your investment goal?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 380), spacing: 20)], spacing: 20) {
                ForEach(viewModel.directives) { directive in
                    let selected = viewModel.selectedDirectiveId == directive.id
                    VStack(alignment: .leading, spacing: 10) {
                        Button {
                            viewModel.selectDirective(directive.id)
                        } label: {
                            TVFocusCard(selected: selected) {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text(directive.label)
                                        .font(TVTheme.headlineFont)
                                        .foregroundStyle(ZenBuyTheme.ink)
                                    Text(directive.headline)
                                        .font(TVTheme.captionFont)
                                        .foregroundStyle(ZenBuyTheme.sageDark)
                                    Text(directive.plainEnglish)
                                        .font(TVTheme.captionFont)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                        .lineLimit(3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        .buttonStyle(.card)

                        Button("About this goal") {
                            viewModel.showDirectiveDetail(directive.id)
                        }
                        .buttonStyle(.bordered)
                        .tint(ZenBuyTheme.sage)
                    }
                }
            }
        }
    }

    private var windowPicker: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What’s your profit window?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            HStack(spacing: 20) {
                ForEach(viewModel.profitHorizonOptions) { option in
                    let selected = ProfitHorizonOption.closest(
                        to: viewModel.profitHorizonYears,
                        in: viewModel.profitHorizonOptions
                    )?.id == option.id
                    Button {
                        viewModel.setProfitHorizonYears(option.years)
                    } label: {
                        TVFocusCard(selected: selected) {
                            Text(option.label)
                                .font(TVTheme.headlineFont)
                                .foregroundStyle(ZenBuyTheme.ink)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.card)
                }
            }
        }
    }

    @ViewBuilder
    private var unlockedPath: some View {
        if viewModel.inputMode == .enter {
            enterTickers
        } else {
            findTickers
        }

        if !viewModel.picks.isEmpty {
            picksRow
        }

        if viewModel.canGenerate {
            Button("Generate report") {
                tickerFieldFocused = false
                viewModel.beginGenerate()
            }
            .buttonStyle(.borderedProminent)
            .tint(ZenBuyTheme.sage)
            .font(TVTheme.headlineFont)
        }
    }

    private var enterTickers: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Ticker or company name")
                .font(TVTheme.headlineFont)
                .foregroundStyle(ZenBuyTheme.ink)

            TextField("AAPL, Apple, Palo Alto…", text: $viewModel.query)
                .font(TVTheme.bodyFont)
                .focused($tickerFieldFocused)
                .onChange(of: viewModel.query) { _, _ in
                    viewModel.onQueryChanged()
                }
                .onSubmit {
                    tickerFieldFocused = false
                }

            if viewModel.isSearching {
                ProgressView()
                    .tint(ZenBuyTheme.sage)
            }

            if !viewModel.suggestions.isEmpty {
                VStack(spacing: 12) {
                    ForEach(viewModel.suggestions) { result in
                        Button {
                            viewModel.addPick(result)
                            tickerFieldFocused = false
                        } label: {
                            TVFocusCard(selected: false) {
                                HStack {
                                    Text(result.symbol)
                                        .font(TVTheme.headlineFont)
                                        .foregroundStyle(ZenBuyTheme.ink)
                                    Text(result.name)
                                        .font(TVTheme.captionFont)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                        .lineLimit(1)
                                    Spacer()
                                }
                            }
                        }
                        .buttonStyle(.card)
                    }
                }
            }

            Text("Select 1–4 tickers. Reports stream from zenbuy.info.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)
        }
    }

    private var findTickers: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("We’ll suggest up to 4 names that match your goal.")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)

            Button {
                viewModel.runDiscover()
            } label: {
                HStack(spacing: 16) {
                    if viewModel.isDiscovering {
                        ProgressView()
                    }
                    Text(viewModel.isDiscovering ? "Finding matches…" : "Find stocks for my goal")
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(ZenBuyTheme.sage)
            .disabled(viewModel.isDiscovering)

            if !viewModel.discoverResults.isEmpty {
                Text("Click a name to add or remove it, then generate.")
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)

                VStack(spacing: 14) {
                    ForEach(viewModel.discoverResults) { pick in
                        let selected = viewModel.picks.contains { $0.symbol == pick.symbol }
                        Button {
                            viewModel.toggleDiscoverPick(pick)
                        } label: {
                            TVFocusCard(selected: selected) {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text(pick.symbol)
                                            .font(TVTheme.headlineFont)
                                            .foregroundStyle(ZenBuyTheme.ink)
                                        Text(pick.name)
                                            .font(TVTheme.captionFont)
                                            .foregroundStyle(ZenBuyTheme.muted)
                                            .lineLimit(1)
                                        Spacer()
                                        Text("\(pick.fitScore)% fit")
                                            .font(TVTheme.captionFont.weight(.semibold))
                                            .foregroundStyle(ZenBuyTheme.sageDark)
                                    }
                                    Text(pick.reason)
                                        .font(TVTheme.captionFont)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        .buttonStyle(.card)
                    }
                }
            }
        }
    }

    private var picksRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Selected")
                .font(TVTheme.captionFont.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.muted)
            HStack(spacing: 16) {
                ForEach(viewModel.picks) { pick in
                    Button {
                        viewModel.removePick(pick)
                    } label: {
                        Text(pick.symbol)
                            .font(TVTheme.headlineFont)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.bordered)
                    .tint(ZenBuyTheme.sage)
                }
            }
        }
    }
}
