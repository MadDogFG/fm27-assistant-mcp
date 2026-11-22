using System;

namespace FMAssistant;

// Pure state machine, also compiled by the offline protocol checks (no game assemblies required).
public sealed class CommandState
{
    public string Status { get; private set; } = "prepared";
    public string Before { get; }
    public string Desired { get; }
    public string After { get; private set; }
    public string Error { get; private set; }
    public long InitialRevision { get; }
    public int Epoch { get; }
    public DateTime Started { get; }
    public bool Pending => Status == "pending";
    public bool Verified => Status == "verified" || Status == "no_change";

    public CommandState(string before, string desired, long revision, int epoch, DateTime started)
    { Before = before; Desired = desired; InitialRevision = revision; Epoch = epoch; Started = started; }

    public void Dispatching()
    {
        if (Status != "prepared") throw new InvalidOperationException("Command cannot be dispatched twice.");
        Status = Before == Desired ? "no_change" : "pending";
        if (Status == "no_change") After = Before;
    }

    public void DispatchFailed(string error) { Status = "dispatch_result_unknown"; Error = error; }
    public void VerificationFailed(string error) { Status = "verification_unavailable"; Error = error; }

    public void Observe(int epoch, long revision, string value, DateTime now)
    {
        if (!Pending) return;
        if (epoch != Epoch) { Status = "session_changed"; return; }
        if (revision > InitialRevision)
        {
            After = value;
            if (value == Desired) { Status = "verified"; return; }
            // A duplicate notification of the pre-command value is not a rejection.
            if (value != Before) { Status = "conflict"; return; }
        }
        if ((now - Started).TotalSeconds >= 8) Status = "unverified_timeout";
    }
}
