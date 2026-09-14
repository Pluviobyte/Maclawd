import Foundation
import CoreGraphics

/// A saved display ID can survive a resolution change. Validate the old frame
/// against today's visible area before restoring it, while allowing edge overlap.
enum PetWindowPosition {
    static func canRestore(_ frame: CGRect, in visibleFrame: CGRect) -> Bool {
        visibleFrame.intersects(frame)
    }
}
