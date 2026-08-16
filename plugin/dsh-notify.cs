// dsh-notify.exe - standalone Windows notifier for dsh-turn-notify.
// WinRT toast via AUMID "dsh-turn-notify" (start-menu shortcut registered),
// falls back to tray balloon, then exits non-zero. No PowerShell involved.
// Build: csc /nologo /nostdlib /target:exe /out:dsh-notify.exe
//   /r:mscorlib.dll /r:System.dll /r:System.Core.dll
//   /r:"<GAC System.Runtime.dll>"
//   /r:System.Windows.Forms.dll /r:System.Drawing.dll
//   /r:System.Runtime.WindowsRuntime.dll
//   /r:"C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.26100.0\Windows.winmd"
//   dsh-notify.cs
using System;
using System.Windows.Forms;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

class DshNotify
{
    [STAThread]
    static int Main(string[] args)
    {
        string title = "", body = "";
        bool sound = false;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "-Title": if (i + 1 < args.Length) title = args[++i]; break;
                case "-Body": if (i + 1 < args.Length) body = args[++i]; break;
                case "-Sound": sound = true; break;
            }
        }
        if (title.Length == 0 || body.Length == 0)
        {
            Console.Error.WriteLine("usage: dsh-notify.exe -Title <title> -Body <body> [-Sound]");
            return 2;
        }
        try
        {
            SendToast(title, body, sound);
            return 0;
        }
        catch (Exception e1)
        {
            try
            {
                SendBalloon(title, body);
                return 0;
            }
            catch (Exception e2)
            {
                Console.Error.WriteLine("toast and balloon failed: " + e1.Message + "; " + e2.Message);
                return 1;
            }
        }
    }

    static readonly string[] CHIME_CANDIDATES = new string[]
    {
        @"C:\Windows\Media\chimes.wav",
        @"C:\Windows\Media\Windows Ding.wav",
        @"C:\Windows\Media\Windows Notify.wav",
    };

    static void SendToast(string title, string body, bool sound)
    {
        string xml = "<toast duration='long'><visual><binding template='ToastText02'>"
            + "<text id='1' hint-style='title'>" + Escape(title) + "</text>"
            + "<text id='2'>" + Escape(body) + "</text>"
            + "</binding></visual>"
            + "<audio silent='true'/>"
            + "</toast>";
        XmlDocument doc = new XmlDocument();
        doc.LoadXml(xml);
        ToastNotification toast = new ToastNotification(doc);
        ToastNotificationManager.CreateToastNotifier("dsh-turn-notify").Show(toast);
        if (sound) PlayChime();
    }

    static void PlayChime()
    {
        foreach (string candidate in CHIME_CANDIDATES)
        {
            if (System.IO.File.Exists(candidate))
            {
                using (System.Media.SoundPlayer player = new System.Media.SoundPlayer(candidate))
                {
                    player.PlaySync();
                }
                return;
            }
        }
    }

    static string Escape(string s)
    {
        return System.Security.SecurityElement.Escape(s);
    }

    static void SendBalloon(string title, string body)
    {
        NotifyIcon icon = new NotifyIcon();
        icon.Icon = System.Drawing.SystemIcons.Information;
        icon.Visible = true;
        icon.ShowBalloonTip(8000, title, body, ToolTipIcon.Info);
        System.Threading.Thread.Sleep(8000);
        icon.Dispose();
    }
}
