#!/usr/bin/env python3

import json
import threading
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib, Gdk

class ResultsView(Gtk.ScrolledWindow):
	    
    def __init__(self, main_window):
        super().__init__()
        
        self.main_window = main_window
        self.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        self._last_results_data = None
        self._current_scan_id = None
        self._ai_cache = {}
        self._all_libraries = []
        self._libs_expanded = False
        self._libs_default_limit = 5

        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        main_box.set_margin_left(24)
        main_box.set_margin_right(24)
        main_box.set_margin_top(24)
        main_box.set_margin_bottom(24)

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        title = Gtk.Label()
        title.set_markup('<span size="x-large" weight="bold">Scan Results</span>')
        title.set_xalign(0)
        header.pack_start(title, False, False, 0)

        controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        controls.set_halign(Gtk.Align.END)
        self.ai_btn = Gtk.Button.new_with_label("AI Analysis")
        self.ai_btn.connect('clicked', self._on_ai_analysis)
        controls.pack_start(self.ai_btn, False, False, 0)
        header.pack_end(controls, False, False, 0)

        main_box.pack_start(header, False, False, 0)

        self.empty_frame = Gtk.Frame()
        self.empty_frame.set_shadow_type(Gtk.ShadowType.NONE)
        self.empty_frame.get_style_context().add_class('card')
        empty_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        empty_box.set_margin_top(16)
        empty_box.set_margin_bottom(16)
        empty_box.set_margin_left(16)
        empty_box.set_margin_right(16)

        empty_title = Gtk.Label()
        empty_title.set_markup('<span size="large" weight="semibold">No scan results yet</span>')
        empty_title.set_xalign(0)
        empty_box.pack_start(empty_title, False, False, 0)

        empty_desc = Gtk.Label()
        empty_desc.set_markup(
            '<span size="small">Run your first scan from the <i>New Scan</i> tab. '
            'Once it completes, results will appear here with libraries, findings '
            'and AI analysis.</span>'
        )
        empty_desc.set_xalign(0)
        empty_desc.set_line_wrap(True)
        empty_desc.get_style_context().add_class('text-secondary')
        empty_box.pack_start(empty_desc, False, False, 0)

        self.empty_frame.add(empty_box)
        main_box.pack_start(self.empty_frame, True, True, 0)

        self.summary_frame = Gtk.Frame()
        self.summary_frame.set_shadow_type(Gtk.ShadowType.NONE)
        self.summary_frame.get_style_context().add_class('card')
        summary_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        summary_box.set_margin_top(8)
        summary_box.set_margin_bottom(8)
        summary_box.set_margin_left(12)
        summary_box.set_margin_right(12)

        self.url_label = Gtk.Label()
        self.url_label.set_xalign(0)
        self.risk_label = Gtk.Label()
        self.risk_label.set_xalign(0)
        self.summary_label = Gtk.Label()
        self.summary_label.set_xalign(0)
        self.quality_label = Gtk.Label()
        self.quality_label.set_xalign(0)
        self.quality_label.get_style_context().add_class('text-secondary')

        summary_box.pack_start(self.url_label, False, False, 0)
        summary_box.pack_start(self.risk_label, False, False, 0)
        summary_box.pack_start(self.summary_label, False, False, 0)
        summary_box.pack_start(self.quality_label, False, False, 0)

        self.summary_frame.add(summary_box)
        main_box.pack_start(self.summary_frame, False, False, 0)

        self.libs_frame = Gtk.Frame()
        self.libs_frame.set_shadow_type(Gtk.ShadowType.NONE)
        self.libs_frame.get_style_context().add_class('card')
        libs_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        libs_box.set_margin_top(8)
        libs_box.set_margin_bottom(8)
        libs_box.set_margin_left(12)
        libs_box.set_margin_right(12)

        libs_title = Gtk.Label()
        libs_title.set_markup('<span size="large" weight="semibold">Libraries</span>')
        libs_title.set_xalign(0)
        libs_box.pack_start(libs_title, False, False, 0)

        self.libs_list = Gtk.ListBox()
        self.libs_list.set_selection_mode(Gtk.SelectionMode.NONE)
        self.libs_list.get_style_context().add_class('results-list')
        libs_box.pack_start(self.libs_list, True, True, 0)

        self.libs_footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.libs_footer.set_halign(Gtk.Align.CENTER)
        self.libs_toggle_btn = Gtk.Button.new_with_label("Show all")
        self.libs_toggle_btn.connect('clicked', self._on_libs_toggle)
        self.libs_footer.pack_start(self.libs_toggle_btn, False, False, 0)
        libs_box.pack_start(self.libs_footer, False, False, 0)

        self.libs_frame.add(libs_box)
        main_box.pack_start(self.libs_frame, True, True, 0)

        self.findings_frame = Gtk.Frame()
        self.findings_frame.set_shadow_type(Gtk.ShadowType.NONE)
        self.findings_frame.get_style_context().add_class('card')
        findings_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        findings_box.set_margin_top(8)
        findings_box.set_margin_bottom(8)
        findings_box.set_margin_left(12)
        findings_box.set_margin_right(12)

        findings_title = Gtk.Label()
        findings_title.set_markup('<span size="large" weight="semibold">Engine Findings</span>')
        findings_title.set_xalign(0)
        findings_box.pack_start(findings_title, False, False, 0)

        self.findings_list = Gtk.ListBox()
        self.findings_list.set_selection_mode(Gtk.SelectionMode.NONE)
        self.findings_list.get_style_context().add_class('results-list')
        findings_box.pack_start(self.findings_list, True, True, 0)

        self.findings_frame.add(findings_box)
        main_box.pack_start(self.findings_frame, True, True, 0)

        self.ai_frame = Gtk.Frame()
        self.ai_frame.set_shadow_type(Gtk.ShadowType.NONE)
        self.ai_frame.get_style_context().add_class('card')
        ai_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        ai_box.set_margin_top(8)
        ai_box.set_margin_bottom(8)
        ai_box.set_margin_left(12)
        ai_box.set_margin_right(12)

        ai_title = Gtk.Label(label="AI Analysis")
        ai_title.set_xalign(0)
        ai_box.pack_start(ai_title, False, False, 0)

        self.ai_text_view = Gtk.TextView()
        self.ai_text_view.set_editable(False)
        self.ai_text_view.set_cursor_visible(False)
        self.ai_text_view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        ctx = self.ai_text_view.get_style_context()
        ctx.add_class('text-base')
        ctx.add_class('results-area')
        self.ai_text_view.override_background_color(
            Gtk.StateFlags.NORMAL,
            Gdk.RGBA(red=0.141, green=0.161, blue=0.219, alpha=1.0),
        )

        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        scroller.add(self.ai_text_view)
        ai_box.pack_start(scroller, True, True, 0)

        self.ai_frame.add(ai_box)
        main_box.pack_start(self.ai_frame, True, True, 0)

        self.summary_frame.hide()
        self.libs_frame.hide()
        self.findings_frame.hide()
        self.ai_frame.hide()

        self.add(main_box)
    
    def display_results(self, results_data: dict):
        self._last_results_data = results_data

        if self.empty_frame.get_visible():
            self.empty_frame.hide()
            self.summary_frame.show_all()
            self.libs_frame.show_all()
            self.findings_frame.show_all()
            self.ai_frame.show_all()
        
        scan = results_data.get('scan', {})
        self._current_scan_id = scan.get('id') or scan.get('scanId')
        url = scan.get('url', 'N/A')
        score = scan.get('globalRiskScore', 'N/A')
        
        summary = results_data.get('summary', {})
        diagnostics = results_data.get('diagnostics', {}) or {}
        total_libs = summary.get('totalLibraries', 0)
        total_vulns = summary.get('totalVulnerabilities', 0)

        self.url_label.set_text(f"URL: {url}")
        risk_text = f"Risk Score: {score}"
        try:
            if isinstance(score, (int, float)):
                risk_text += f" ({self._get_risk_level_text(float(score))})"
        except Exception:
            pass
        self.risk_label.set_text(risk_text)
        
        libraries = results_data.get('libraries', [])
        findings = results_data.get('findings', [])

        critical_libs = 0
        for lib in libraries or []:
            try:
                risk = float(lib.get('riskScore', 0) or 0)
            except (TypeError, ValueError):
                risk = 0.0
            if self._get_risk_level_text(risk) == "Critical Risk":
                critical_libs += 1

        self.summary_label.set_text(
            f"Libraries: {total_libs}    OSV vulnerabilities: {total_vulns}    Critical libs: {critical_libs}"
        )

        quality = diagnostics.get('qualityScore')
        partial = diagnostics.get('partialScan') is True
        if isinstance(quality, (int, float)):
            status = "Degraded" if partial else "Healthy"
            self.quality_label.set_text(f"Scan quality: {int(quality)} / 100 ({status})")
        elif partial:
            self.quality_label.set_text("Scan quality: Degraded (partial scan)")
        else:
            self.quality_label.set_text("")

        self._all_libraries = libraries or []
        self._libs_expanded = False
        self._render_libraries()

        for row in list(self.findings_list.get_children()):
            self.findings_list.remove(row)

        if findings:
            severity_order = {
                'critical': 4,
                'high': 3,
                'moderate': 2,
                'medium': 2,
                'low': 1,
            }

            def _finding_sort_key(f):
                sev = str(f.get('severity', '')).lower()
                return severity_order.get(sev, 0)

            sorted_findings = sorted(findings, key=_finding_sort_key, reverse=True)

            for finding in sorted_findings[:50]:
                row = Gtk.ListBoxRow()
                row_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

                left_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
                title = Gtk.Label(label=str(finding.get('title', 'Finding')))
                title.set_xalign(0)
                left_box.pack_start(title, False, False, 0)

                desc = str(finding.get('description', ''))
                if len(desc) > 160:
                    desc = desc[:157] + '...'
                desc_label = Gtk.Label(label=desc)
                desc_label.set_xalign(0)
                desc_label.set_line_wrap(True)
                desc_label.get_style_context().add_class('text-secondary')
                left_box.pack_start(desc_label, False, False, 0)

                row_box.pack_start(left_box, True, True, 0)

                severity = str(finding.get('severity', '')).lower()
                badge = Gtk.Label(label=severity.title() or 'Info')
                badge.get_style_context().add_class('severity-badge')
                severity_class = self._get_severity_class_for_severity(severity)
                if severity_class:
                    badge.get_style_context().add_class(severity_class)
                row_box.pack_end(badge, False, False, 0)

                row.add(row_box)
                self.findings_list.add(row)
        else:
            empty_row = Gtk.ListBoxRow()
            lbl = Gtk.Label(label="No engine findings for this scan. Library vulnerabilities are listed above.")
            lbl.set_xalign(0)
            empty_row.add(lbl)
            self.findings_list.add(empty_row)

        self.findings_list.show_all()

    def _get_risk_level_text(self, risk_score: float) -> str:
        if risk_score >= 80:
            return "Critical Risk"
        elif risk_score >= 60:
            return "High Risk"
        elif risk_score >= 30:
            return "Medium Risk"
        else:
            return "Low Risk"

    def _get_severity_class_for_level(self, level: str) -> str:
        level = (level or "").lower()
        if "critical" in level:
            return 'severity-critical'
        if "high" in level:
            return 'severity-high'
        if "medium" in level:
            return 'severity-medium'
        if "low" in level:
            return 'severity-low'
        return 'severity-info'

    def _get_severity_class_for_severity(self, severity: str) -> str:
        s = (severity or "").lower()
        if s == 'critical':
            return 'severity-critical'
        if s == 'high':
            return 'severity-high'
        if s == 'moderate' or s == 'medium':
            return 'severity-medium'
        if s == 'low':
            return 'severity-low'
        return 'severity-info'

    def _render_libraries(self):
        for row in list(self.libs_list.get_children()):
            self.libs_list.remove(row)

        libraries = self._all_libraries or []
        if not libraries:
            empty_row = Gtk.ListBoxRow()
            lbl = Gtk.Label(label="No libraries detected for this scan.")
            lbl.set_xalign(0)
            empty_row.add(lbl)
            self.libs_list.add(empty_row)
            self.libs_footer.hide()
            self.libs_list.show_all()
            return

        def _lib_sort_key(lib):
            raw_risk = lib.get('riskScore', 0)
            try:
                risk = float(raw_risk or 0)
            except (TypeError, ValueError):
                risk = 0.0
            vulns = lib.get('vulnerabilities') or []
            return (risk, len(vulns))

        sorted_libs = sorted(libraries, key=_lib_sort_key, reverse=True)
        limit = len(sorted_libs) if self._libs_expanded else min(self._libs_default_limit, len(sorted_libs))

        for lib in sorted_libs[:limit]:
            row = Gtk.ListBoxRow()
            row_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

            left_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            name = lib.get('name', 'Unknown')
            version = lib.get('detectedVersion') or 'Unknown'
            title = Gtk.Label(label=f"{name} {version}")
            title.set_xalign(0)
            left_box.pack_start(title, False, False, 0)

            vulns = lib.get('vulnerabilities', []) or []
            related = lib.get('relatedScripts', []) or []
            meta = Gtk.Label(
                label=f"Vulnerabilities: {len(vulns)}    Scripts: {len(related)}"
            )
            meta.set_xalign(0)
            meta.get_style_context().add_class('text-secondary')
            left_box.pack_start(meta, False, False, 0)

            row_box.pack_start(left_box, True, True, 0)

            risk = lib.get('riskScore', 0)
            level = self._get_risk_level_text(float(risk))
            badge = Gtk.Label(label=level)
            badge.get_style_context().add_class('severity-badge')
            severity_class = self._get_severity_class_for_level(level)
            if severity_class:
                badge.get_style_context().add_class(severity_class)
            row_box.pack_end(badge, False, False, 0)

            row.add(row_box)
            self.libs_list.add(row)

        if len(sorted_libs) > self._libs_default_limit:
            self.libs_footer.show()
            if self._libs_expanded:
                self.libs_toggle_btn.set_label("Show less")
            else:
                self.libs_toggle_btn.set_label(f"Show all ({len(sorted_libs)})")
        else:
            self.libs_footer.hide()

        self.libs_list.show_all()

    def _on_libs_toggle(self, button):
        self._libs_expanded = not self._libs_expanded
        self._render_libraries()

    def _on_ai_analysis(self, button):
        if not self._last_results_data:
            self.main_window.app.show_error_dialog("AI Analysis", "No results to analyze", self.main_window)
            return
        
        scan = self._last_results_data.get('scan', {}) or {}
        scan_id = scan.get('id') or scan.get('scanId')
        if scan_id and scan_id in self._ai_cache:
            self._set_ai_text(self._ai_cache[scan_id])
            return
        
        def run():
            scan_inner = self._last_results_data.get('scan', {}) or {}
            summary = self._last_results_data.get('summary', {}) or {}
            diagnostics = self._last_results_data.get('diagnostics', {}) or {}
            libs = self._last_results_data.get('libraries', []) or []
            findings = self._last_results_data.get('findings', []) or []

            def _lib_sort_key_for_ai(lib):
                raw_risk = lib.get('riskScore', 0)
                try:
                    risk = float(raw_risk or 0)
                except (TypeError, ValueError):
                    risk = 0.0
                vulns = lib.get('vulnerabilities') or []
                return (risk, len(vulns))

            sorted_libs = sorted(libs, key=_lib_sort_key_for_ai, reverse=True)
            top_libs = sorted_libs[:20]
            libs_brief = [
                {
                    'name': l.get('name'),
                    'version': l.get('detectedVersion'),
                    'riskScore': l.get('riskScore'),
                    'vulnerabilityCount': len(l.get('vulnerabilities') or []),
                }
                for l in top_libs
            ]

            severity_order = {
                'critical': 4,
                'high': 3,
                'moderate': 2,
                'medium': 2,
                'low': 1,
            }

            def _finding_sort_key_for_ai(f):
                sev = str(f.get('severity', '')).lower()
                return severity_order.get(sev, 0)

            sorted_findings = sorted(findings, key=_finding_sort_key_for_ai, reverse=True)
            findings_brief = []
            for f in sorted_findings[:20]:
                desc = str(f.get('description', ''))
                if len(desc) > 240:
                    desc = desc[:237] + '...'
                findings_brief.append({
                    'title': f.get('title'),
                    'severity': f.get('severity'),
                    'description': desc,
                })

            prompt = (
                "Using the JSON context, generate a structured security assessment. "
                "Write the answer in four clear sections with markdown headings: \n"
                "1) Executive Summary (3-5 bullet points, non-technical),\n"
                "2) Key Risks (ranked, each with severity and short impact),\n"
                "3) Technical Details (where the issues come from and how they could be exploited),\n"
                "4) Prioritized Remediation Plan (concrete, actionable steps ordered by priority).\n\n"
                "Pay special attention to the highest-risk libraries and any critical or high-severity findings. "
                "If the scan appears partial or degraded, clearly call this out in the Executive Summary."
            )
            context = {
                'scan': {
                    'url': scan_inner.get('url'),
                    'globalRiskScore': scan_inner.get('globalRiskScore')
                },
                'summary': summary,
                'diagnostics': diagnostics,
                'libraries': libs_brief,
                'top_findings': findings_brief,
            }
            s = self.main_window.settings
            resp = self.main_window.api_client.generate_ai_analysis(
                prompt,
                context,
                provider=str(s.get('llm_provider')),
                model=str(s.get('llm_model')),
                temperature=float(s.get('llm_temperature')),
                max_tokens=int(s.get('llm_max_tokens'))
            )
            if resp.success:
                data = resp.data
                if isinstance(data, dict):
                    text = data.get('output') or data.get('text') or json.dumps(data, indent=2)
                else:
                    text = str(data)
                if scan_id:
                    self._ai_cache[scan_id] = text
                GLib.idle_add(self._set_ai_text, text)
            else:
                GLib.idle_add(self._show_ai_error, resp.error or "AI request failed")
        
        buf = self.ai_text_view.get_buffer()
        buf.set_text("Analyzing...")
        threading.Thread(target=run, daemon=True).start()

    def _set_ai_text(self, text: str):
        buf = self.ai_text_view.get_buffer()
        buf.set_text(text)

    def _show_ai_error(self, message: str):
        self.main_window.app.show_error_dialog("AI Analysis Error", message, self.main_window)
