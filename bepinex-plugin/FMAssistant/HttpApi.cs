using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace FMAssistant;

/// <summary>本地回环 HTTP 网关核心：负责监听、请求解析、Bearer Token 鉴权与按领域路由分发。</summary>
public static partial class HttpApi
{
    public const int DefaultPort = 27190;

    public static volatile bool LoggingEnabled = true;
    public static volatile bool LogAllUiEvents;

    private static TcpListener _listener;
    private static int Port = DefaultPort;

    public static void Start()
    {
        var configured = Environment.GetEnvironmentVariable("FM_ASSISTANT_PORT");
        if (int.TryParse(configured, out var parsed) && parsed > 0 && parsed < 65536)
        {
            Port = parsed;
        }
        try
        {
            AuthGuard.Initialize(Port);
            _listener = new TcpListener(IPAddress.Loopback, Port);
            _listener.Start();
            var thread = new Thread(AcceptLoop)
            {
                IsBackground = true,
                Name = "FMAssistant-Http",
            };
            thread.Start();
            EventLog.Add("system", $"HTTP listening on http://127.0.0.1:{Port}/ (auth={AuthGuard.AuthRequired}, devMode={AuthGuard.IsDevMode})");
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "HTTP start failed: " + ex);
        }
    }

    private static void AcceptLoop()
    {
        while (true)
        {
            try
            {
                var client = _listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "accept failed: " + ex.Message);
                Thread.Sleep(200);
            }
        }
    }

    private static void HandleClient(TcpClient client)
    {
        try
        {
            using (client)
            {
                client.ReceiveTimeout = 5000;
                using var stream = client.GetStream();
                var (method, path, query, headers, body) = ReadRequest(stream);
                Diagnostics.Log("http " + method + " " + path);
                var (status, json) = Dispatch(method, path, query, headers, body);
                Diagnostics.Log("http_done " + method + " " + path + " " + status);
                WriteResponse(stream, status, json);
            }
        }
        catch (Exception ex)
        {
            Diagnostics.Log("http_error " + ex.GetType().Name + " " + ex.Message);
            EventLog.Add("error", "http handler: " + ex.Message);
        }
    }

    private static (string Method, string Path, Dictionary<string, string> Query, Dictionary<string, string> Headers, string Body) ReadRequest(Stream stream)
    {
        var buffer = new List<byte>(8192);
        var chunk = new byte[4096];
        var headerEnd = -1;
        while (headerEnd < 0)
        {
            var read = stream.Read(chunk, 0, chunk.Length);
            if (read <= 0) break;
            for (var i = 0; i < read; i++) buffer.Add(chunk[i]);
            var text = Encoding.UTF8.GetString(buffer.ToArray());
            headerEnd = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        }

        var all = Encoding.UTF8.GetString(buffer.ToArray());
        var split = all.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        var headerText = split >= 0 ? all.Substring(0, split) : all;
        var lines = headerText.Split("\r\n");
        var requestLine = lines.Length > 0 ? lines[0] : string.Empty;
        var parts = requestLine.Split(' ');
        var method = parts.Length > 0 ? parts[0].ToUpperInvariant() : "GET";
        var rawPath = parts.Length > 1 ? parts[1] : "/";
        var queryIndex = rawPath.IndexOf('?', StringComparison.Ordinal);
        var path = queryIndex >= 0 ? rawPath.Substring(0, queryIndex) : rawPath;
        var query = queryIndex >= 0 ? ParseQuery(rawPath.Substring(queryIndex + 1)) : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var contentLength = 0;
        for (var i = 1; i < lines.Length; i++)
        {
            var colon = lines[i].IndexOf(':');
            if (colon <= 0) continue;
            var hName = lines[i].Substring(0, colon).Trim();
            var hVal = lines[i].Substring(colon + 1).Trim();
            headers[hName] = hVal;
            if (hName.Equals("content-length", StringComparison.OrdinalIgnoreCase))
            {
                int.TryParse(hVal, out contentLength);
            }
        }

        var body = string.Empty;
        if (contentLength > 0)
        {
            var already = split >= 0 ? Encoding.UTF8.GetByteCount(all.Substring(split + 4)) : 0;
            var bodyBuffer = new byte[contentLength];
            var offset = 0;
            if (already > 0)
            {
                var existing = Encoding.UTF8.GetBytes(all.Substring(split + 4));
                offset = Math.Min(existing.Length, contentLength);
                Array.Copy(existing, bodyBuffer, offset);
            }
            while (offset < contentLength)
            {
                var read = stream.Read(bodyBuffer, offset, contentLength - offset);
                if (read <= 0) break;
                offset += read;
            }
            body = Encoding.UTF8.GetString(bodyBuffer, 0, offset);
        }

        return (method, path, query, headers, body);
    }

    private static Dictionary<string, string> ParseQuery(string raw)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in raw.Split('&'))
        {
            if (pair.Length == 0) continue;
            var index = pair.IndexOf('=', StringComparison.Ordinal);
            if (index < 0)
                result[WebUtility.UrlDecode(pair)] = string.Empty;
            else
                result[WebUtility.UrlDecode(pair.Substring(0, index))] = WebUtility.UrlDecode(pair.Substring(index + 1));
        }
        return result;
    }

    private static (int Status, string Json) Dispatch(
        string method,
        string path,
        Dictionary<string, string> query,
        Dictionary<string, string> headers,
        string body)
    {
        // GET /health 始终免鉴权放行（不返回任何存档数据或密钥）
        if (path.Equals("/health", StringComparison.OrdinalIgnoreCase))
        {
            return method == "GET" ? (200, Health()) : (405, Error("Use GET"));
        }

        // 其他全部接口强制执行本机会话 Bearer Token 校验
        if (!AuthGuard.Validate(headers))
        {
            return (401, Error("Unauthorized: missing or invalid local session token."));
        }

        var requestOperationId = query.TryGetValue("id", out var operationId) ? operationId : null;
        (int Status, string Json) RunPlayerCommand(Func<object> action) => LiveTools.RunCommand(() =>
        {
            SubstitutionCommands.ValidateChildCall(requestOperationId, path, query);
            return action();
        }, requestOperationId, path);

        try
        {
            if (TryDispatchTactics(method, path, query, body, RunPlayerCommand, out var tacticsRes)) return tacticsRes;
            if (TryDispatchSquadAndTraining(method, path, query, body, RunPlayerCommand, out var squadRes)) return squadRes;
            if (TryDispatchTransfersAndClub(method, path, query, body, RunPlayerCommand, out var transferRes)) return transferRes;
            if (TryDispatchMatchAndManager(method, path, query, body, RunPlayerCommand, out var matchRes)) return matchRes;
            return DispatchDiagnostics(method, path, query, body);
        }
        catch (UnauthorizedAccessException ex)
        {
            EventLog.Add("security", "blocked " + path + ": " + ex.Message);
            return (403, Error(ex.Message));
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dispatch " + path + ": " + ex);
            return (500, Error(ex.Message));
        }
    }

    private static long ParseLong(Dictionary<string, string> query, string key, long fallback) =>
        query != null && query.TryGetValue(key, out var text) && long.TryParse(text, out var value) ? value : fallback;

    private static float ParseFloat(Dictionary<string, string> query, string key, float fallback) =>
        query != null && query.TryGetValue(key, out var text) && float.TryParse(text, out var value) ? value : fallback;

    private static int ParseInt(Dictionary<string, string> query, string key, int fallback) =>
        query != null && query.TryGetValue(key, out var text) && int.TryParse(text, out var value) ? value : fallback;

    private static string Health()
    {
        var sb = new StringBuilder();
        sb.Append('{');
        sb.Append("\"ok\":true,");
        sb.Append("\"plugin\":\"FMAssistant\",");
        sb.Append("\"version\":\"" + Js(Plugin.Version) + "\",");
        sb.Append("\"loadedAssemblyId\":\"").Append(typeof(Plugin).Module.ModuleVersionId.ToString("D")).Append("\",");
        sb.Append("\"patchesApplied\":").Append(Patches.Applied ? "true" : "false").Append(',');
        sb.Append("\"authRequired\":").Append(AuthGuard.AuthRequired ? "true" : "false").Append(',');
        sb.Append("\"devMode\":").Append(AuthGuard.IsDevMode ? "true" : "false").Append(',');
        sb.Append("\"interopInstance\":\"" + Js(Shared.PointerOf(Shared.InteropSubsystem)) + "\",");
        sb.Append("\"gamePluginInstance\":\"" + Js(Shared.PointerOf(Shared.GamePlugin)) + "\",");
        sb.Append("\"dispatcherInstance\":\"" + Js(Shared.PointerOf(Shared.Dispatcher)) + "\",");
        sb.Append("\"logCount\":").Append(EventLog.Count).Append(',');
        sb.Append("\"pendingActions\":").Append(MainThread.Pending).Append(',');
        sb.Append("\"mainThread\":").Append(LiveTools.JsonText(MainThreadDriver.ReadHeartbeat())).Append(',');
        sb.Append("\"loggingEnabled\":").Append(LoggingEnabled ? "true" : "false").Append(',');
        sb.Append("\"logAllUiEvents\":").Append(LogAllUiEvents ? "true" : "false");
        sb.Append('}');
        return sb.ToString();
    }

    private static string StatusReason(int status) => status switch
    {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        410 => "Gone",
        _ => "Internal Server Error"
    };

    private static void WriteResponse(Stream stream, int status, string json)
    {
        var body = Encoding.UTF8.GetBytes(json);
        var header = Encoding.UTF8.GetBytes(
            "HTTP/1.1 " + status + " " + StatusReason(status) + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            "Connection: close\r\n\r\n");
        stream.Write(header, 0, header.Length);
        stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static string Error(string message) => "{\"ok\":false,\"error\":\"" + Js(message) + "\"}";

    private static string Js(string value)
    {
        if (value == null) return string.Empty;
        var sb = new StringBuilder(value.Length + 8);
        foreach (var c in value)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
