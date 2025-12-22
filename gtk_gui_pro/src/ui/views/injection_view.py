import threading
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib, Gdk


class InjectionView(Gtk.Box):

    def __init__(self, main_window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.main_window = main_window
        self.set_margin_left(24)
        self.set_margin_right(24)
        self.set_margin_top(24)
        self.set_margin_bottom(24)
        self.task_id = None
        self._build_ui()

    def on_view_activated(self):
        try:
            results_view = self.main_window.views.get('results')
            last = getattr(results_view, '_last_results_data', None) if results_view else None
            if last and isinstance(last, dict):
                scan = last.get('scan', {}) or {}
                url = scan.get('url')
                if isinstance(url, str) and url:
                    self.url_entry.set_text(url)
        except Exception:
            pass

    def _build_ui(self):
        title = Gtk.Label()
        title.set_markup('<span size="x-large" weight="bold">Prompt Injection Lab</span>')
        title.set_xalign(0)
        self.pack_start(title, False, False, 0)

        subtitle = Gtk.Label()
        subtitle.set_markup(
            '<span size="small">Run automated prompt-injection and jailbreak probes '
            'against your application and review the live log of model behavior.</span>'
        )
        subtitle.set_xalign(0)
        subtitle.get_style_context().add_class('text-secondary')
        self.pack_start(subtitle, False, False, 0)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        lbl = Gtk.Label(label="Target URL:")
        lbl.set_size_request(100, -1)
        row.pack_start(lbl, False, False, 0)

        self.url_entry = Gtk.Entry()
        self.url_entry.set_placeholder_text("https://example.com")
        row.pack_start(self.url_entry, True, True, 0)

        run_btn = Gtk.Button.new_with_label("Run Tests")
        run_btn.get_style_context().add_class('primary')
        run_btn.connect('clicked', self._on_run_tests)
        row.pack_start(run_btn, False, False, 0)
        self.pack_start(row, False, False, 0)

        helper = Gtk.Label()
        helper.set_markup(
            '<span size="small">Tip: point this at a page that already talks to a model '
            '(chat widget, AI assistant, etc.). The lab will try a curated set of '
            'prompt-injection payloads.</span>'
        )
        helper.set_xalign(0)
        helper.set_line_wrap(True)
        helper.get_style_context().add_class('form-helper')
        self.pack_start(helper, False, False, 0)

        self.progress = Gtk.ProgressBar()
        self.progress.set_show_text(True)
        self.progress.set_text("Ready")
        self.pack_start(self.progress, False, False, 0)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.pack_start(content, True, True, 0)

        info_frame = Gtk.Frame()
        info_frame.set_shadow_type(Gtk.ShadowType.NONE)
        info_frame.get_style_context().add_class('card')

        info_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        info_box.set_margin_top(10)
        info_box.set_margin_bottom(10)
        info_box.set_margin_left(12)
        info_box.set_margin_right(12)

        info_title = Gtk.Label()
        info_title.set_markup('<span weight="semibold">What this lab tests</span>')
        info_title.set_xalign(0)
        info_box.pack_start(info_title, False, False, 0)

        bullets = [
            "Attempts classic prompt-injection and jailbreak payloads.",
            "Looks for signs of data exfiltration or policy bypass.",
            "Surfaces raw prompts / responses so you can tune defenses."
        ]
        for txt in bullets:
            l = Gtk.Label()
            l.set_markup(f'<span size="small">• {Gtk.utils.escape_text(txt) if hasattr(Gtk, "utils") else txt}</span>')
            l.set_xalign(0)
            l.set_line_wrap(True)
            l.get_style_context().add_class('text-tertiary')
            info_box.pack_start(l, False, False, 0)

        tips_title = Gtk.Label()
        tips_title.set_markup('<span weight="semibold" size="small">How to interpret results</span>')
        tips_title.set_xalign(0)
        tips_title.set_margin_top(8)
        info_box.pack_start(tips_title, False, False, 0)

        tips = Gtk.Label()
        tips.set_markup(
            '<span size="small">Look for prompts that cause the model to leak secrets, '
            'ignore instructions, or execute unintended actions. Use these as regression '
            'tests when updating prompts or safety rules.</span>'
        )
        tips.set_xalign(0)
        tips.set_line_wrap(True)
        tips.get_style_context().add_class('text-secondary')
        info_box.pack_start(tips, False, False, 0)

        info_frame.add(info_box)
        content.pack_start(info_frame, False, False, 0)

        log_frame = Gtk.Frame()
        log_frame.set_shadow_type(Gtk.ShadowType.NONE)
        log_frame.get_style_context().add_class('card')

        log_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        log_box.set_margin_top(10)
        log_box.set_margin_bottom(10)
        log_box.set_margin_left(12)
        log_box.set_margin_right(12)

        log_title = Gtk.Label()
        log_title.set_markup('<span weight="semibold">Live Log</span>')
        log_title.set_xalign(0)
        log_box.pack_start(log_title, False, False, 0)

        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)

        self.text_view = Gtk.TextView()
        self.text_view.set_editable(False)
        self.text_view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        self.text_view.set_cursor_visible(False)
        ctx = self.text_view.get_style_context()
        ctx.add_class('results-area')
        ctx.add_class('live-log')

        self.text_view.override_background_color(
            Gtk.StateFlags.NORMAL,
            Gdk.RGBA(red=0.141, green=0.161, blue=0.219, alpha=1.0),
        )

        buf = self.text_view.get_buffer()
        buf.set_text(
            "💡 Live Log tips\n"
            "\n"
            "- Use 'Run Tests' to start prompt-injection probes.\n"
            "- This area will show live model behavior and log lines.\n"
            "- Watch for unusual responses that might indicate jailbreaks.\n"
        )

        scroller.add(self.text_view)

        log_box.pack_start(scroller, True, True, 0)
        log_frame.add(log_box)
        content.pack_start(log_frame, True, True, 0)

    def _append_log(self, text: str):
        buf = self.text_view.get_buffer()
        end_iter = buf.get_end_iter()
        buf.insert(end_iter, text + "\n")

    def _on_run_tests(self, button):
        url = (self.url_entry.get_text() or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            self.main_window.app.show_error_dialog("Invalid URL", "Please enter a valid URL starting with http:// or https://", self.main_window)
            return
        self.progress.set_fraction(0.0)
        self.progress.set_text("Starting...")
        self.text_view.get_buffer().set_text("")
        def run():
            resp = self.main_window.api_client.run_injection_tests(url)
            if resp.success:
                data = resp.data if isinstance(resp.data, dict) else {}
                task_id = data.get('taskId') or data.get('task_id') or data.get('id')
                if task_id:
                    self.task_id = task_id
                    GLib.idle_add(self._append_log, f"Task started: {task_id}")
                    GLib.idle_add(self.progress.set_text, "Running...")
                    GLib.idle_add(self.progress.set_fraction, 0.1)
                    GLib.idle_add(self._poll_status)
                else:
                    results = data.get('results') or resp.data
                    GLib.idle_add(self._render_results, results)
            else:
                prompt = f"Assess prompt injection risks for the web page at {url}. Provide examples of likely attack prompts, expected model behaviors to avoid, and concrete mitigations in bullets."
                ai = self.main_window.api_client.generate_ai_analysis(prompt, {'url': url})
                if ai.success:
                    GLib.idle_add(self._append_log, str(ai.data))
                    GLib.idle_add(self.progress.set_text, "Completed (AI)")
                    GLib.idle_add(self.progress.set_fraction, 1.0)
                else:
                    GLib.idle_add(self.main_window.app.show_error_dialog, "Injection Lab", ai.error or "Request failed", self.main_window)
                    GLib.idle_add(self.progress.set_text, "Failed")
        threading.Thread(target=run, daemon=True).start()

    def _poll_status(self):
        if not self.task_id:
            return False
        def fetch():
            resp = self.main_window.api_client.get_injection_status(self.task_id)
            if resp.success:
                data = resp.data if isinstance(resp.data, dict) else {}
                logs = data.get('logs') or []
                progress = data.get('progress', 0)
                status = data.get('status', 'running')
                for line in logs:
                    GLib.idle_add(self._append_log, str(line))
                GLib.idle_add(self.progress.set_fraction, max(0.1, min(0.99, progress/100.0)))
                GLib.idle_add(self.progress.set_text, f"{status.title()} {progress}%")
                if status in ('completed','failed'):
                    results = data.get('results')
                    if results is not None:
                        GLib.idle_add(self._render_results, results)
                    return
                GLib.timeout_add_seconds(2, self._poll_status)
            else:
                GLib.idle_add(self._append_log, resp.error or "Status error")
                GLib.timeout_add_seconds(3, self._poll_status)
        threading.Thread(target=fetch, daemon=True).start()
        return False

    def _render_results(self, results):
        self.progress.set_fraction(1.0)
        self.progress.set_text("Completed")
        buf = self.text_view.get_buffer()
        buf.insert(buf.get_end_iter(), ("\n" if buf.get_char_count()>0 else "") + "=== RESULTS ===\n")
        buf.insert(buf.get_end_iter(), (str(results) if not isinstance(results, str) else results) + "\n")
