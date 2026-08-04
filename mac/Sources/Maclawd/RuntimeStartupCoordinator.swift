import Foundation

struct RuntimeEndpoint: Equatable {
    let port: Int
    let pid: Int32
    let protocolVersion: Int?
    let buildId: String?
    let instanceId: String?
    let managementToken: String?

    init(
        port: Int,
        pid: Int32,
        protocolVersion: Int? = nil,
        buildId: String? = nil,
        instanceId: String? = nil,
        managementToken: String? = nil
    ) {
        self.port = port
        self.pid = pid
        self.protocolVersion = protocolVersion
        self.buildId = buildId
        self.instanceId = instanceId
        self.managementToken = managementToken
    }
}

struct RuntimePing: Equatable {
    let pid: Int32
    let port: Int
    let protocolVersion: Int?
    let buildId: String?
    let instanceId: String?

    init(
        pid: Int32,
        port: Int,
        protocolVersion: Int? = nil,
        buildId: String? = nil,
        instanceId: String? = nil
    ) {
        self.pid = pid
        self.port = port
        self.protocolVersion = protocolVersion
        self.buildId = buildId
        self.instanceId = instanceId
    }
}

struct RuntimeProcessIdentity: Equatable {
    let pid: Int32
    let executablePath: String
    let arguments: [String]
}

enum RuntimeStartupDecision: Equatable {
    case launch
    case reuse(port: Int)
    case replaceManaged(port: Int, pid: Int32, instanceId: String, managementToken: String)
    case replaceLegacy(port: Int, pid: Int32)
    case untrusted(reason: String)
}

enum RuntimeStartupCoordinator {
    static func decide(
        endpoint: RuntimeEndpoint?,
        ping: RuntimePing?,
        expectedProtocolVersion: Int,
        expectedBuildId: String,
        endpointProcessAlive: Bool? = nil,
        legacyProcess: RuntimeProcessIdentity? = nil,
        expectedNodePath: String? = nil,
        expectedScriptPath: String? = nil,
        expectedPreferredPort: Int? = nil
    ) -> RuntimeStartupDecision {
        guard let endpoint else { return .launch }
        guard let ping else {
            if endpointProcessAlive == false { return .launch }
            return .untrusted(reason: "端点进程仍存在，但身份探针无响应")
        }
        guard endpoint.port == ping.port, endpoint.pid == ping.pid else {
            return .untrusted(reason: "端点文件与运行中进程不一致")
        }
        let hasModernIdentity = endpoint.protocolVersion != nil
            || endpoint.buildId != nil
            || endpoint.instanceId != nil
            || endpoint.managementToken != nil
            || ping.protocolVersion != nil
            || ping.buildId != nil
            || ping.instanceId != nil

        guard hasModernIdentity else {
            guard let legacyProcess,
                  legacyProcess.pid == endpoint.pid,
                  let expectedNodePath,
                  let expectedScriptPath,
                  samePath(legacyProcess.executablePath, expectedNodePath),
                  legacyArgumentsMatch(
                    legacyProcess.arguments,
                    nodePath: expectedNodePath,
                    scriptPath: expectedScriptPath,
                    preferredPort: expectedPreferredPort ?? endpoint.port
                  )
            else {
                return .untrusted(reason: "legacy 运行时的可执行路径或参数无法验证")
            }
            return .replaceLegacy(port: endpoint.port, pid: endpoint.pid)
        }

        guard let endpointInstance = endpoint.instanceId,
              let pingInstance = ping.instanceId,
              endpointInstance == pingInstance,
              let token = endpoint.managementToken,
              !token.isEmpty,
              let endpointProtocol = endpoint.protocolVersion,
              let pingProtocol = ping.protocolVersion,
              endpointProtocol == pingProtocol,
              let endpointBuild = endpoint.buildId,
              let pingBuild = ping.buildId,
              endpointBuild == pingBuild
        else {
            return .untrusted(reason: "运行时缺少可验证的实例身份")
        }

        if pingProtocol == expectedProtocolVersion, pingBuild == expectedBuildId {
            return .reuse(port: endpoint.port)
        }
        return .replaceManaged(
            port: endpoint.port,
            pid: endpoint.pid,
            instanceId: endpointInstance,
            managementToken: token
        )
    }

    private static func samePath(_ lhs: String, _ rhs: String) -> Bool {
        let left = URL(fileURLWithPath: lhs).standardizedFileURL.resolvingSymlinksInPath().path
        let right = URL(fileURLWithPath: rhs).standardizedFileURL.resolvingSymlinksInPath().path
        return left == right
    }

    private static func legacyArgumentsMatch(
        _ arguments: [String],
        nodePath: String,
        scriptPath: String,
        preferredPort: Int
    ) -> Bool {
        guard arguments.count == 3 || arguments.count == 4,
              samePath(arguments[0], nodePath),
              samePath(arguments[1], scriptPath),
              arguments[2] == "serve"
        else { return false }
        if arguments.count == 4 {
            return Int(arguments[3]) == preferredPort
        }
        return true
    }
}
