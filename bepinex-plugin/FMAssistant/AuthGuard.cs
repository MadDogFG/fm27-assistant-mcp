using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace FMAssistant;

/// <summary>
/// 本地 HTTP 服务的会话鉴权与生产/开发模式隔离守卫。
/// 每次游戏启动自动生成 256-bit 随机 Bearer Token 并写入当前用户目录，防止任意本机进程裸调敏感接口。
/// </summary>
public static class AuthGuard
{
    private static string _token = string.Empty;
    private static byte[] _tokenBytes = Array.Empty<byte>();
    private static string _tokenFilePath = string.Empty;
    private static string _devFlagFilePath = string.Empty;
    private static bool _devModeEnv;

    public static bool AuthRequired { get; private set; } = true;
    public static bool IsDevMode => _devModeEnv || (!string.IsNullOrEmpty(_devFlagFilePath) && File.Exists(_devFlagFilePath));
    public static string TokenFilePath => _tokenFilePath;

    public static void Initialize(int port)
    {
        var disableAuth = Environment.GetEnvironmentVariable("FM_ASSISTANT_DISABLE_AUTH");
        AuthRequired = !string.Equals(disableAuth, "1", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(disableAuth, "true", StringComparison.OrdinalIgnoreCase);

        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FMAssistant");
        Directory.CreateDirectory(dir);

        var devEnv = Environment.GetEnvironmentVariable("FM_ASSISTANT_DEV_MODE");
        _devFlagFilePath = Path.Combine(dir, "devmode.flag");
        _devModeEnv = string.Equals(devEnv, "1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(devEnv, "true", StringComparison.OrdinalIgnoreCase);

        // 生成 256-bit 加密随机会话密钥
        var raw = RandomNumberGenerator.GetBytes(32);
        var sb = new StringBuilder(64);
        foreach (var b in raw) sb.Append(b.ToString("x2"));
        _token = sb.ToString();
        _tokenBytes = Encoding.UTF8.GetBytes(_token);

        _tokenFilePath = Path.Combine(dir, "session.token");
        var json = LiveTools.JsonText(new
        {
            token = _token,
            pid = Process.GetCurrentProcess().Id,
            port,
            devMode = IsDevMode,
            authRequired = AuthRequired,
            startedAt = DateTime.UtcNow.ToString("O")
        });

        try
        {
            // 先写临时文件再原子覆盖，避免 MCP 客户端读取到半截文件
            var tmpPath = _tokenFilePath + ".tmp";
            File.WriteAllText(tmpPath, json, Encoding.UTF8);
            File.Move(tmpPath, _tokenFilePath, true);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "AuthGuard failed to write session.token: " + ex.Message);
        }

        EventLog.Add("system", $"AuthGuard ready (authRequired={AuthRequired}, devMode={IsDevMode}, tokenFile={_tokenFilePath})");
    }

    public static bool Validate(Dictionary<string, string> headers)
    {
        if (!AuthRequired) return true;
        if (headers == null || _tokenBytes.Length == 0) return false;

        string candidate = null;
        if (headers.TryGetValue("authorization", out var auth) && !string.IsNullOrWhiteSpace(auth))
        {
            const string prefix = "Bearer ";
            if (auth.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                candidate = auth.Substring(prefix.Length).Trim();
            }
        }
        if (string.IsNullOrEmpty(candidate) && headers.TryGetValue("x-fm-assistant-token", out var headerToken))
        {
            candidate = headerToken?.Trim();
        }
        if (string.IsNullOrEmpty(candidate)) return false;

        var candidateBytes = Encoding.UTF8.GetBytes(candidate);
        if (candidateBytes.Length != _tokenBytes.Length) return false;
        return CryptographicOperations.FixedTimeEquals(candidateBytes, _tokenBytes);
    }
}
