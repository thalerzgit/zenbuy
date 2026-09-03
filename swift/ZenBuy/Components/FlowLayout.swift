import SwiftUI

/// Pure wrap/report sizing for FlowLayout — unit-tested without hosting views.
enum FlowLayoutSizing {
    /// Finite width used while placing chips. Nil / non-finite / ≤0 must not
    /// collapse the parent (ScrollView proposes nil → infinity → ~1pt strip).
    static func wrapWidth(proposalWidth: CGFloat?) -> CGFloat {
        guard let width = proposalWidth, width.isFinite, width > 0 else {
            return 10_000
        }
        return width
    }

    /// Width reported to parents. Prefer the finite proposal; otherwise the
    /// actual used content width (never `.infinity`).
    static func reportedWidth(proposalWidth: CGFloat?, usedWidth: CGFloat) -> CGFloat {
        if let width = proposalWidth, width.isFinite, width > 0 {
            return width
        }
        return max(0, usedWidth)
    }

    static func reportedHeight(usedHeight: CGFloat) -> CGFloat {
        max(0, usedHeight)
    }
}

/// Horizontal wrapping layout for chips and pills.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let wrapWidth = FlowLayoutSizing.wrapWidth(proposalWidth: proposal.width)
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var frames: [CGRect] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > wrapWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        let usedWidth = frames.map(\.maxX).max() ?? 0
        let usedHeight = frames.isEmpty ? 0 : y + rowHeight
        return (
            CGSize(
                width: FlowLayoutSizing.reportedWidth(proposalWidth: proposal.width, usedWidth: usedWidth),
                height: FlowLayoutSizing.reportedHeight(usedHeight: usedHeight)
            ),
            frames
        )
    }
}
