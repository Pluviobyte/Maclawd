import AppKit
import Foundation

struct CodexPetManifest: Codable, Equatable {
    let id: String
    let displayName: String
    let description: String
    let spriteVersionNumber: Int
    let spritesheetPath: String
}

enum CodexPetInstallationState: Equatable {
    case ready
    case installed
    case updateAvailable
    case blocked(String)
}

enum CodexPetInstallerError: LocalizedError {
    case invalidPackage(String)
    case replacementRequired
    case unsafeDestination
    case installFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidPackage(let reason): return "内置 Codex Pet 包无效：\(reason)"
        case .replacementRequired: return "Codex 中已有不同版本的 Maclawd。"
        case .unsafeDestination: return "目标位置不是可识别的 Maclawd 宠物包，已停止覆盖。"
        case .installFailed(let reason): return "安装失败：\(reason)"
        }
    }
}

/**
 把随应用发布的、已经过 QA 的宠物包安装到 Codex 的本机 pets 目录。

 按钮只有一个可信来源，所以攻击面也只保留「校验内置资产 → 原子替换目标」
 这一条。目标已存在时，只有它本身也是 id 为 maclawd 的 pet.json 才允许覆盖，
 避免误删用户碰巧创建的同名目录。
 */
struct CodexPetInstaller {
    static let petID = "maclawd"
    static let atlasSize = CGSize(width: 1536, height: 2288)

    private let fileManager: FileManager
    private let homeDirectory: URL
    private let imageSize: (URL) -> CGSize?

    init(
        fileManager: FileManager = .default,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        imageSize: @escaping (URL) -> CGSize? = CodexPetInstaller.readImageSize
    ) {
        self.fileManager = fileManager
        self.homeDirectory = homeDirectory
        self.imageSize = imageSize
    }

    static func bundledPackage(in repoRoot: URL) -> URL {
        repoRoot.appendingPathComponent("assets/codex-pet/maclawd", isDirectory: true)
    }

    var destination: URL {
        homeDirectory.appendingPathComponent(".codex/pets/\(Self.petID)", isDirectory: true)
    }

    func state(packageAt source: URL) -> CodexPetInstallationState {
        do {
            _ = try validate(packageAt: source)
            guard fileManager.fileExists(atPath: destination.path) else { return .ready }
            guard (try? installedManifest())?.id == Self.petID else {
                return .blocked("~/.codex/pets/maclawd 已存在，但不是 Maclawd 宠物包。")
            }
            return packagesMatch(source, destination) ? .installed : .updateAvailable
        } catch {
            return .blocked(error.localizedDescription)
        }
    }

    @discardableResult
    func install(packageAt source: URL, replacing: Bool = false) throws -> URL {
        _ = try validate(packageAt: source)
        let petsRoot = destination.deletingLastPathComponent()
        do {
            try fileManager.createDirectory(at: petsRoot, withIntermediateDirectories: true)
        } catch {
            throw CodexPetInstallerError.installFailed(error.localizedDescription)
        }

        if fileManager.fileExists(atPath: destination.path) {
            guard (try? installedManifest())?.id == Self.petID else {
                throw CodexPetInstallerError.unsafeDestination
            }
            if packagesMatch(source, destination) { return destination }
            guard replacing else { throw CodexPetInstallerError.replacementRequired }
        }

        let nonce = UUID().uuidString
        let stage = petsRoot.appendingPathComponent(".\(Self.petID).install-\(nonce)", isDirectory: true)
        let backup = petsRoot.appendingPathComponent(".\(Self.petID).backup-\(nonce)", isDirectory: true)
        defer {
            try? fileManager.removeItem(at: stage)
        }

        do {
            try fileManager.copyItem(at: source, to: stage)
            _ = try validate(packageAt: stage)
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.moveItem(at: destination, to: backup)
            }
            do {
                try fileManager.moveItem(at: stage, to: destination)
                try? fileManager.removeItem(at: backup)
            } catch {
                if fileManager.fileExists(atPath: backup.path) {
                    try? fileManager.moveItem(at: backup, to: destination)
                }
                throw error
            }
        } catch let error as CodexPetInstallerError {
            throw error
        } catch {
            throw CodexPetInstallerError.installFailed(error.localizedDescription)
        }
        return destination
    }

    func validate(packageAt directory: URL) throws -> CodexPetManifest {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: directory.path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else { throw CodexPetInstallerError.invalidPackage("缺少包目录") }

        let manifestURL = directory.appendingPathComponent("pet.json")
        let manifest: CodexPetManifest
        do {
            manifest = try JSONDecoder().decode(CodexPetManifest.self, from: Data(contentsOf: manifestURL))
        } catch {
            throw CodexPetInstallerError.invalidPackage("pet.json 无法解析")
        }
        guard manifest.id == Self.petID else {
            throw CodexPetInstallerError.invalidPackage("id 必须为 \(Self.petID)")
        }
        guard manifest.spriteVersionNumber == 2 else {
            throw CodexPetInstallerError.invalidPackage("需要 spriteVersionNumber 2")
        }
        guard !manifest.spritesheetPath.isEmpty,
              !manifest.spritesheetPath.contains("/"),
              !manifest.spritesheetPath.contains("\\"),
              manifest.spritesheetPath != ".",
              manifest.spritesheetPath != ".."
        else { throw CodexPetInstallerError.invalidPackage("spritesheetPath 必须是包内文件名") }

        let atlas = directory.appendingPathComponent(manifest.spritesheetPath)
        guard fileManager.fileExists(atPath: atlas.path) else {
            throw CodexPetInstallerError.invalidPackage("缺少 \(manifest.spritesheetPath)")
        }
        guard imageSize(atlas) == Self.atlasSize else {
            throw CodexPetInstallerError.invalidPackage("v2 图集必须为 1536×2288")
        }
        return manifest
    }

    private func installedManifest() throws -> CodexPetManifest {
        try JSONDecoder().decode(
            CodexPetManifest.self,
            from: Data(contentsOf: destination.appendingPathComponent("pet.json"))
        )
    }

    private func packagesMatch(_ lhs: URL, _ rhs: URL) -> Bool {
        guard let manifest = try? JSONDecoder().decode(
            CodexPetManifest.self,
            from: Data(contentsOf: lhs.appendingPathComponent("pet.json"))
        ) else { return false }
        let names = ["pet.json", manifest.spritesheetPath]
        return names.allSatisfy { name in
            let a = try? Data(contentsOf: lhs.appendingPathComponent(name), options: .mappedIfSafe)
            let b = try? Data(contentsOf: rhs.appendingPathComponent(name), options: .mappedIfSafe)
            return a != nil && a == b
        }
    }

    private static func readImageSize(_ url: URL) -> CGSize? {
        guard let image = NSImage(contentsOf: url),
              let representation = image.representations.first
        else { return nil }
        return CGSize(width: representation.pixelsWide, height: representation.pixelsHigh)
    }
}
