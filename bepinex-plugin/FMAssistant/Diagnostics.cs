using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading;

namespace FMAssistant;

// Keep recent HTTP and live-layer steps on disk without making a game frame wait for file I/O.
public static class Diagnostics
{
    private static readonly BlockingCollection<string> PendingLines = new(2048);
    private static readonly string Directory = Path.Combine(Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? ".", "state");
    private static readonly string FilePath = Path.Combine(Directory, "live.log");

    static Diagnostics()
    {
        new Thread(WriteLog) { IsBackground = true, Name = "FMAssistant-Diagnostics" }.Start();
    }

    public static void Log(string message)
    {
        try
        {
            EventLog.Add("live", message);
            PendingLines.TryAdd(DateTime.Now.ToString("MM-dd HH:mm:ss.fff") + " " + message);
        }
        catch
        {
            // diagnostics must never break the caller
        }
    }

    private const long MaxLogBytes = 5 * 1024 * 1024; // 单文件上限 5MB，防止长期挂机撑爆磁盘

    private static void WriteLog()
    {
        foreach (var line in PendingLines.GetConsumingEnumerable())
        {
            try
            {
                System.IO.Directory.CreateDirectory(Directory);
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > MaxLogBytes)
                {
                    var backup = FilePath + ".old";
                    if (File.Exists(backup)) File.Delete(backup);
                    File.Move(FilePath, backup);
                }
                File.AppendAllText(FilePath, line + Environment.NewLine);
            }
            catch
            {
                // The bounded in-memory log remains available after a disk failure.
            }
        }
    }
}
