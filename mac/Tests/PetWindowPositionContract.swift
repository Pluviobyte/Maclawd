import Foundation

@main
struct PetWindowPositionContract {
    static func main() {
        let laptop = CGRect(x: 0, y: 0, width: 1512, height: 982)
        // Actual failure: the display ID survived a change from 1920 to 1512.
        precondition(!PetWindowPosition.canRestore(CGRect(x: 1725, y: 328, width: 135, height: 135), in: laptop))
        precondition(PetWindowPosition.canRestore(CGRect(x: 1200, y: 328, width: 135, height: 135), in: laptop))
        precondition(PetWindowPosition.canRestore(CGRect(x: 1480, y: 328, width: 135, height: 135), in: laptop))
        let secondary = CGRect(x: -1920, y: 0, width: 1920, height: 1080)
        precondition(PetWindowPosition.canRestore(CGRect(x: -1800, y: 328, width: 135, height: 135), in: secondary))
        precondition(!PetWindowPosition.canRestore(CGRect(x: 200, y: 1200, width: 135, height: 135), in: laptop))
        print("Pet window position contract passed")
    }
}
