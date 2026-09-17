import SwiftUI

struct TVBrowseView: View {
    private enum BrowseFocus: Hashable {
        case intent(SearchInputMode)
        case goal(String)
        case window(String)
        case discover
        case result(String)
    }

    @Bindable var viewModel: SearchViewModel
    @FocusState private var tickerFieldFocused: Bool
    @FocusState private var focus: BrowseFocus?

    private let goalColumns = [
        GridItem(.flexible(), spacing: TVTheme.columnGap),
        GridItem(.flexible(), spacing: TVTheme.columnGap),
        GridItem(.flexible(), spacing: TVTheme.columnGap)
    ]

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

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(TVTheme.captionFont)
                            .foregroundStyle(ZenBuyTheme.bear)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, TVTheme.pagePadding)
                .padding(.vertical, 28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(ZenBuyTheme.background.ignoresSafeArea())
        .onAppear {
            viewModel.onUnlockedPathAppeared()
        }
        .onChange(of: viewModel.wizardStep) { _, step in
            // Selecting a card advances the wizard, which tears the focused
            // card out of the hierarchy. Nothing else on a wizard step is
            // focusable, so focus has to be handed to the next step's lead
            // card by hand or the remote goes dead. Unlocking claims the
            // discover CTA for the same reason — otherwise focus falls to
            // "Change setup" in the summary bar.
            guard viewModel.path.isEmpty else { return }
            // Unlocked in "enter" mode brings its own focusables (ticker field,
            // summary bar); only the find screen owns the discover CTA.
            guard step != .unlocked || viewModel.inputMode == .find else { return }
            focus = wizardLeadFocus
        }
        .onChange(of: discoverSymbols) { _, symbols in
            guard findScreenIsVisible, let first = symbols.first else { return }
            focus = .result(first)
        }
    }

    private var discoverSymbols: [String] {
        viewModel.discoverResults.map(\.symbol)
    }

    /// Lead control of the current step — the focus target after an
    /// auto-advance, and the `.defaultFocus` for a step's first appearance.
    private var wizardLeadFocus: BrowseFocus {
        switch viewModel.wizardStep {
        case .pathIntent:
            return .intent(.find)
        case .investmentGoal:
            return .goal(viewModel.directives.first?.id ?? "")
        case .profitWindow:
            return .window(viewModel.profitHorizonOptions.first?.id ?? "")
        case .unlocked:
            return .discover
        }
    }

    /// Every wizard step is a single choice, so the click that records the
    /// choice is also the click that moves on — there is no Continue button, and
    /// no Back button either. "Change setup" on the unlocked screen reopens the
    /// wizard from the top when a choice needs redoing.
    private func advance(_ choose: () -> Void) {
        choose()
        viewModel.continueWizard()
    }

    /// Only the unlocked Find screen owns `focus`. A discover call can also
    /// finish after the wizard is reopened or a report is pushed, and aiming
    /// `@FocusState` at a view that is not on screen would drop focus instead
    /// of moving it.
    private var findScreenIsVisible: Bool {
        viewModel.path.isEmpty
            && viewModel.wizardStep == .unlocked
            && viewModel.inputMode == .find
    }

    private var header: some View {
        HStack {
            ZenBuyBrandHeader(onDark: true, compact: true)
            Spacer()
            Text("Apple TV")
                .font(TVTheme.eyebrowFont)
                .foregroundStyle(ZenBuyTheme.insightGold)
        }
        .padding(.horizontal, TVTheme.pagePadding)
        .padding(.vertical, 20)
        .background(ZenBuyTheme.forestHeader.ignoresSafeArea(edges: [.top, .horizontal]))
    }

    private var wizardChrome: some View {
        Text(viewModel.wizardStep.progressLabel ?? "Get set")
            .font(TVTheme.eyebrowFont)
            .foregroundStyle(ZenBuyTheme.muted)
    }

    private var summaryBar: some View {
        HStack(spacing: 28) {
            Text(viewModel.wizardSummary)
                .font(TVTheme.cardTitleFont)
                .foregroundStyle(ZenBuyTheme.greenDark)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 16)
            Button("Change setup") {
                viewModel.reopenWizard()
            }
            .buttonStyle(.tvSecondary)
        }
        .padding(TVTheme.cardPadding)
        .background(ZenBuyTheme.greenLight)
        .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous)
                .strokeBorder(ZenBuyTheme.green.opacity(0.4), lineWidth: 2)
        )
        .tvFocusRow()
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
        .tvFocusRow()
        .defaultFocus($focus, wizardLeadFocus)
    }

    private func intentCard(mode: SearchInputMode, title: String, subtitle: String) -> some View {
        let selected = viewModel.pathIntentChosen && viewModel.inputMode == mode
        return Button {
            advance { viewModel.choosePathIntent(mode) }
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(TVTheme.cardTitleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.tvCard(selected: selected, minHeight: TVTheme.intentCardMinHeight))
        .focused($focus, equals: .intent(mode))
    }

    private var goalPicker: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What’s your investment goal?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            LazyVGrid(columns: goalColumns, alignment: .leading, spacing: TVTheme.columnGap) {
                ForEach(viewModel.directives) { directive in
                    let selected = viewModel.selectedDirectiveId == directive.id
                    VStack(alignment: .leading, spacing: 12) {
                        Button {
                            advance { viewModel.selectDirective(directive.id) }
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(directive.label)
                                    .font(TVTheme.cardTitleFont)
                                    .foregroundStyle(ZenBuyTheme.ink)
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.8)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(directive.headline)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.greenDark)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(directive.plainEnglish)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .lineLimit(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .buttonStyle(.tvCard(selected: selected, minHeight: TVTheme.goalCardMinHeight))
                        .focused($focus, equals: .goal(directive.id))

                        Button("About this goal") {
                            viewModel.showDirectiveDetail(directive.id)
                        }
                        .buttonStyle(.tvChip)
                    }
                }
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, wizardLeadFocus)
    }

    private var windowPicker: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What’s your profit window?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            HStack(spacing: TVTheme.columnGap) {
                ForEach(viewModel.profitHorizonOptions) { option in
                    let selected = ProfitHorizonOption.closest(
                        to: viewModel.profitHorizonYears,
                        in: viewModel.profitHorizonOptions
                    )?.id == option.id
                    Button {
                        advance { viewModel.setProfitHorizonYears(option.years) }
                    } label: {
                        Text(option.label)
                            .font(TVTheme.cardTitleFont)
                            .foregroundStyle(ZenBuyTheme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .buttonStyle(.tvCard(selected: selected, minHeight: TVTheme.windowCardMinHeight))
                    .focused($focus, equals: .window(option.id))
                }
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, wizardLeadFocus)
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
            .buttonStyle(.tvPrimary)
            .padding(.top, 8)
            .tvFocusRow()
        }
    }

    private var enterTickers: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Ticker or company name")
                .font(TVTheme.cardTitleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            TextField("AAPL, Apple, Palo Alto…", text: $viewModel.query)
                .font(TVTheme.bodyFont)
                .focused($tickerFieldFocused)
                .frame(maxWidth: TVTheme.fieldMaxWidth)
                .padding(6)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(
                            tickerFieldFocused ? ZenBuyTheme.green : Color.clear,
                            lineWidth: 6
                        )
                )
                .animation(TVTheme.focusAnimation, value: tickerFieldFocused)
                .onChange(of: viewModel.query) { _, _ in
                    viewModel.onQueryChanged()
                }
                .onSubmit {
                    tickerFieldFocused = false
                }

            Text("Select 1–4 tickers. Reports stream from zenbuy.info.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)

            if viewModel.isSearching {
                ProgressView()
                    .tint(ZenBuyTheme.green)
            }

            if !viewModel.suggestions.isEmpty {
                VStack(spacing: 16) {
                    ForEach(viewModel.suggestions) { result in
                        Button {
                            viewModel.addPick(result)
                            tickerFieldFocused = false
                        } label: {
                            HStack(spacing: 20) {
                                Text(result.symbol)
                                    .font(TVTheme.cardTitleFont)
                                    .foregroundStyle(ZenBuyTheme.ink)
                                Text(result.name)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                        }
                        .buttonStyle(.tvCard())
                    }
                }
                .frame(maxWidth: TVTheme.readingMaxWidth, alignment: .leading)
            }
        }
        .tvFocusRow()
    }

    private var findTickers: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("We’ll suggest up to 4 names that match your goal.")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)

            // Stays enabled while the call is in flight: a disabled button is
            // not focusable, which left "Change setup" as the only control on
            // the screen for the whole discover round trip.
            Button {
                guard !viewModel.isDiscovering else { return }
                viewModel.runDiscover()
            } label: {
                HStack(spacing: 16) {
                    if viewModel.isDiscovering {
                        ProgressView()
                    }
                    Text(viewModel.isDiscovering ? "Finding matches…" : "Find stocks for my goal")
                }
            }
            .buttonStyle(.tvPrimary)
            .focused($focus, equals: .discover)

            if !viewModel.discoverResults.isEmpty {
                Text("Click a name to add or remove it, then generate.")
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)

                VStack(spacing: 16) {
                    ForEach(viewModel.discoverResults) { pick in
                        let selected = viewModel.picks.contains { $0.symbol == pick.symbol }
                        Button {
                            viewModel.toggleDiscoverPick(pick)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 20) {
                                    Text(pick.symbol)
                                        .font(TVTheme.cardTitleFont)
                                        .foregroundStyle(ZenBuyTheme.ink)
                                    Text(pick.name)
                                        .font(TVTheme.captionFont)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                    Text("\(pick.fitScore)% fit")
                                        .font(TVTheme.captionFont.weight(.semibold))
                                        .foregroundStyle(ZenBuyTheme.greenDark)
                                }
                                Text(pick.reason)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .buttonStyle(.tvCard(selected: selected))
                        .focused($focus, equals: .result(pick.symbol))
                    }
                }
                .frame(maxWidth: TVTheme.readingMaxWidth, alignment: .leading)
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, .discover)
    }

    private var picksRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Selected · click a symbol to remove it")
                .font(TVTheme.eyebrowFont)
                .foregroundStyle(ZenBuyTheme.muted)
            HStack(spacing: 20) {
                ForEach(viewModel.picks) { pick in
                    Button {
                        viewModel.removePick(pick)
                    } label: {
                        HStack(spacing: 12) {
                            Text(pick.symbol)
                            Image(systemName: "xmark")
                                .font(.system(size: 22, weight: .bold))
                        }
                    }
                    .buttonStyle(.tvChip)
                    .accessibilityLabel("Remove \(pick.symbol)")
                }
            }
        }
        .tvFocusRow()
    }
}
