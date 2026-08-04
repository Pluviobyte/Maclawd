import AppKit

enum PanelWindowScope {
    static func contains(clicked: NSWindow?, root: NSWindow?) -> Bool {
        guard let root else { return false }

        var candidate = clicked
        var visited = Set<ObjectIdentifier>()
        while let window = candidate, visited.insert(ObjectIdentifier(window)).inserted {
            if window === root { return true }
            // SwiftUI `.sheet` uses AppKit's sheet relationship; other hosted
            // controls can create ordinary child windows. Both belong to the
            // popover for the purpose of outside-click dismissal.
            candidate = window.sheetParent ?? window.parent
        }
        return false
    }
}
