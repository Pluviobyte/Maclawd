import Foundation

@main
struct CodexPetInstallerContract {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("maclawd-pet-test-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        let source = root.appendingPathComponent("source/maclawd")
        let home = root.appendingPathComponent("home")
        try fm.createDirectory(at: source, withIntermediateDirectories: true)
        try writePackage(source, sheet: "first")

        let installer = CodexPetInstaller(homeDirectory: home) { _ in
            CodexPetInstaller.atlasSize
        }
        precondition(installer.state(packageAt: source) == .ready)
        let installed = try installer.install(packageAt: source)
        precondition(installed == home.appendingPathComponent(".codex/pets/maclawd"))
        precondition(installer.state(packageAt: source) == .installed)

        try Data("second".utf8).write(to: source.appendingPathComponent("spritesheet.webp"))
        precondition(installer.state(packageAt: source) == .updateAvailable)
        do {
            _ = try installer.install(packageAt: source)
            preconditionFailure("a changed package must require replacement confirmation")
        } catch CodexPetInstallerError.replacementRequired {
            // Expected.
        }
        _ = try installer.install(packageAt: source, replacing: true)
        precondition(installer.state(packageAt: source) == .installed)

        let blockedHome = root.appendingPathComponent("blocked-home")
        let blocked = blockedHome.appendingPathComponent(".codex/pets/maclawd")
        try fm.createDirectory(at: blocked, withIntermediateDirectories: true)
        try Data("mine".utf8).write(to: blocked.appendingPathComponent("notes.txt"))
        let cautious = CodexPetInstaller(homeDirectory: blockedHome) { _ in
            CodexPetInstaller.atlasSize
        }
        if case .blocked = cautious.state(packageAt: source) {} else {
            preconditionFailure("an unrelated destination must be blocked")
        }
        do {
            _ = try cautious.install(packageAt: source, replacing: true)
            preconditionFailure("an unrelated destination must never be replaced")
        } catch CodexPetInstallerError.unsafeDestination {
            // Expected.
        }

        let unsafe = root.appendingPathComponent("unsafe")
        try fm.createDirectory(at: unsafe, withIntermediateDirectories: true)
        let manifest = CodexPetManifest(
            id: "maclawd", displayName: "Maclawd", description: "test",
            spriteVersionNumber: 2, spritesheetPath: "../outside.webp"
        )
        try JSONEncoder().encode(manifest).write(to: unsafe.appendingPathComponent("pet.json"))
        do {
            _ = try installer.validate(packageAt: unsafe)
            preconditionFailure("spritesheet traversal must fail validation")
        } catch CodexPetInstallerError.invalidPackage {
            // Expected.
        }

        if CommandLine.arguments.count == 2 {
            let bundled = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let actual = try installer.validate(packageAt: bundled)
            precondition(actual.id == CodexPetInstaller.petID)
            precondition(actual.spriteVersionNumber == 2)
        }
    }

    private static func writePackage(_ directory: URL, sheet: String) throws {
        let manifest = CodexPetManifest(
            id: "maclawd", displayName: "Maclawd", description: "test",
            spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp"
        )
        try JSONEncoder().encode(manifest).write(to: directory.appendingPathComponent("pet.json"))
        try Data(sheet.utf8).write(to: directory.appendingPathComponent("spritesheet.webp"))
    }
}
