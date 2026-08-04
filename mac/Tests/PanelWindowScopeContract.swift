import AppKit

@main
struct PanelWindowScopeContract {
    static func main() {
        let panel = NSWindow()
        let attachedChild = NSWindow()
        let customDateSheet = NSWindow()
        let unrelated = NSWindow()

        panel.addChildWindow(attachedChild, ordered: .above)
        panel.beginSheet(customDateSheet)

        precondition(PanelWindowScope.contains(clicked: panel, root: panel),
                     "the popover window must count as inside")
        precondition(PanelWindowScope.contains(clicked: attachedChild, root: panel),
                     "an attached child window must count as inside")
        precondition(PanelWindowScope.contains(clicked: customDateSheet, root: panel),
                     "clicking Cancel or Apply in an attached sheet must not close the popover")
        precondition(!PanelWindowScope.contains(clicked: unrelated, root: panel),
                     "an unrelated window must still count as outside")
    }
}
