import SwiftUI
import UIKit

/// UIKit source of truth for the TV report-email field.
///
/// SwiftUI `TextField` on tvOS can paint typed text while the bound `String`
/// is still empty — that was the Dist false-reject. This store is written on
/// every `.editingChanged` and flushed on `textFieldDidEndEditing`, so Send
/// reads what the keyboard actually committed, not a late SwiftUI binding.
@MainActor
final class TVEmailFieldStore {
    var currentText = ""
    weak var textField: UITextField?

    func captureLiveText() -> String {
        if let live = textField?.text {
            currentText = live
        }
        return currentText
    }

    func resignFirstResponder() {
        textField?.resignFirstResponder()
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
        _ = captureLiveText()
    }
}

/// tvOS `UITextField` that keeps `store.currentText` in lockstep with the
/// keyboard. Display `text` is only pushed while the field is not editing.
///
/// `textContentType` stays unset on purpose. `.emailAddress` is what summons
/// the system “Previously-Used Emails” sheet; pairing that sheet with
/// `becomeFirstResponder` on SwiftUI focus restore is the Email PDF loop.
struct TVEmailTextField: UIViewRepresentable {
    @Binding var text: String
    let store: TVEmailFieldStore
    var onEditingEnded: () -> Void = {}

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, store: store, onEditingEnded: onEditingEnded)
    }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.keyboardType = .emailAddress
        field.textContentType = nil
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.returnKeyType = .done
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.font = UIFont.systemFont(ofSize: 32)
        field.textColor = ZenBuyTheme.UIKitPalette.ink
        field.attributedPlaceholder = NSAttributedString(
            string: "you@example.com",
            attributes: [.foregroundColor: ZenBuyTheme.UIKitPalette.muted]
        )
        field.delegate = context.coordinator
        field.addTarget(
            context.coordinator,
            action: #selector(Coordinator.editingChanged(_:)),
            for: .editingChanged
        )
        field.text = text
        store.currentText = text
        store.textField = field
        context.coordinator.store = store
        context.coordinator.onEditingEnded = onEditingEnded
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.text = $text
        context.coordinator.store = store
        context.coordinator.onEditingEnded = onEditingEnded
        store.textField = field
        if !field.isFirstResponder, field.text != text {
            field.text = text
            store.currentText = text
        }
    }

    @MainActor
    final class Coordinator: NSObject, UITextFieldDelegate {
        var text: Binding<String>
        var store: TVEmailFieldStore
        var onEditingEnded: () -> Void

        init(text: Binding<String>, store: TVEmailFieldStore, onEditingEnded: @escaping () -> Void) {
            self.text = text
            self.store = store
            self.onEditingEnded = onEditingEnded
        }

        @objc func editingChanged(_ field: UITextField) {
            flush(field)
        }

        func textFieldDidEndEditing(_ field: UITextField) {
            flush(field)
            onEditingEnded()
        }

        func textFieldShouldReturn(_ field: UITextField) -> Bool {
            flush(field)
            field.resignFirstResponder()
            return true
        }

        private func flush(_ field: UITextField) {
            let live = field.text ?? ""
            store.currentText = live
            text.wrappedValue = live
        }
    }
}
